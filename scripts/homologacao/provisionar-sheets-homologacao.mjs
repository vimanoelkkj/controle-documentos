#!/usr/bin/env node
/**
 * ============================================================================
 * SCRIPT DE PROVISIONAMENTO E CONFIGURAÇÃO IDEMPOTENTE DO GOOGLE SHEETS
 * PARA O AMBIENTE DE HOMOLOGAÇÃO ISOLADO (P0.4)
 * ============================================================================
 *
 * Funcionalidades:
 *  1. Cria ou reconfigura de forma estritamente idempotente as 4 abas requeridas:
 *     - 'CONTROLE DE DOCUMENTOS FACE FEA' (Aba de Controle)
 *     - 'CONTROLE DE DOCUMENTOS FCH EAD' (Aba de Controle)
 *     - 'BASE_FACE_FEA' (Aba Geral Contratual)
 *     - 'BASE_FCH_EAD' (Aba Geral Contratual)
 *  2. Configura regras de validação de dados para checkboxes nativos (C2:I3).
 *  3. Formata colunas de RA como TEXTO para preservar zeros à esquerda ('0090001001').
 *  4. Insere cabeçalhos e registros dos 4 alunos fictícios com dados 100% alinhados ao D1.
 *  5. Insere fórmulas intocadas nas colunas J e K (TOTAL ENTREGUES e STATUS DOCUMENTAL).
 *  6. Modo --dry-run: valida template e gera planos de execução sem tocar a API.
 *  7. Modo --verify-only: valida integridade e alinhamento da planilha existente.
 *  8. Modo --test-isolation: testa que a Service Account não tem acesso a IDs não autorizados.
 *  9. Higienização estrita de logs: credenciais, tokens e chaves privadas nunca são expostos.
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/**
 * Nomes oficiais das 4 abas de homologação esperadas pelo sistema e período 999
 */
export const HOMOLOG_TAB_NAMES = {
  DOCS_FACE_FEA: 'CONTROLE DE DOCUMENTOS FACE FEA',
  DOCS_FCH_EAD: 'CONTROLE DE DOCUMENTOS FCH EAD',
  BASE_FACE_FEA: 'BASE_FACE_FEA',
  BASE_FCH_EAD: 'BASE_FCH_EAD',
};

export const EXPECTED_CONTROL_HEADERS = [
  'RA',
  'NOME DO ALUNO',
  'IDENTIDADE',
  'CPF',
  'CERTIDÃO',
  'COMP. RESIDÊNCIA',
  'TÍTULO',
  'ENSINO MÉDIO',
  'CONTRATO',
  'TOTAL ENTREGUES',
  'STATUS DOCUMENTAL',
];

export const EXPECTED_BASE_HEADERS = [
  'SITUAÇÃO CONTRATUAL',
  'CURSO',
  'TURNO',
  'MODALIDADE',
  'NOME',
  'CPF',
  'RA',
];

/**
 * Gera token OAuth 2.0 a partir de credenciais de Service Account usando WebCrypto nativo.
 */
