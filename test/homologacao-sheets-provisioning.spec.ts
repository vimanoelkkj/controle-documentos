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
} from '../scripts/homologacao/provisionar-sheets-homologacao.mjs';
import {
  GoogleSheetsRealAdapter,
  GoogleSheetsNotFoundError,
} from '../src/server/services/sync-sheet-real-adapter';
import { runScheduledSyncV2 } from '../src/server/services/sync-coordinator';
import { normalizeDocumentCellValue } from '../src/server/services/sync-sheet-contracts';

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
  });
});
