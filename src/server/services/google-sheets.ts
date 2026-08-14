import type { SheetsConfig } from "../routes/google-sheets-config";

type GoogleServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

export type EscritaGoogle = { range: string; values: unknown[][] };

function base64Url(valor: ArrayBuffer | string) {
  const bytes =
    typeof valor === "string"
      ? new TextEncoder().encode(valor)
      : new Uint8Array(valor);
  let binario = "";
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return btoa(binario)
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function pemParaArrayBuffer(pem: string) {
  const base64 = pem.replace(
    /-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,
    "",
  );
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  return bytes.buffer;
}

async function obterTokenGoogle(serviceAccountJson?: string) {
  if (!serviceAccountJson) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON não configurado no Worker.");
  }
  const conta = JSON.parse(serviceAccountJson) as GoogleServiceAccount;
  const agora = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      iss: conta.client_email,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: conta.token_uri || "https://oauth2.googleapis.com/token",
      iat: agora,
      exp: agora + 3600,
    }),
  );
  const chave = await crypto.subtle.importKey(
    "pkcs8",
    pemParaArrayBuffer(conta.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const assinatura = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    chave,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  const jwt = `${header}.${payload}.${base64Url(assinatura)}`;
  const resposta = await fetch(
    conta.token_uri || "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    },
  );
  if (!resposta.ok) {
    throw new Error(`Falha na autenticação Google (${resposta.status}).`);
  }
  const dados = await resposta.json<{ access_token: string }>();
  return dados.access_token;
}

export function extrairSpreadsheetId(valor: string) {
  const limpo = valor.trim();
  const match = limpo.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match?.[1] || limpo;
}

export function normalizarTexto(valor: unknown) {
  return String(valor ?? "").trim();
}

export function normalizarComparacao(valor: unknown) {
  return normalizarTexto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

export function valorBooleano(valor: unknown) {
  if (typeof valor === "boolean") return valor;
  return ["TRUE", "VERDADEIRO", "1", "SIM", "X"].includes(
    normalizarComparacao(valor),
  );
}

export async function testarConexaoGoogleSheets(
  serviceAccountJson: string | undefined,
  config: SheetsConfig,
) {
  const token = await obterTokenGoogle(serviceAccountJson);
  const endpoint =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      config.spreadsheet_id,
    )}` + `?fields=spreadsheetId,properties.title`;
  const resposta = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resposta.ok) {
    const detalhe = await resposta.text();
    throw new Error(
      `Google Sheets respondeu ${resposta.status}: ${detalhe.slice(0, 240)}`,
    );
  }
  return resposta.json<{
    spreadsheetId: string;
    properties?: { title?: string };
  }>();
}

export async function lerRangesGoogle(
  serviceAccountJson: string | undefined,
  config: SheetsConfig,
) {
  const token = await obterTokenGoogle(serviceAccountJson);
  const abas = [
    config.aba_base_face_fea,
    config.aba_base_fch_ead,
    config.aba_docs_face_fea,
    config.aba_docs_fch_ead,
    config.aba_cancelados_face_fea,
    config.aba_cancelados_fch_ead,
  ];
  const params = new URLSearchParams();
  for (const aba of abas) {
    params.append("ranges", `'${aba.replace(/'/g, "''")}'!A:K`);
  }
  params.set("majorDimension", "ROWS");
  params.set("valueRenderOption", "UNFORMATTED_VALUE");
  const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    config.spreadsheet_id,
  )}/values:batchGet?${params}`;
  const resposta = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resposta.ok) {
    const detalhe = await resposta.text();
    throw new Error(
      `Google Sheets respondeu ${resposta.status}: ${detalhe.slice(0, 240)}`,
    );
  }
  const dados = await resposta.json<{
    valueRanges?: Array<{ values?: unknown[][] }>;
  }>();
  return abas.map((aba, indice) => ({
    aba,
    linhas: dados.valueRanges?.[indice]?.values ?? [],
  }));
}

export async function escreverValoresGoogle(
  serviceAccountJson: string | undefined,
  config: SheetsConfig,
  escritas: EscritaGoogle[],
) {
  if (!escritas.length) return;
  const token = await obterTokenGoogle(serviceAccountJson);
  const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    config.spreadsheet_id,
  )}/values:batchUpdate`;
  const resposta = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ valueInputOption: "RAW", data: escritas }),
  });
  if (!resposta.ok) {
    const detalhe = await resposta.text();
    throw new Error(
      `Google Sheets respondeu ${resposta.status}: ${detalhe.slice(0, 240)}`,
    );
  }
}