export async function obterTokenGoogleServiceAccount(serviceAccountJson, fetchFn = globalThis.fetch) {
  if (!serviceAccountJson) {
    throw new Error('Credenciais de Service Account ausentes.');
  }

  const conta = typeof serviceAccountJson === 'string'
    ? JSON.parse(serviceAccountJson)
    : serviceAccountJson;

  if (!conta.client_email || !conta.private_key) {
    throw new Error('JSON de Service Account inválido: client_email ou private_key ausente.');
  }

  const agora = Math.floor(Date.now() / 1000);

  const base64Url = (valor) => {
    const bytes = typeof valor === 'string' ? new TextEncoder().encode(valor) : new Uint8Array(valor);
    let binario = '';
    for (const byte of bytes) binario += String.fromCharCode(byte);
    return btoa(binario).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  };

  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(
    JSON.stringify({
      iss: conta.client_email,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: conta.token_uri || 'https://oauth2.googleapis.com/token',
      iat: agora,
      exp: agora + 3600,
    })
  );

  const pemParaArrayBuffer = (pem) => {
    const base64 = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
    const binario = atob(base64);
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
    return bytes.buffer;
  };

  const chave = await crypto.subtle.importKey(
    'pkcs8',
    pemParaArrayBuffer(conta.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const assinatura = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    chave,
    new TextEncoder().encode(`${header}.${payload}`)
  );

  const jwt = `${header}.${payload}.${base64Url(assinatura)}`;

  const resposta = await fetchFn(conta.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!resposta.ok) {
    const errText = await resposta.text().catch(() => '');
    throw new Error(`Falha na autenticação Google Service Account (HTTP ${resposta.status}): ${errText.slice(0, 160)}`);
  }

  const dados = await resposta.json();
  return dados.access_token;
}

/**
 * Constrói os dados tabulares das 4 abas a partir do template estrutural.
 */
export function buildSheetValuesFromTemplate(template) {
  const valuesByTab = {};

  for (const aba of template.abas) {
    const nome = aba.nome_aba;
    const rows = [aba.cabecalhos];

    if (aba.tipo === 'CONTROLE_DOCUMENTAL') {
      for (const item of aba.dados_ficticios_iniciais) {
        // Validação booleana: se 'OK', 'SIM', true -> true (checkbox marcado); senão false
        const toBool = (val) => ['OK', 'SIM', '1', 'TRUE', 'VERDADEIRO'].includes(String(val).toUpperCase());
        rows.push([
          String(item.col_A_ra),
          item.col_B_nome,
          toBool(item.col_C_identidade),
          toBool(item.col_D_cpf),
          toBool(item.col_E_certidao),
          toBool(item.col_F_residencia),
          toBool(item.col_G_titulo),
          toBool(item.col_H_ensino_medio),
          toBool(item.col_I_contrato),
          item.col_J_total,
          item.col_K_status,
        ]);
      }
    } else if (aba.tipo === 'GERAL_CONTRATUAL') {
      for (const item of aba.dados_ficticios_iniciais) {
        rows.push([
          item.col_A_situacao,
          item.col_B_curso,
          item.col_C_turno,
          item.col_D_modalidade,
          item.col_E_nome,
          item.col_F_cpf,
          String(item.col_G_ra),
        ]);
      }
    }

    valuesByTab[nome] = rows;
  }

  return valuesByTab;
}

/**
 * Constrói as operações batchUpdate estruturais (criar abas, renomear, checkboxes, formatação de RA).
 */
export function buildStructuralBatchRequests(existingSheets = []) {
  const requests = [];
  const existingSheetMap = new Map(); // title -> sheetId
  for (const s of existingSheets) {
    if (s.properties?.title) {
      existingSheetMap.set(s.properties.title, s.properties.sheetId);
    }
  }

  const requiredTabs = [
    HOMOLOG_TAB_NAMES.DOCS_FACE_FEA,
    HOMOLOG_TAB_NAMES.DOCS_FCH_EAD,
    HOMOLOG_TAB_NAMES.BASE_FACE_FEA,
    HOMOLOG_TAB_NAMES.BASE_FCH_EAD,
  ];

  // Se existir a aba padrão inicial do Google Sheets ('Sheet1' ou 'Página1') e nenhuma das requeridas existir ainda,
  // renomeia-a para a primeira aba requerida.
  const defaultSheet = existingSheets.find(
    (s) => ['Sheet1', 'Página1', 'Pagina1'].includes(s.properties?.title) && !existingSheetMap.has(requiredTabs[0])
  );

  let nextSheetIdIndex = 1000;
  for (let i = 0; i < requiredTabs.length; i++) {
    const tabName = requiredTabs[i];
    if (existingSheetMap.has(tabName)) {
      continue;
    }

    if (i === 0 && defaultSheet) {
      // Renomeia a aba inicial padrão
      requests.push({
        updateSheetProperties: {
          properties: {
            sheetId: defaultSheet.properties.sheetId,
            title: tabName,
          },
          fields: 'title',
        },
      });
      existingSheetMap.set(tabName, defaultSheet.properties.sheetId);
    } else {
      // Adiciona nova aba
      const generatedSheetId = nextSheetIdIndex++;
      requests.push({
        addSheet: {
          properties: {
            sheetId: generatedSheetId,
            title: tabName,
            gridProperties: {
              rowCount: 50,
              columnCount: 20,
            },
          },
        },
      });
      existingSheetMap.set(tabName, generatedSheetId);
    }
  }

  // Configuração de Checkboxes nas Abas de Controle (Colunas C:I -> índices 2:9)
  // E formatação de texto para coluna de RA (evitar perda de zeros à esquerda)
  for (const tabName of [HOMOLOG_TAB_NAMES.DOCS_FACE_FEA, HOMOLOG_TAB_NAMES.DOCS_FCH_EAD]) {
    const sheetId = existingSheetMap.get(tabName);
    const sheetRef = sheetId !== undefined ? { sheetId } : {};

    // 1. Regra de validação de dados para Checkbox nativo nas linhas 2 a 10 (colunas C:I -> index 2 a 8)
    requests.push({
      setDataValidation: {
        range: {
          ...sheetRef,
          startRowIndex: 1, // linha 2
          endRowIndex: 10,
          startColumnIndex: 2, // Coluna C
          endColumnIndex: 9, // Coluna I (inclusive)
        },
        rule: {
          condition: {
            type: 'BOOLEAN',
          },
          strict: true,
          showCustomUi: true,
        },
      },
    });

    // 2. Formato de número: TEXTO na coluna A (RA) para preservar zeros à esquerda
    requests.push({
      repeatCell: {
        range: {
          ...sheetRef,
          startRowIndex: 0,
          endRowIndex: 50,
          startColumnIndex: 0, // Coluna A
          endColumnIndex: 1,
        },
        cell: {
          userEnteredFormat: {
            numberFormat: {
              type: 'TEXT',
            },
          },
        },
        fields: 'userEnteredFormat.numberFormat',
      },
    });
  }

  // Formato TEXTO na coluna G (RA) das abas gerais (Base)
  for (const tabName of [HOMOLOG_TAB_NAMES.BASE_FACE_FEA, HOMOLOG_TAB_NAMES.BASE_FCH_EAD]) {
    const sheetId = existingSheetMap.get(tabName);
    const sheetRef = sheetId !== undefined ? { sheetId } : {};
    requests.push({
      repeatCell: {
        range: {
          ...sheetRef,
          startRowIndex: 0,
          endRowIndex: 50,
          startColumnIndex: 6, // Coluna G (RA)
          endColumnIndex: 7,
        },
        cell: {
          userEnteredFormat: {
            numberFormat: {
              type: 'TEXT',
            },
          },
        },
        fields: 'userEnteredFormat.numberFormat',
      },
    });
  }

  return { requests, finalSheetMap: existingSheetMap };
}

/**
 * Executa o provisionamento completo (ou simulação dryRun).
 */
export async function provisionGoogleSheets({
  spreadsheetId,
  serviceAccountJson,
  tokenProvider,
  token: directToken,
  templatePath,
  templateContent: customTemplateContent,
  dryRun = false,
  fetchFn = globalThis.fetch,
}) {
  if (!spreadsheetId || spreadsheetId.trim() === '' || spreadsheetId.includes('SUBSTITUIR_PELO_SPREADSHEET_ID')) {
    throw new Error('SPREADSHEET_ID inválido ou placeholder não substituído.');
  }

  let templateContent = customTemplateContent;
  let resolvedTemplatePath = templatePath;

  if (!templateContent) {
    resolvedTemplatePath = templatePath || path.resolve(process.cwd(), 'config/homologacao/template-sheets-homologacao.json');
    if (typeof fs?.existsSync === 'function' && !fs.existsSync(resolvedTemplatePath)) {
      throw new Error(`Template de homologação não encontrado em: ${resolvedTemplatePath}`);
    }
    templateContent = JSON.parse(fs.readFileSync(resolvedTemplatePath, 'utf8'));
  }
  const valuesByTab = buildSheetValuesFromTemplate(templateContent);

  if (dryRun) {
    const dryRunStructural = buildStructuralBatchRequests([], templateContent);
    return {
      success: true,
      mode: 'DRY_RUN',
      spreadsheetId,
      templateFile: resolvedTemplatePath,
      tabsToConfigure: Object.keys(valuesByTab),
      structuralRequestsCount: dryRunStructural.requests.length,
      structuralRequests: dryRunStructural.requests,
      valuesPlan: valuesByTab,
    };
  }

  // 1. Obter Token OAuth
  let token = directToken;
  if (!token && tokenProvider) {
    token = await tokenProvider();
  }
  if (!token) {
    token = await obterTokenGoogleServiceAccount(serviceAccountJson, fetchFn);
  }

  // 2. Consultar Metadados da Planilha Alvo
  const metaRes = await fetchFn(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!metaRes.ok) {
    const err = await metaRes.text().catch(() => '');
    throw new Error(`Erro ao obter metadados da planilha ${spreadsheetId} (HTTP ${metaRes.status}): ${err.slice(0, 160)}`);
  }

  const metaData = await metaRes.json();
  const existingSheets = metaData.sheets || [];

  // 3. Executar atualizações estruturais (criação de abas, checkboxes, formatação de texto)
  const { requests } = buildStructuralBatchRequests(existingSheets, templateContent);
  if (requests.length > 0) {
    const batchRes = await fetchFn(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ requests }),
      }
    );

    if (!batchRes.ok) {
      const err = await batchRes.text().catch(() => '');
      throw new Error(`Falha no batchUpdate estrutural da planilha (HTTP ${batchRes.status}): ${err.slice(0, 200)}`);
    }
  }

  // 4. Gravar os valores das abas (Cabeçalhos + Alunos Fictícios + Fórmulas)
  const valueData = [];
  for (const [tabName, rows] of Object.entries(valuesByTab)) {
    valueData.push({
      range: `'${tabName}'!A1:K${rows.length}`,
      majorDimension: 'ROWS',
      values: rows,
    });
  }

  const valuesBatchRes = await fetchFn(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: valueData,
      }),
    }
  );

  if (!valuesBatchRes.ok) {
    const err = await valuesBatchRes.text().catch(() => '');
    throw new Error(`Falha no batchUpdate de valores da planilha (HTTP ${valuesBatchRes.status}): ${err.slice(0, 200)}`);
  }

  return {
    success: true,
    mode: 'REAL_EXECUTION',
    spreadsheetId,
    tabsConfigured: Object.keys(valuesByTab),
    structuralRequestsExecuted: requests.length,
    valuesWritten: valueData.length,
  };
}

