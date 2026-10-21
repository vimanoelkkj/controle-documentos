import { describe, expect, it } from 'vitest';
import template from '../config/homologacao/template-sheets-homologacao.json';
import {
  HOMOLOG_TAB_NAMES,
  EXPECTED_CONTROL_HEADERS,
  EXPECTED_BASE_HEADERS,
  buildSheetValuesFromTemplate,
  buildStructuralBatchRequests,
  provisionGoogleSheets,
  verifyIsolationMinimumPrivilege,
  verifySpreadsheetStrict,
} from '../scripts/homologacao/provisionar-sheets-homologacao.mjs';
import {
  GoogleSheetsRealAdapter,
  GoogleSheetsNotFoundError,
} from '../src/server/services/sync-sheet-real-adapter';
import { runScheduledSyncV2 } from '../src/server/services/sync-coordinator';
import { recoverExpiredLeases } from '../src/server/services/sync-d1-operations';
import { normalizeDocumentCellValue } from '../src/server/services/sync-sheet-contracts';
import { handleSyncV2AdminRoute } from '../src/server/routes/sync-v2-admin';

describe('Homologação Google Sheets — Provisionamento e Isolamento', () => {

  // --------------------------------------------------------------------------
  // 1. CONFERÊNCIA DO TEMPLATE DE HOMOLOGAÇÃO
  // --------------------------------------------------------------------------
  describe('1. Validação Estrutural do Template', () => {
    it('possui exatamente as 4 abas requeridas com nomes canônicos', () => {
      const nomesAbas = template.abas.map((a: any) => a.nome_aba);
      expect(nomesAbas).toEqual([
        HOMOLOG_TAB_NAMES.DOCS_FACE_FEA,
        HOMOLOG_TAB_NAMES.DOCS_FCH_EAD,
        HOMOLOG_TAB_NAMES.BASE_FACE_FEA,
        HOMOLOG_TAB_NAMES.BASE_FCH_EAD,
      ]);
    });

    it('as abas de controle documental possuem cabeçalhos e fórmulas J e K esperados', () => {
      const controleTabs = template.abas.filter((a: any) => a.tipo === 'CONTROLE_DOCUMENTAL');
      expect(controleTabs.length).toBe(2);

      for (const tab of controleTabs) {
        expect(tab.cabecalhos).toEqual(EXPECTED_CONTROL_HEADERS);
        expect(tab.cabecalhos[9]).toBe('TOTAL ENTREGUES');
        expect(tab.cabecalhos[10]).toBe('STATUS DOCUMENTAL');

        for (const aluno of tab.dados_ficticios_iniciais) {
          expect(aluno.col_J_total).toContain('=CONT.SE(');
          expect(aluno.col_K_status).toContain('=SE(J');
        }
      }
    });

    it('as abas de base possuem cabeçalhos canônicos com RA na coluna G', () => {
      const baseTabs = template.abas.filter((a: any) => a.tipo === 'GERAL_CONTRATUAL');
      expect(baseTabs.length).toBe(2);

      for (const tab of baseTabs) {
        expect(tab.cabecalhos).toEqual(EXPECTED_BASE_HEADERS);
        expect(tab.cabecalhos[0]).toBe('SITUAÇÃO CONTRATUAL');
        expect(tab.cabecalhos[6]).toBe('RA');
      }
    });

    it('os 4 alunos fictícios correspondem exatamente ao D1 de homologação', () => {
      // D1 setup:
      // ALFA (9001): 1,1,1,1,1,1,0 (6 entregues, contrato pendente)
      // BETA (9002): 0,0,0,0,0,0,0 (0 entregues)
      // GAMA (9003): 1,1,0,1,0,1,0 (4 entregues, certidão, título, contrato pendentes)
      // DELTA (9004): 1,1,1,1,1,1,1 (7 entregues, completo)

      const faceTab = template.abas.find((a: any) => a.nome_aba === HOMOLOG_TAB_NAMES.DOCS_FACE_FEA);
      const alfa = faceTab.dados_ficticios_iniciais.find((x: any) => x.col_A_ra === '0090001001');
      const beta = faceTab.dados_ficticios_iniciais.find((x: any) => x.col_A_ra === '0090001002');

      expect(alfa).toBeDefined();
      expect(alfa.col_C_identidade).toBe('OK');
      expect(alfa.col_D_cpf).toBe('OK');
      expect(alfa.col_E_certidao).toBe('OK');
      expect(alfa.col_F_residencia).toBe('OK');
      expect(alfa.col_G_titulo).toBe('OK');
      expect(alfa.col_H_ensino_medio).toBe('OK');
      expect(alfa.col_I_contrato).toBe('PENDENTE');

      expect(beta).toBeDefined();
      expect(beta.col_C_identidade).toBe('PENDENTE');
      expect(beta.col_I_contrato).toBe('PENDENTE');

      const fchTab = template.abas.find((a: any) => a.nome_aba === HOMOLOG_TAB_NAMES.DOCS_FCH_EAD);
      const gama = fchTab.dados_ficticios_iniciais.find((x: any) => x.col_A_ra === '0090002001');
      const delta = fchTab.dados_ficticios_iniciais.find((x: any) => x.col_A_ra === '0090002002');

      expect(gama).toBeDefined();
      expect(gama.col_C_identidade).toBe('OK');
      expect(gama.col_E_certidao).toBe('PENDENTE');
      expect(gama.col_G_titulo).toBe('PENDENTE');
      expect(gama.col_I_contrato).toBe('PENDENTE');

      expect(delta).toBeDefined();
      expect(delta.col_C_identidade).toBe('OK');
      expect(delta.col_I_contrato).toBe('OK');
    });

    it('normalização de células aceita TRUE, VERDADEIRO, OK e SIM para valor 1 e FALSE/FALSO/PENDENTE para valor 0', () => {
      expect(normalizeDocumentCellValue('TRUE')).toBe(1);
      expect(normalizeDocumentCellValue('VERDADEIRO')).toBe(1);
      expect(normalizeDocumentCellValue('OK')).toBe(1);
      expect(normalizeDocumentCellValue('SIM')).toBe(1);

      expect(normalizeDocumentCellValue('FALSE')).toBe(0);
      expect(normalizeDocumentCellValue('FALSO')).toBe(0);
      expect(normalizeDocumentCellValue('PENDENTE')).toBe(0);
      expect(normalizeDocumentCellValue('NÃO')).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // 2. SCRIPT DE PROVISIONAMENTO IDEMPOTENTE
  // --------------------------------------------------------------------------
  describe('2. Idempotência e Construção de Requisições', () => {
    it('buildSheetValuesFromTemplate converte checkboxes para booleanos e preserva RAs e fórmulas', () => {
      const values = buildSheetValuesFromTemplate(template);

      const faceRows = values[HOMOLOG_TAB_NAMES.DOCS_FACE_FEA];
      expect(faceRows.length).toBe(3); // cabeçalho + 2 alunos
      expect(faceRows[0]).toEqual(EXPECTED_CONTROL_HEADERS);

      // ALFA: row 1
      const alfaRow = faceRows[1];
      expect(alfaRow[0]).toBe('0090001001'); // preservado como texto com zeros à esquerda
      expect(alfaRow[2]).toBe(true); // Identidade OK -> boolean true (checkbox marcado)
      expect(alfaRow[8]).toBe(false); // Contrato PENDENTE -> boolean false (checkbox desmarcado)
      expect(alfaRow[9]).toContain('=CONT.SE');
      expect(alfaRow[10]).toContain('=SE(J2=7');

      // BETA: row 2
      const betaRow = faceRows[2];
      expect(betaRow[0]).toBe('0090001002');
      expect(betaRow[2]).toBe(false);
      expect(betaRow[8]).toBe(false);
    });

    it('buildStructuralBatchRequests cria abas ausentes e adiciona regras de validação para checkboxes nativos', () => {
      const { requests } = buildStructuralBatchRequests([], template);

      // Deve incluir addSheet ou updateSheetProperties para as 4 abas
      const addSheetReqs = requests.filter((r: any) => r.addSheet || r.updateSheetProperties);
      expect(addSheetReqs.length).toBe(4);

      // Deve incluir setDataValidation para tipo BOOLEAN (checkbox) nas abas de controle
      const validationReqs = requests.filter((r: any) => r.setDataValidation?.rule?.condition?.type === 'BOOLEAN');
      expect(validationReqs.length).toBe(2);

      // Deve incluir formatação TEXT para coluna de RA
      const textFormatReqs = requests.filter(
        (r: any) => r.repeatCell?.cell?.userEnteredFormat?.numberFormat?.type === 'TEXT'
      );
      expect(textFormatReqs.length).toBe(4);
    });

    it('buildStructuralBatchRequests é idempotente quando as abas já existem na planilha', () => {
      const existingSheets = [
        { properties: { sheetId: 10, title: HOMOLOG_TAB_NAMES.DOCS_FACE_FEA } },
        { properties: { sheetId: 20, title: HOMOLOG_TAB_NAMES.DOCS_FCH_EAD } },
        { properties: { sheetId: 30, title: HOMOLOG_TAB_NAMES.BASE_FACE_FEA } },
        { properties: { sheetId: 40, title: HOMOLOG_TAB_NAMES.BASE_FCH_EAD } },
      ];

      const { requests } = buildStructuralBatchRequests(existingSheets, template);

      // Nenhuma aba adicional deve ser criada
      const addSheetReqs = requests.filter((r: any) => r.addSheet);
      expect(addSheetReqs.length).toBe(0);

      // Validações e formatações continuam sendo aplicadas/garantidas
      const validationReqs = requests.filter((r: any) => r.setDataValidation?.rule?.condition?.type === 'BOOLEAN');
      expect(validationReqs.length).toBe(2);
    });

    it('provisionGoogleSheets em modo --dry-run valida o template sem realizar requisições de rede', async () => {
      const result = await provisionGoogleSheets({
        spreadsheetId: 'test-spreadsheet-id-homolog',
        templateContent: template,
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe('DRY_RUN');
      expect(result.tabsToConfigure).toHaveLength(4);
      expect(result.structuralRequestsCount).toBeGreaterThan(0);
    });

    it('provisionGoogleSheets executa provisionamento completo idempotente via mock de API', async () => {
      const sentRequests: Array<{ url: string; method: string; body: any }> = [];
      let currentSheets = [{ properties: { sheetId: 0, title: 'Sheet1' } }];

      const mockFetch: typeof fetch = async (url, init = {}) => {
        const u = String(url);
        const method = init.method || 'GET';
        const body = init.body ? JSON.parse(String(init.body)) : null;
        sentRequests.push({ url: u, method, body });

        if (method === 'GET' && u.includes('fields=sheets.properties')) {
          return new Response(JSON.stringify({ sheets: currentSheets }), { status: 200 });
        }

        if (method === 'POST' && u.includes(':batchUpdate')) {
          // Processa requisições estruturais simuladas
          for (const req of body.requests || []) {
            if (req.updateSheetProperties) {
              const target = currentSheets.find((s) => s.properties.sheetId === req.updateSheetProperties.properties.sheetId);
              if (target) target.properties.title = req.updateSheetProperties.properties.title;
            }
            if (req.addSheet) {
              currentSheets.push({
                properties: {
                  sheetId: req.addSheet.properties.sheetId,
                  title: req.addSheet.properties.title,
                },
              });
            }
          }
          return new Response(JSON.stringify({ replies: [] }), { status: 200 });
        }

        if (method === 'POST' && u.includes('/values:batchUpdate')) {
          return new Response(JSON.stringify({ totalUpdatedRows: 12 }), { status: 200 });
        }

        return new Response('{}', { status: 200 });
      };

      // 1ª Execução: cria abas a partir de Sheet1 e grava valores
      const res1 = await provisionGoogleSheets({
        spreadsheetId: 'homolog-sheet-abc',
        tokenProvider: async () => 'test-token',
        templateContent: template,
        dryRun: false,
        fetchFn: mockFetch,
      });

      expect(res1.success).toBe(true);
      expect(res1.structuralRequestsExecuted).toBeGreaterThan(0);
      expect(currentSheets.map((s) => s.properties.title)).toEqual([
        HOMOLOG_TAB_NAMES.DOCS_FACE_FEA,
        HOMOLOG_TAB_NAMES.DOCS_FCH_EAD,
        HOMOLOG_TAB_NAMES.BASE_FACE_FEA,
        HOMOLOG_TAB_NAMES.BASE_FCH_EAD,
      ]);

      // Verifica dados enviados no batchUpdate de valores
      const valuesReq = sentRequests.find((r) => r.url.includes('/values:batchUpdate'));
      expect(valuesReq).toBeDefined();
      expect(valuesReq?.body.valueInputOption).toBe('USER_ENTERED');
      expect(valuesReq?.body.data).toHaveLength(4);

      // 2ª Execução: já com todas as abas criadas (Idempotência estrita)
      sentRequests.length = 0;
      const res2 = await provisionGoogleSheets({
        spreadsheetId: 'homolog-sheet-abc',
        tokenProvider: async () => 'test-token',
        templateContent: template,
        dryRun: false,
        fetchFn: mockFetch,
      });

      expect(res2.success).toBe(true);
      // Nenhuma aba deve ser adicionada novamente
      const batchStructReq2 = sentRequests.find((r) => r.url.includes(':batchUpdate') && !r.url.includes('values'));
      const addedSheets = batchStructReq2?.body.requests.filter((r: any) => r.addSheet);
      expect(addedSheets).toHaveLength(0);
      // A lista de abas permanece intacta
      expect(currentSheets).toHaveLength(4);
    });

    it('provisionGoogleSheets rejeita IDs inválidos ou placeholders de configuração', async () => {
      await expect(
        provisionGoogleSheets({
          spreadsheetId: 'SUBSTITUIR_PELO_SPREADSHEET_ID_DE_HOMOLOGACAO',
          templateContent: template,
          dryRun: false,
        })
      ).rejects.toThrow(/SPREADSHEET_ID inválido ou placeholder não substituído/);

      await expect(
        provisionGoogleSheets({
          spreadsheetId: '   ',
          templateContent: template,
          dryRun: false,
        })
      ).rejects.toThrow(/SPREADSHEET_ID inválido/);
    });
  });

  // --------------------------------------------------------------------------
  // 3. PROTEÇÃO CONTRA PLANILHAS DE PRODUÇÃO E PRIVILÉGIO MÍNIMO
  // --------------------------------------------------------------------------
  describe('3. Proteção e Isolamento Rigoroso', () => {
    it('verifyIsolationMinimumPrivilege confirma HTTP 403/404 em planilha não autorizada', async () => {
      const mockFetch: typeof fetch = async () => {
        // Simula rejeição de autorização da Google API para recurso externo não compartilhado
        return new Response(
          JSON.stringify({
            error: {
              code: 403,
              message: 'The caller does not have permission on the requested spreadsheet.',
              status: 'PERMISSION_DENIED',
            },
          }),
          { status: 403 }
        );
      };

      const result = await verifyIsolationMinimumPrivilege({
        unauthorizedSpreadsheetId: 'id-planilha-producao-externa-999',
        tokenProvider: async () => 'mock-token',
        fetchFn: mockFetch,
      });

      expect(result.isIsolated).toBe(true);
      expect(result.status).toBe(403);
      expect(result.message).toContain('Privilégio mínimo verificado');
    });

    it('GoogleSheetsRealAdapter rejeita requisições a planilhas inexistentes ou não autorizadas (404/403)', async () => {
      const mockFetch: typeof fetch = async () => {
        return new Response(
          JSON.stringify({
            error: {
              code: 404,
              message: 'Requested entity was not found.',
              status: 'NOT_FOUND',
            },
          }),
          { status: 404 }
        );
      };

      const adapter = new GoogleSheetsRealAdapter({
        tokenProvider: async () => 'test-token',
        fetchFn: mockFetch,
      });

      await expect(
        adapter.readControlTab({
          spreadsheetId: 'unauthorized-or-wrong-sheet-id',
          tabName: HOMOLOG_TAB_NAMES.DOCS_FACE_FEA,
          groupKey: 'FACE_FEA',
        })
      ).rejects.toThrow(GoogleSheetsNotFoundError);
    });

    it('GoogleSheetsRealAdapter bloqueia tentativas de escrita fora dos limites (ex: colunas fora de C:I)', async () => {
      const adapter = new GoogleSheetsRealAdapter({
        tokenProvider: async () => 'test-token',
      });

      // Tentativa de escrita de campo inválido na aba de controle
      const result = await adapter.writeDocumentField({
        spreadsheetId: 'mock-sheet',
        tabName: HOMOLOG_TAB_NAMES.DOCS_FACE_FEA,
        groupKey: 'FACE_FEA',
        raText: '0090001001',
        fieldKey: 'total_entregues' as any,
        preconditions: {
          targetKey: 'CONTROLE',
          expectedBefore: 'PENDENTE',
          fieldKey: 'total_entregues' as any,
          cellCoordinate: 'J2',
          expectedNormalizedBefore: 0,
          expectedRawValueBefore: 'PENDENTE',
          expectedFingerprint: 'mock-fp',
        },
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('OUT_OF_BOUNDS');
    });

    it('Scheduler do Worker não executa nenhuma integração quando SYNC_V2_ENABLED ou SYNC_V2_AUTO_ENABLED estão "false"', async () => {
      const dummyDb: any = {
        prepare: () => {
          throw new Error('O banco de dados não deveria ser consultado se a flag mestre estiver desativada');
        },
      };

      const reportDisabled = await runScheduledSyncV2({
        db: dummyDb,
        env: {
          SYNC_V2_ENABLED: 'false',
          SYNC_V2_AUTO_ENABLED: 'false',
        },
      });

      expect(reportDisabled.sucesso).toBe(false);
      expect(reportDisabled.erroGeral).toContain('SYNC_V2_DISABLED');

      const reportAutoDisabled = await runScheduledSyncV2({
        db: dummyDb,
        env: {
          SYNC_V2_ENABLED: 'true',
          SYNC_V2_AUTO_ENABLED: 'false',
        },
      });

      expect(reportAutoDisabled.sucesso).toBe(false);
      expect(reportAutoDisabled.erroGeral).toContain('SYNC_V2_AUTO_DISABLED');
    });

    it('GoogleSheetsRealAdapter com readOnly=true bloqueia chamadas de escrita antes de tocar na API', async () => {
      let fetchCalled = false;
      const mockFetch: typeof fetch = async () => {
        fetchCalled = true;
        return new Response('{}');
      };

      const readOnlyAdapter = new GoogleSheetsRealAdapter({
        tokenProvider: async () => 'test-token',
        fetchFn: mockFetch,
        readOnly: true,
      });

      const writeRes = await readOnlyAdapter.writeDocumentField({
        spreadsheetId: 'mock-sheet',
        tabName: HOMOLOG_TAB_NAMES.DOCS_FACE_FEA,
        groupKey: 'FACE_FEA',
        raText: '0090001001',
        fieldKey: 'identidade',
        preconditions: {
          targetKey: 'CONTROLE',
          expectedBefore: 'PENDENTE',
          fieldKey: 'identidade',
          cellCoordinate: 'C2',
          expectedNormalizedBefore: 0,
          expectedRawValueBefore: 'PENDENTE',
          expectedFingerprint: 'mock-fp',
        },
      });

      expect(writeRes.success).toBe(false);
      expect(writeRes.status).toBe('OUT_OF_BOUNDS');
      expect(writeRes.error).toContain('WRITE_BLOCKED_IN_READ_ONLY_MODE');
      expect(fetchCalled).toBe(false);
    });

    it('handleSyncV2AdminRoute bloqueia /dispatch em modo CAPTURE com erro explícito 409', async () => {
      const mockDb: any = {
        prepare: (sql: string) => ({
          bind: () => ({
            first: async () => {
              if (sql.includes('FROM sync_integrations')) {
                return {
                  integration_id: 'integ-cap',
                  periodo_id: 999,
                  mode: 'CAPTURE',
                  spreadsheet_id: 'sh-1',
                  epoch: 1,
                  layout_revision: 1,
                };
              }
              return null;
            },
            all: async () => ({ results: [{ name: 'sync_integrations' }, { name: 'sync_operations' }] }),
            run: async () => ({ meta: { changes: 1 } }),
          }),
          all: async () => ({ results: [{ name: 'sync_integrations' }, { name: 'sync_operations' }] }),
        }),
      };

      const res = await handleSyncV2AdminRoute({
        request: new Request('https://test/api/periodos/999/sync-v2/dispatch', { method: 'POST' }),
        url: new URL('https://test/api/periodos/999/sync-v2/dispatch'),
        db: mockDb,
        env: { SYNC_V2_ENABLED: 'true' },
        usuarioAtual: { perfil: 'ADMIN' } as any,
        podeEditar: true,
        registrarAuditoria: async () => {},
      });

      expect(res?.status).toBe(409);
      const data = await res?.json() as any;
      expect(data.erro).toBe('OUTBOUND_BLOQUEADO_EM_CAPTURE');
    });

    it('handleSyncV2AdminRoute executa /dispatch em modo SHADOW forçando dryRun sem mutação real', async () => {
      let writeCalled = false;
      const dummyAdapter: any = {
        writeDocumentField: async () => {
          writeCalled = true;
          return { success: true, status: 'COMMITTED' };
        },
      };

      const mockDb: any = {
        prepare: (sql: string) => ({
          bind: () => ({
            first: async () => {
              if (sql.includes('FROM sync_integrations')) {
                return {
                  integration_id: 'integ-shad',
                  periodo_id: 999,
                  mode: 'SHADOW',
                  spreadsheet_id: 'sh-1',
                  epoch: 1,
                  layout_revision: 1,
                };
              }
              if (sql.includes('FROM google_sheets_periodos')) {
                return null;
              }
              if (sql.includes('FROM sync_coordinator_leases')) {
                return null;
              }
              return null;
            },
            all: async () => {
              if (sql.includes('sqlite_master')) {
                return { results: [{ name: 'sync_integrations' }, { name: 'sync_operations' }] };
              }
              if (sql.includes('FROM sync_operations')) {
                return { results: [] };
              }
              return { results: [] };
            },
            run: async () => ({ meta: { changes: 1 } }),
          }),
          all: async () => ({ results: [{ name: 'sync_integrations' }, { name: 'sync_operations' }] }),
          run: async () => ({ meta: { changes: 1 } }),
          first: async () => null,
        }),
      };

      const res = await handleSyncV2AdminRoute({
        request: new Request('https://test/api/periodos/999/sync-v2/dispatch', { method: 'POST' }),
        url: new URL('https://test/api/periodos/999/sync-v2/dispatch'),
        db: mockDb,
        env: { SYNC_V2_ENABLED: 'true' },
        usuarioAtual: { perfil: 'ADMIN' } as any,
        podeEditar: true,
        registrarAuditoria: async () => {},
        customAdapter: dummyAdapter,
      });

      expect(res?.status).toBe(200);
      const data = await res?.json() as any;
      expect(data.sucesso).toBe(true);
      expect(data.batchResult.dryRun).toBe(true);
      expect(writeCalled).toBe(false);
    });

    it('recoverExpiredLeases aplica backoff defensivo de 10s e não permite re-claim imediato no mesmo segundo', async () => {
      let updatedState = '';
      let updatedNextAttempt = '';
      let updatedOwner: string | null = 'init';

      const mockDb: any = {
        prepare: (sql: string) => ({
          bind: (...args: any[]) => ({
            run: async () => {
              if (sql.includes("sync_operations") && sql.includes("RETRY_WAIT")) {
                updatedState = 'RETRY_WAIT';
                updatedOwner = null;
                const baseDate = new Date(args[0]);
                baseDate.setSeconds(baseDate.getSeconds() + 10);
                updatedNextAttempt = baseDate.toISOString().replace('T', ' ').slice(0, 19);
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            },
          }),
        }),
      };

      const now = '2026-10-21 00:00:00';
      const rec = await recoverExpiredLeases(mockDb, now);

      expect(rec.recoveredClaimed).toBe(1);
      expect(updatedState).toBe('RETRY_WAIT');
      expect(updatedOwner).toBeNull();
      expect(updatedNextAttempt).toBe('2026-10-21 00:00:10');

      const isEligibleAtNow = new Date(now).getTime() >= new Date(updatedNextAttempt).getTime();
      expect(isEligibleAtNow).toBe(false);

      const futureTime = '2026-10-21 00:00:10';
      const isEligibleAtFuture = new Date(futureTime).getTime() >= new Date(updatedNextAttempt).getTime();
      expect(isEligibleAtFuture).toBe(true);
    });

    it('handleSyncV2AdminRoute força dryRun=true em /inbound quando em modo SHADOW mesmo com dryRun=false no body', async () => {
      let dryRunRecebidoPeloReconciler: boolean | undefined;

      const mockDb: any = {
        prepare: (sql: string) => ({
          bind: () => ({
            first: async () => {
              if (sql.includes('FROM sync_integrations')) {
                return {
                  integration_id: 'integ-shad-inbound',
                  periodo_id: 999,
                  mode: 'SHADOW',
                  spreadsheet_id: 'sh-1',
                  epoch: 1,
                  layout_revision: 1,
                };
              }
              return null;
            },
            all: async () => ({ results: [] }),
            run: async () => ({ meta: { changes: 1 } }),
          }),
          all: async () => ({ results: [] }),
          run: async () => ({ meta: { changes: 1 } }),
          first: async () => null,
        }),
      };

      const mockAdapter: any = {
        readControlTab: async () => ({
          spreadsheetId: 'sh-1',
          tabName: 'CONTROLE DE DOCUMENTOS FACE FEA',
          groupKey: 'FACE_FEA',
          headerFingerprint: 'mock-fp',
          readAt: new Date().toISOString(),
          rowsByRa: new Map(),
        }),
        readGeneralTabContracts: async () => ({
          spreadsheetId: 'sh-1',
          tabName: 'BASE_FACE_FEA',
          readAt: new Date().toISOString(),
          rowsByRa: new Map(),
        }),
      };

      const res = await handleSyncV2AdminRoute({
        request: new Request('https://test/api/periodos/999/sync-v2/inbound', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dryRun: false }),
        }),
        url: new URL('https://test/api/periodos/999/sync-v2/inbound'),
        db: mockDb,
        env: { SYNC_V2_ENABLED: 'true' },
        usuarioAtual: { perfil: 'ADMIN', email: 'admin@test.local' } as any,
        podeEditar: true,
        registrarAuditoria: async (_p, ev) => {
          if (ev.descricao.includes('DRY-RUN')) {
            dryRunRecebidoPeloReconciler = true;
          } else if (ev.descricao.includes('REAL')) {
            dryRunRecebidoPeloReconciler = false;
          }
        },
        customAdapter: mockAdapter,
      });

      expect(res?.status).toBe(200);
      const data = await res?.json() as any;
      expect(data.sucesso).toBe(true);
      expect(data.report.dryRun).toBe(true);
      expect(dryRunRecebidoPeloReconciler).toBe(true);
    });

    it('runScheduledSyncV2 em modo SHADOW não realiza escrita externa e não consome operações da outbox', async () => {
      let adapterWriteCalls = 0;
      const mockAdapter: any = {
        writeDocumentField: async () => {
          adapterWriteCalls++;
          return { success: true, status: 'COMMITTED' };
        },
        readControlTab: async () => ({
          spreadsheetId: 'sh-shad',
          tabName: 'CONTROLE DE DOCUMENTOS FACE FEA',
          groupKey: 'FACE_FEA',
          headerFingerprint: 'fp',
          readAt: new Date().toISOString(),
          rowsByRa: new Map(),
        }),
        readGeneralTabContracts: async () => ({
          spreadsheetId: 'sh-shad',
          tabName: 'BASE_FACE_FEA',
          readAt: new Date().toISOString(),
          rowsByRa: new Map(),
        }),
      };

      const mockDb: any = {
        prepare: (sql: string) => ({
          bind: (...args: any[]) => ({
            first: async () => {
              if (sql.includes('FROM sync_integrations')) {
                return {
                  integration_id: 'integ-shad-sched',
                  periodo_id: 999,
                  mode: 'SHADOW',
                  spreadsheet_id: 'sh-shad',
                  epoch: 1,
                  layout_revision: 1,
                };
              }
              if (sql.includes('FROM sync_operations') && sql.includes('sync_records')) {
                return {
                  operation_id: 'op-outbox-1',
                  record_id: 'rec-1',
                  target_key: 'CONTROLE',
                  target_revision: 1,
                  field_key: 'identidade',
                  ra_text: '0090001001',
                  group_key: 'FACE_FEA',
                };
              }
              if (sql.includes('FROM sync_coordinator_leases')) {
                if (args.length > 1) {
                  return {
                    lease_owner: args[1],
                    lease_epoch: args[2],
                    lease_until: '2099-01-01T00:00:00Z',
                  };
                }
                return null;
              }
              return null;
            },
            all: async () => {
              if (sql.includes('FROM sync_integrations')) {
                return {
                  results: [
                    {
                      integration_id: 'integ-shad-sched',
                      periodo_id: 999,
                      mode: 'SHADOW',
                      spreadsheet_id: 'sh-shad',
                      epoch: 1,
                      layout_revision: 1,
                    },
                  ],
                };
              }
              if (sql.includes('FROM sync_operations')) {
                return {
                  results: [
                    {
                      operation_id: 'op-outbox-1',
                      record_id: 'rec-1',
                      target_key: 'CONTROLE',
                      target_revision: 1,
                      field_key: 'identidade',
                      ra_text: '0090001001',
                      group_key: 'FACE_FEA',
                    },
                  ],
                };
              }
              return { results: [] };
            },
            run: async () => ({ meta: { changes: 1 } }),
          }),
          all: async () => ({ results: [] }),
          run: async () => ({ meta: { changes: 1 } }),
          first: async () => null,
        }),
      };

      const result = await runScheduledSyncV2({
        db: mockDb,
        env: {
          SYNC_V2_ENABLED: 'true',
          SYNC_V2_AUTO_ENABLED: 'true',
        },
        targetPeriodoId: 999,
        customAdapter: mockAdapter,
      });

      expect(result.sucesso).toBe(true);
      expect(result.totalIntegracoesEncontradas).toBe(1);
      expect(result.integracoesExecutadas).toBe(1);
      const cycle = result.relatorios[0];
      expect(cycle.mode).toBe('SHADOW');
      expect(adapterWriteCalls).toBe(0);
      expect(cycle.outboundReport?.dryRun).toBe(true);
      expect(cycle.outboundReport?.simulatedCount).toBe(1);
      expect(cycle.outboundReport?.observedCount).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // 4. VERIFICAÇÃO ESTRITA (--strict-verify)
  // --------------------------------------------------------------------------
  describe('4. Modo --strict-verify Somente Leitura', () => {
    it('aprova uma planilha mockada com todas as 4 abas, fórmulas, checkboxes e dados em perfeita conformidade', async () => {
      // Mock da resposta rica da API sheets.get com includeGridData=true
      const mockSpreadsheetData = {
        sheets: [
          {
            properties: { title: HOMOLOG_TAB_NAMES.DOCS_FACE_FEA },
            data: [
              {
                rowData: [
                  {
                    values: EXPECTED_CONTROL_HEADERS.map((h) => ({ formattedValue: h })),
                  },
                  {
                    // ALFA: 6 entregues, contrato pendente
                    values: [
                      { formattedValue: '0090001001', userEnteredValue: { stringValue: '0090001001' } },
                      { formattedValue: 'ALUNO TESTE ALFA' },
                      { formattedValue: 'VERDADEIRO', effectiveValue: { boolValue: true }, dataValidation: { condition: { type: 'BOOLEAN' } } },
                      { formattedValue: 'VERDADEIRO', effectiveValue: { boolValue: true }, dataValidation: { condition: { type: 'BOOLEAN' } } },
                      { formattedValue: 'VERDADEIRO', effectiveValue: { boolValue: true }, dataValidation: { condition: { type: 'BOOLEAN' } } },
                      { formattedValue: 'VERDADEIRO', effectiveValue: { boolValue: true }, dataValidation: { condition: { type: 'BOOLEAN' } } },
                      { formattedValue: 'VERDADEIRO', effectiveValue: { boolValue: true }, dataValidation: { condition: { type: 'BOOLEAN' } } },
                      { formattedValue: 'VERDADEIRO', effectiveValue: { boolValue: true }, dataValidation: { condition: { type: 'BOOLEAN' } } },
                      { formattedValue: 'FALSO', effectiveValue: { boolValue: false }, dataValidation: { condition: { type: 'BOOLEAN' } } },
                      { formattedValue: '6', userEnteredValue: { formulaValue: '=CONT.SE(C2:I2; VERDADEIRO)' } },
                      { formattedValue: 'PENDENTE', userEnteredValue: { formulaValue: '=SE(J2=7; "COMPLETO"; "PENDENTE")' } },
                    ],
                  },
                  {
                    // BETA: 0 entregues
                    values: [
                      { formattedValue: '0090001002', userEnteredValue: { stringValue: '0090001002' } },
                      { formattedValue: 'ALUNO TESTE BETA' },
                      { formattedValue: 'FALSO', effectiveValue: { boolValue: false }, dataValidation: { condition: { type: 'BOOLEAN' } } },
                      { formattedValue: 'FALSO', effectiveValue: { boolValue: false }, dataValidation: { condition: { type: 'BOOLEAN' } } },
                      { formattedValue: 'FALSO', effectiveValue: { boolValue: false }, dataValidation: { condition: { type: 'BOOLEAN' } } },
                      { formattedValue: 'FALSO', effectiveValue: { boolValue: false }, dataValidation: { condition: { type: 'BOOLEAN' } } },
                      { formattedValue: 'FALSO', effectiveValue: { boolValue: false }, dataValidation: { condition: { type: 'BOOLEAN' } } },
                      { formattedValue: 'FALSO', effectiveValue: { boolValue: false }, dataValidation: { condition: { type: 'BOOLEAN' } } },
                      { formattedValue: 'FALSO', effectiveValue: { boolValue: false }, dataValidation: { condition: { type: 'BOOLEAN' } } },
                      { formattedValue: '0', userEnteredValue: { formulaValue: '=CONT.SE(C3:I3; VERDADEIRO)' } },
                      { formattedValue: 'PENDENTE', userEnteredValue: { formulaValue: '=SE(J3=7; "COMPLETO"; "PENDENTE")' } },
                    ],
                  },
                ],
              },
            ],
          },
          {
            properties: { title: HOMOLOG_TAB_NAMES.DOCS_FCH_EAD },
            data: [
              {
                rowData: [
                  { values: EXPECTED_CONTROL_HEADERS.map((h) => ({ formattedValue: h })) },
                  {
                    // GAMA: 4 entregues
                    values: [
                      { formattedValue: '0090002001', userEnteredValue: { stringValue: '0090002001' } },
                      { formattedValue: 'ALUNO TESTE GAMA' },
                      { formattedValue: 'VERDADEIRO', effectiveValue: { boolValue: true }, dataValidation: { condition: { type: 'BOOLEAN' } } },
                      { formattedValue: 'VERDADEIRO', effectiveValue: { boolValue: true }, dataValidation: { condition: { type: 'BOOLEAN' } } },
                      { formattedValue: 'FALSO', effectiveValue: { boolValue: false }, dataValidation: { condition: { type: 'BOOLEAN' } } },
                      { formattedValue: 'VERDADEIRO', effectiveValue: { boolValue: true }, dataValidation: { condition: { type: 'BOOLEAN' } } },
                      { formattedValue: 'FALSO', effectiveValue: { boolValue: false }, dataValidation: { condition: { type: 'BOOLEAN' } } },
                      { formattedValue: 'VERDADEIRO', effectiveValue: { boolValue: true }, dataValidation: { condition: { type: 'BOOLEAN' } } },
                      { formattedValue: 'FALSO', effectiveValue: { boolValue: false }, dataValidation: { condition: { type: 'BOOLEAN' } } },
                      { formattedValue: '4', userEnteredValue: { formulaValue: '=CONT.SE(C2:I2; VERDADEIRO)' } },
                      { formattedValue: 'PENDENTE', userEnteredValue: { formulaValue: '=SE(J2=7; "COMPLETO"; "PENDENTE")' } },
                    ],
                  },
                  {
                    // DELTA: 7 entregues
                    values: [
                      { formattedValue: '0090002002', userEnteredValue: { stringValue: '0090002002' } },
                      { formattedValue: 'ALUNO TESTE DELTA' },
                      { formattedValue: 'VERDADEIRO', effectiveValue: { boolValue: true }, dataValidation: { condition: { type: 'BOOLEAN' } } },
                      { formattedValue: 'VERDADEIRO', effectiveValue: { boolValue: true }, dataValidation: { condition: { type: 'BOOLEAN' } } },
                      { formattedValue: 'VERDADEIRO', effectiveValue: { boolValue: true }, dataValidation: { condition: { type: 'BOOLEAN' } } },
                      { formattedValue: 'VERDADEIRO', effectiveValue: { boolValue: true }, dataValidation: { condition: { type: 'BOOLEAN' } } },
                      { formattedValue: 'VERDADEIRO', effectiveValue: { boolValue: true }, dataValidation: { condition: { type: 'BOOLEAN' } } },
                      { formattedValue: 'VERDADEIRO', effectiveValue: { boolValue: true }, dataValidation: { condition: { type: 'BOOLEAN' } } },
                      { formattedValue: 'VERDADEIRO', effectiveValue: { boolValue: true }, dataValidation: { condition: { type: 'BOOLEAN' } } },
                      { formattedValue: '7', userEnteredValue: { formulaValue: '=CONT.SE(C3:I3; VERDADEIRO)' } },
                      { formattedValue: 'COMPLETO', userEnteredValue: { formulaValue: '=SE(J3=7; "COMPLETO"; "PENDENTE")' } },
                    ],
                  },
                ],
              },
            ],
          },
          {
            properties: { title: HOMOLOG_TAB_NAMES.BASE_FACE_FEA },
            data: [
              {
                rowData: [
                  { values: EXPECTED_BASE_HEADERS.map((h) => ({ formattedValue: h })) },
                  {
                    values: [
                      { formattedValue: 'PENDENTE' },
                      { formattedValue: 'ADMINISTRAÇÃO' },
                      { formattedValue: 'NOTURNO' },
                      { formattedValue: 'PRESENCIAL' },
                      { formattedValue: 'ALUNO TESTE ALFA' },
                      { formattedValue: '000.000.001-99' },
                      { formattedValue: '0090001001' },
                    ],
                  },
                  {
                    values: [
                      { formattedValue: 'PENDENTE' },
                      { formattedValue: 'CIÊNCIAS CONTÁBEIS' },
                      { formattedValue: 'NOTURNO' },
                      { formattedValue: 'PRESENCIAL' },
                      { formattedValue: 'ALUNO TESTE BETA' },
                      { formattedValue: '000.000.002-99' },
                      { formattedValue: '0090001002' },
                    ],
                  },
                ],
              },
            ],
          },
          {
            properties: { title: HOMOLOG_TAB_NAMES.BASE_FCH_EAD },
            data: [
              {
                rowData: [
                  { values: EXPECTED_BASE_HEADERS.map((h) => ({ formattedValue: h })) },
                  {
                    values: [
                      { formattedValue: 'PENDENTE' },
                      { formattedValue: 'PEDAGOGIA' },
                      { formattedValue: 'EAD' },
                      { formattedValue: 'DISTÂNCIA' },
                      { formattedValue: 'ALUNO TESTE GAMA' },
                      { formattedValue: '000.000.003-99' },
                      { formattedValue: '0090002001' },
                    ],
                  },
                  {
                    values: [
                      { formattedValue: 'ACEITO' },
                      { formattedValue: 'LETRAS EAD' },
                      { formattedValue: 'EAD' },
                      { formattedValue: 'DISTÂNCIA' },
                      { formattedValue: 'ALUNO TESTE DELTA' },
                      { formattedValue: '000.000.004-99' },
                      { formattedValue: '0090002002' },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      const mockFetch: typeof fetch = async () => {
        return new Response(JSON.stringify(mockSpreadsheetData), { status: 200 });
      };

      const result = await verifySpreadsheetStrict({
        spreadsheetId: 'test-strict-valid',
        tokenProvider: async () => 'test-token',
        templateContent: template,
        fetchFn: mockFetch,
      });

      expect(result.success).toBe(true);
      expect(result.checks.divergencias).toHaveLength(0);
      expect(result.checks.itemsValidated).toBeGreaterThan(30);
    });

    it('detecta divergências em fórmulas e checkboxes faltantes sem alterar células', async () => {
      // Mock com fórmula ausente em J2 e sem checkbox
      const corruptedData = {
        sheets: [
          {
            properties: { title: HOMOLOG_TAB_NAMES.DOCS_FACE_FEA },
            data: [
              {
                rowData: [
                  { values: EXPECTED_CONTROL_HEADERS.map((h) => ({ formattedValue: h })) },
                  {
                    values: [
                      { formattedValue: '0090001001' },
                      { formattedValue: 'ALUNO TESTE ALFA' },
                      // Célula sem dataValidation BOOLEAN
                      { formattedValue: 'VERDADEIRO', effectiveValue: { boolValue: true } },
                      { formattedValue: 'VERDADEIRO', effectiveValue: { boolValue: true } },
                      { formattedValue: 'VERDADEIRO', effectiveValue: { boolValue: true } },
                      { formattedValue: 'VERDADEIRO', effectiveValue: { boolValue: true } },
                      { formattedValue: 'VERDADEIRO', effectiveValue: { boolValue: true } },
                      { formattedValue: 'VERDADEIRO', effectiveValue: { boolValue: true } },
                      { formattedValue: 'FALSO', effectiveValue: { boolValue: false } },
                      // Fórmula ausente em J2
                      { formattedValue: '6', userEnteredValue: { numberValue: 6 } },
                      { formattedValue: 'PENDENTE', userEnteredValue: { stringValue: 'PENDENTE' } },
                    ],
                  },
                  {
                    values: [
                      { formattedValue: '0090001002' },
                      { formattedValue: 'ALUNO TESTE BETA' },
                      { formattedValue: 'FALSO', effectiveValue: { boolValue: false } },
                      { formattedValue: 'FALSO', effectiveValue: { boolValue: false } },
                      { formattedValue: 'FALSO', effectiveValue: { boolValue: false } },
                      { formattedValue: 'FALSO', effectiveValue: { boolValue: false } },
                      { formattedValue: 'FALSO', effectiveValue: { boolValue: false } },
                      { formattedValue: 'FALSO', effectiveValue: { boolValue: false } },
                      { formattedValue: 'FALSO', effectiveValue: { boolValue: false } },
                      { formattedValue: '0', userEnteredValue: { numberValue: 0 } },
                      { formattedValue: 'PENDENTE', userEnteredValue: { stringValue: 'PENDENTE' } },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      const mockFetch: typeof fetch = async () => {
        return new Response(JSON.stringify(corruptedData), { status: 200 });
      };

      const result = await verifySpreadsheetStrict({
        spreadsheetId: 'test-strict-corrupted',
        tokenProvider: async () => 'test-token',
        templateContent: template,
        fetchFn: mockFetch,
      });

      expect(result.success).toBe(false);
      expect(result.checks.divergencias.length).toBeGreaterThan(0);
      // Aponta abas ausentes e fórmulas não encontradas
      expect(result.checks.divergencias.some((d) => d.includes('Fórmula ausente ou incorreta em J2'))).toBe(true);
      expect(result.checks.divergencias.some((d) => d.includes('Aba requerida ausente'))).toBe(true);
    });
  });
});