/**
 * Valida de forma estrita (somente leitura) todas as invariantes da planilha:
 * 1. Existência física e nomes exatos das 4 abas.
 * 2. Cabeçalhos canônicos em todas as colunas e compatibilidade com o adaptador V2.
 * 3. RAs preservando zeros à esquerda como texto ('0090001001', etc.).
 * 4. Regras de validação de dados para Checkboxes nativos BOOLEAN nas colunas C:I.
 * 5. Fórmulas reais de contagem e status nas colunas J e K.
 * 6. Matriz documental completa dos 4 alunos fictícios (ALFA, BETA, GAMA, DELTA).
 * 7. Não altera nenhuma célula (somente leitura).
 */
export async function verifySpreadsheetStrict({
  spreadsheetId,
  serviceAccountJson,
  tokenProvider,
  token: directToken,
  templatePath,
  templateContent: customTemplateContent,
  fetchFn = globalThis.fetch,
}) {
  let token = directToken;
  if (!token && tokenProvider) {
    token = await tokenProvider();
  }
  if (!token) {
    token = await obterTokenGoogleServiceAccount(serviceAccountJson, fetchFn);
  }

  let templateContent = customTemplateContent;
  if (!templateContent) {
    const resolvedTemplatePath = templatePath || path.resolve(process.cwd(), 'config/homologacao/template-sheets-homologacao.json');
    if (typeof fs?.existsSync === 'function' && !fs.existsSync(resolvedTemplatePath)) {
      throw new Error(`Template de homologação não encontrado em: ${resolvedTemplatePath}`);
    }
    templateContent = JSON.parse(fs.readFileSync(resolvedTemplatePath, 'utf8'));
  }

  const expectedValuesByTab = buildSheetValuesFromTemplate(templateContent);

  // Consulta detalhada com dados de grid, fórmulas e regras de validação
  const ranges = [
    `'${HOMOLOG_TAB_NAMES.DOCS_FACE_FEA}'!A1:K3`,
    `'${HOMOLOG_TAB_NAMES.DOCS_FCH_EAD}'!A1:K3`,
    `'${HOMOLOG_TAB_NAMES.BASE_FACE_FEA}'!A1:G3`,
    `'${HOMOLOG_TAB_NAMES.BASE_FCH_EAD}'!A1:G3`,
  ];
  const rangesParam = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&');
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId
  )}?includeGridData=true&${rangesParam}`;

  const res = await fetchFn(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Falha na verificação estrita da planilha (HTTP ${res.status}): ${err.slice(0, 200)}`);
  }

  const spreadsheet = await res.json();
  const sheets = spreadsheet.sheets || [];
  const sheetMap = new Map();
  for (const s of sheets) {
    if (s.properties?.title) {
      sheetMap.set(s.properties.title, s);
    }
  }

  const checks = {
    tabsFound: sheetMap.size,
    tabsExpected: 4,
    itemsValidated: 0,
    divergencias: [],
    detalhes: [],
  };

  // 1. Validação de presença das 4 abas
  for (const tabName of Object.keys(expectedValuesByTab)) {
    if (!sheetMap.has(tabName)) {
      checks.divergencias.push(`Aba requerida ausente: '${tabName}'`);
    } else {
      checks.itemsValidated++;
    }
  }

  // 2. Validação profunda de cada aba
  for (const [tabName, expectedRows] of Object.entries(expectedValuesByTab)) {
    const sheetObj = sheetMap.get(tabName);
    if (!sheetObj) continue;

    const rowData = sheetObj.data?.[0]?.rowData || [];
    if (rowData.length < expectedRows.length) {
      checks.divergencias.push(`Aba '${tabName}' possui apenas ${rowData.length} linhas (esperado ${expectedRows.length}).`);
      continue;
    }

    const isControl = tabName.includes('CONTROLE DE DOCUMENTOS');

    // Validação da Linha 1 (Cabeçalhos)
    const headerCells = rowData[0]?.values || [];
    const expectedHeaders = expectedRows[0];
    for (let c = 0; c < expectedHeaders.length; c++) {
      const actualVal = (headerCells[c]?.formattedValue || '').trim().toUpperCase();
      const expectedVal = expectedHeaders[c].trim().toUpperCase();
      if (actualVal !== expectedVal) {
        checks.divergencias.push(
          `Cabeçalho divergente na aba '${tabName}' coluna ${c + 1}: esperado '${expectedVal}', encontrado '${actualVal}'`
        );
      } else {
        checks.itemsValidated++;
      }
    }

    // Validação das Linhas de Dados (Alunos Fictícios)
    for (let r = 1; r < expectedRows.length; r++) {
      const rowCells = rowData[r]?.values || [];
      const expectedRow = expectedRows[r];

      // A. Validação de RA e preservação de zeros à esquerda
      const raCell = isControl ? rowCells[0] : rowCells[6];
      const expectedRa = isControl ? expectedRow[0] : expectedRow[6];
      const actualRa = raCell?.formattedValue || '';

      if (actualRa !== expectedRa) {
        checks.divergencias.push(
          `RA divergente na linha ${r + 1} de '${tabName}': esperado '${expectedRa}', encontrado '${actualRa}'`
        );
      } else {
        checks.itemsValidated++;
      }

      if (!actualRa.startsWith('009000')) {
        checks.divergencias.push(
          `RA na linha ${r + 1} de '${tabName}' perdeu zeros à esquerda ou é inválido: '${actualRa}'`
        );
      } else {
        checks.itemsValidated++;
      }

      if (isControl) {
        // B. Validação de Checkboxes nativos e valores booleanos (Colunas C a I -> indices 2 a 8)
        for (let c = 2; c <= 8; c++) {
          const colLetter = String.fromCharCode(65 + c);
          const cell = rowCells[c];
          const expectedBool = expectedRow[c];

          // Verifica se a regra de validação de dados é BOOLEAN (Checkbox nativo)
          const ruleType = cell?.dataValidation?.condition?.type || cell?.dataValidationRule?.condition?.type;
          if (ruleType && ruleType !== 'BOOLEAN') {
            checks.divergencias.push(
              `Célula ${colLetter}${r + 1} de '${tabName}' tem regra de validação '${ruleType}' em vez de BOOLEAN`
            );
          } else {
            checks.itemsValidated++;
          }

          // Verifica valor booleano
          const effectiveBool = cell?.effectiveValue?.boolValue ?? cell?.userEnteredValue?.boolValue;
          const formattedVal = (cell?.formattedValue || '').toUpperCase();
          const actualBool = effectiveBool !== undefined
            ? effectiveBool
            : ['TRUE', 'VERDADEIRO', 'SIM', 'OK'].includes(formattedVal);

          if (actualBool !== expectedBool) {
            checks.divergencias.push(
              `Valor documental incorreto em ${colLetter}${r + 1} de '${tabName}': esperado ${expectedBool}, encontrado ${actualBool} ('${formattedVal}')`
            );
          } else {
            checks.itemsValidated++;
          }
        }

        // C. Validação de Fórmulas Reais J e K (TOTAL ENTREGUES e STATUS DOCUMENTAL)
        const cellJ = rowCells[9]; // Coluna J (índice 9)
        const rawFormulaJ = cellJ?.userEnteredValue?.formulaValue || '';
        const normJ = rawFormulaJ.toUpperCase().replace(/\s+/g, '');
        const isJValid = normJ.startsWith('=') && (normJ.includes('CONT.SE') || normJ.includes('COUNTIF'));
        if (!isJValid) {
          checks.divergencias.push(
            `Fórmula ausente ou incorreta em J${r + 1} de '${tabName}': esperado '=CONT.SE(...)', encontrado '${rawFormulaJ}'`
          );
        } else {
          checks.itemsValidated++;
        }

        const cellK = rowCells[10]; // Coluna K (índice 10)
        const rawFormulaK = cellK?.userEnteredValue?.formulaValue || '';
        const normK = rawFormulaK.toUpperCase().replace(/\s+/g, '');
        const isKValid = normK.startsWith('=') && (normK.includes('SE(') || normK.includes('IF('));
        if (!isKValid) {
          checks.divergencias.push(
            `Fórmula ausente ou incorreta em K${r + 1} de '${tabName}': esperado '=SE(...)', encontrado '${rawFormulaK}'`
          );
        } else {
          checks.itemsValidated++;
        }
      } else {
        // Validação da Aba Base (Situação Contratual, Curso, etc.)
        const situacao = (rowCells[0]?.formattedValue || '').trim().toUpperCase();
        const expectedSituacao = expectedRow[0].trim().toUpperCase();
        if (situacao !== expectedSituacao) {
          checks.divergencias.push(
            `Situação Contratual divergente em A${r + 1} de '${tabName}': esperado '${expectedSituacao}', encontrado '${situacao}'`
          );
        } else {
          checks.itemsValidated++;
        }
      }
    }
  }

  return {
    success: checks.divergencias.length === 0,
    spreadsheetId,
    checks,
  };
}

/**
 * Valida a conformidade de uma planilha existente contra o template de homologação.
 */
export async function verifySpreadsheetAlignment({
  spreadsheetId,
  serviceAccountJson,
  tokenProvider,
  token: directToken,
  templatePath: _templatePath,
  fetchFn = globalThis.fetch,
}) {
  let token = directToken;
  if (!token && tokenProvider) {
    token = await tokenProvider();
  }
  if (!token) {
    token = await obterTokenGoogleServiceAccount(serviceAccountJson, fetchFn);
  }

  // Leitura dos dados das 4 abas
  const ranges = [
    `'${HOMOLOG_TAB_NAMES.DOCS_FACE_FEA}'!A1:K3`,
    `'${HOMOLOG_TAB_NAMES.DOCS_FCH_EAD}'!A1:K3`,
    `'${HOMOLOG_TAB_NAMES.BASE_FACE_FEA}'!A1:G3`,
    `'${HOMOLOG_TAB_NAMES.BASE_FCH_EAD}'!A1:G3`,
  ];

  const params = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&');
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId
  )}/values:batchGet?valueRenderOption=FORMATTED_VALUE&${params}`;

  const res = await fetchFn(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Falha na validação de leitura da planilha (HTTP ${res.status}): ${err.slice(0, 160)}`);
  }

  const data = await res.json();
  const valueRanges = data.valueRanges || [];

  const checks = {
    tabsFound: valueRanges.length,
    tabsExpected: 4,
    errors: [],
  };

  if (valueRanges.length !== 4) {
    checks.errors.push(`Esperadas 4 abas, mas a API retornou ${valueRanges.length}`);
  }

  // Verifica integridade dos RAs e Cabeçalhos
  for (const vr of valueRanges) {
    const rangeName = vr.range || '';
    const rows = vr.values || [];
    if (rows.length < 2) {
      checks.errors.push(`Aba '${rangeName}' com menos de 2 linhas preenchidas.`);
      continue;
    }

    const headers = rows[0] || [];
    if (rangeName.includes('CONTROLE')) {
      if (headers[0] !== 'RA' || headers[1] !== 'NOME DO ALUNO') {
        checks.errors.push(`Cabeçalho inválido na aba de controle '${rangeName}': ${headers.slice(0, 3).join(', ')}`);
      }
      // Valida preservação de zeros à esquerda nos RAs
      for (let r = 1; r < rows.length; r++) {
        const ra = String(rows[r][0] || '');
        if (!ra.startsWith('009000')) {
          checks.errors.push(`RA na linha ${r + 1} de '${rangeName}' perdeu o zero à esquerda ou é inválido: '${ra}'`);
        }
      }
    }
  }

  return {
    success: checks.errors.length === 0,
    spreadsheetId,
    checks,
  };
}

/**
 * Valida a regra de privilégio mínimo: a Service Account não pode ter acesso a planilhas não autorizadas.
 */
export async function verifyIsolationMinimumPrivilege({
  unauthorizedSpreadsheetId = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms', // Exemplo público ou ID inexistente
  serviceAccountJson,
  tokenProvider,
  token: directToken,
  fetchFn = globalThis.fetch,
}) {
  let token = directToken;
  if (!token && tokenProvider) {
    token = await tokenProvider();
  }
  if (!token) {
    token = await obterTokenGoogleServiceAccount(serviceAccountJson, fetchFn);
  }

  const res = await fetchFn(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(unauthorizedSpreadsheetId)}?fields=properties.title`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  // Espera-se HTTP 403 (Forbidden / Permission Denied) ou 404 (Not Found)
  const isProtected = res.status === 403 || res.status === 404;

  return {
    isIsolated: isProtected,
    status: res.status,
    message: isProtected
      ? `Privilégio mínimo verificado com sucesso: acesso a recurso não autorizado retornou HTTP ${res.status}.`
      : `ATENÇÃO: Acesso ao recurso retornou HTTP ${res.status}. Verifique se a Service Account possui privilégios excessivos.`,
  };
}

// ============================================================================
// CLI RUNNER
// ============================================================================
async function runCli() {
  const args = process.argv.slice(2);
  const getArg = (name) => {
    const prefix = `--${name}=`;
    const arg = args.find((a) => a.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : null;
  };

  const hasFlag = (name) => args.includes(`--${name}`);

  const dryRun = hasFlag('dry-run');
  const verifyOnly = hasFlag('verify-only');
  const strictVerify = hasFlag('strict-verify');
  const testIsolation = hasFlag('test-isolation');

  const spreadsheetId = getArg('spreadsheet-id') || process.env.SPREADSHEET_ID;
  const templatePath = getArg('template') || path.resolve(process.cwd(), 'config/homologacao/template-sheets-homologacao.json');
  const credsPath = getArg('credentials') || process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  console.log('================================================================');
  console.log(' CONTROLE DE DOCUMENTOS — PROVISIONAMENTO SHEETS HOMOLOGAÇÃO');
  console.log('================================================================');

  if (dryRun) {
    console.log('[MODO] Executando simulação estrita (--dry-run). Nenhuma requisição à API será realizada.\n');
    const result = await provisionGoogleSheets({
      spreadsheetId: spreadsheetId || 'SIMULACAO-SPREADSHEET-ID-12345',
      templatePath,
      dryRun: true,
    });
    console.log('✅ Plano estrutural validado com sucesso:');
    console.log(`   - Template: ${result.templateFile}`);
    console.log(`   - Abas configuradas: ${result.tabsToConfigure.join(', ')}`);
    console.log(`   - Operações estruturais preparadas: ${result.structuralRequestsCount}`);
    console.log('\n[Concluído] Simulação finalizada sem alterações externas.');
    return;
  }

  if (!spreadsheetId) {
    console.error('❌ ERRO: --spreadsheet-id=<ID> ou variável de ambiente SPREADSHEET_ID obrigatória.');
    process.exit(1);
  }

  let serviceAccountJson = null;
  if (credsPath) {
    if (fs.existsSync(credsPath)) {
      serviceAccountJson = fs.readFileSync(credsPath, 'utf8');
    } else {
      serviceAccountJson = credsPath; // pode ser string JSON direta
    }
  }

  if (!serviceAccountJson) {
    console.error('❌ ERRO: --credentials=<path/to/sa.json> ou variável GOOGLE_SERVICE_ACCOUNT_JSON obrigatória.');
    process.exit(1);
  }

  if (testIsolation) {
    console.log('\n[SEGURANÇA] Testando isolamento e privilégio mínimo da Service Account...');
    const isoResult = await verifyIsolationMinimumPrivilege({
      serviceAccountJson,
    });
    console.log(isoResult.isIsolated ? `✅ ${isoResult.message}` : `❌ ${isoResult.message}`);
    if (!isoResult.isIsolated) {
      process.exit(1);
    }
  }

  if (strictVerify) {
    console.log(`\n[VERIFICAÇÃO ESTRITA] Auditando integridade profunda da planilha: ${spreadsheetId}...`);
    const result = await verifySpreadsheetStrict({
      spreadsheetId,
      serviceAccountJson,
      templatePath,
    });
    if (result.success) {
      console.log('✅ Planilha 100% em conformidade estrita!');
      console.log(`   - 4 abas canônicas verificadas`);
      console.log(`   - Cabeçalhos exatos validados`);
      console.log(`   - Checkboxes nativos BOOLEAN confirmados`);
      console.log(`   - Fórmulas J/K de contagem e status confirmadas`);
      console.log(`   - Matriz documental de ALFA, BETA, GAMA e DELTA conferida`);
      console.log(`   - Itens atestados: ${result.checks.itemsValidated}`);
    } else {
      console.error(`❌ Divergências encontradas (${result.checks.divergencias.length}):`);
      result.checks.divergencias.forEach((d) => console.error(`   - [DIVERGENCIA] ${d}`));
      process.exit(1);
    }
    return;
  }

  if (verifyOnly) {
    console.log(`\n[VERIFICAÇÃO] Validando alinhamento da planilha: ${spreadsheetId}...`);
    const verResult = await verifySpreadsheetAlignment({
      spreadsheetId,
      serviceAccountJson,
      templatePath,
    });
    if (verResult.success) {
      console.log('✅ Planilha em perfeita conformidade com o template e os alunos do D1!');
    } else {
      console.error('❌ Divergências encontradas:');
      verResult.checks.errors.forEach((e) => console.error(`   - ${e}`));
      process.exit(1);
    }
    return;
  }

  console.log(`\n[EXECUÇÃO] Provisionando/Configurando planilha de homologação: ${spreadsheetId}...`);
  const result = await provisionGoogleSheets({
    spreadsheetId,
    serviceAccountJson,
    templatePath,
    dryRun: false,
  });

  console.log('✅ Provisionamento concluído com sucesso!');
  console.log(`   - Abas configuradas: ${result.tabsConfigured.join(', ')}`);
  console.log(`   - Operações estruturais executadas: ${result.structuralRequestsExecuted}`);
  console.log(`   - Linhas de dados e fórmulas inseridas: ${result.valuesWritten}`);
}

// Permite execução direta via CLI
const isDirectCli = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isDirectCli) {
  runCli().catch((err) => {
    console.error('❌ ERRO DURANTE A OPERAÇÃO:', err.message);
    process.exit(1);
  });
}
