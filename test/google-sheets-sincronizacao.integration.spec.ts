import { env, exports } from "cloudflare:workers";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

type JsonObject = Record<string, unknown>;

type Aluno = {
  ra: string;
  nome: string;
  unidade: string;
  status: "ATIVO" | "CANCELADO";
  identidade: number;
  cpf: number;
};

const baseUrl = "https://controle-documentos.test";
const senha = "SenhaSegura123";
const spreadsheetId = "planilha-teste-segura";

let adminCookie = "";
let visualizadorCookie = "";
let periodoId = 0;

const baseHeader = [
  "Contrato",
  "Curso",
  "E-mail outro",
  "E-mail",
  "Nome",
  "RA",
];
const docsHeader = [
  "RA",
  "Nome",
  "Identidade",
  "CPF",
  "Certidao",
  "Residencia",
  "Titulo",
  "Ensino Medio",
  "Contrato",
];
const cancelHeader = ["RA"];

const valueRanges = [
  {
    values: [
      baseHeader,
      ["", "ADMINISTRACAO", "novo@outro.local", "novo@teste.local", "Aluno Existente Atualizado", "RA-SHEETS-001"],
      ["", "ADMINISTRACAO", "", "novo.aluno@teste.local", "Aluno Novo", "RA-SHEETS-NOVO"],
      ["", "ADMINISTRACAO", "", "", "Aluno Reativado", "RA-SHEETS-REATIVAR"],
    ],
  },
  { values: [baseHeader] },
  {
    values: [
      docsHeader,
      ["RA-SHEETS-001", "Aluno Existente Atualizado", true, true, false, false, false, false, false],
      ["RA-SHEETS-NOVO", "Aluno Novo", true, false, false, false, false, false, false],
      ["RA-SHEETS-REATIVAR", "Aluno Reativado", false, false, false, false, false, false, false],
    ],
  },
  { values: [docsHeader] },
  { values: [cancelHeader, ["RA-SHEETS-CANCELAR"]] },
  { values: [cancelHeader] },
];
let currentValueRanges = structuredClone(valueRanges);
const sheetWrites: unknown[] = [];

function request(path: string, init: RequestInit = {}) {
  return exports.default.fetch(`${baseUrl}${path}`, init);
}

function jsonRequest(
  path: string,
  method: string,
  body: JsonObject,
  cookie?: string,
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (cookie) headers.Cookie = cookie;

  return request(path, {
    method,
    headers,
    body: JSON.stringify(body),
  });
}

function sessionCookie(response: Response) {
  const setCookie = response.headers.get("Set-Cookie");
  expect(setCookie).toBeTruthy();
  return setCookie!.split(";", 1)[0];
}

async function login(identificador: string) {
  const response = await jsonRequest("/api/auth/login", "POST", {
    identificador,
    senha,
  });
  expect(response.status).toBe(200);
  return sessionCookie(response);
}

async function criarAluno(
  ra: string,
  nome: string,
  status: "ATIVO" | "CANCELADO" = "ATIVO",
) {
  const criar = await jsonRequest(
    "/api/alunos?periodo=2026-2",
    "POST",
    { ra, nome, curso: "ADMINISTRACAO", unidade: "FACE" },
    adminCookie,
  );
  expect(criar.status).toBe(201);

  if (status === "CANCELADO") {
    const cancelar = await jsonRequest(
      `/api/alunos/${encodeURIComponent(ra)}/status?periodo=2026-2`,
      "PUT",
      { status },
      adminCookie,
    );
    expect(cancelar.status).toBe(200);
  }
}

async function listarAlunos() {
  const response = await request("/api/alunos?periodo=2026-2", {
    headers: { Cookie: adminCookie },
  });
  expect(response.status).toBe(200);
  return response.json<Aluno[]>();
}

beforeAll(async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );

    if (url.origin === "https://oauth2.googleapis.com") {
      return Response.json({ access_token: "token-google-de-teste" });
    }

    if (
      url.origin === "https://sheets.googleapis.com" &&
      url.pathname.endsWith("/values:batchGet")
    ) {
      return Response.json({ valueRanges: currentValueRanges });
    }

    if (
      url.origin === "https://sheets.googleapis.com" &&
      url.pathname.endsWith("/values:batchUpdate")
    ) {
      sheetWrites.push(JSON.parse(String(init?.body ?? "{}")));
      return Response.json({ totalUpdatedRows: 1 });
    }

    throw new Error(`Requisicao externa inesperada no teste: ${url.href}`);
  });

  const bootstrap = await jsonRequest("/api/auth/bootstrap", "POST", {
    nome: "Administrador do Sheets",
    email: "admin.sheets@teste.local",
    username: "admin.sheets",
    senha,
  });
  expect(bootstrap.status).toBe(201);
  adminCookie = await login("admin.sheets");

  const visualizador = await jsonRequest(
    "/api/usuarios",
    "POST",
    {
      nome: "Visualizador do Sheets",
      email: "visualizador.sheets@teste.local",
      username: "visualizador.sheets",
      senha,
      perfil: "VISUALIZADOR",
    },
    adminCookie,
  );
  expect(visualizador.status).toBe(201);
  visualizadorCookie = await login("visualizador.sheets");

  const periodosResponse = await request("/api/periodos", {
    headers: { Cookie: adminCookie },
  });
  expect(periodosResponse.status).toBe(200);
  const periodos = await periodosResponse.json<Array<{ id: number; codigo: string }>>();
  periodoId = periodos.find((periodo) => periodo.codigo === "2026-2")?.id ?? 0;
  expect(periodoId).toBeGreaterThan(0);

  await criarAluno("RA-SHEETS-001", "Aluno Existente");
  await criarAluno("RA-SHEETS-CANCELAR", "Aluno para Cancelar");
  await criarAluno("RA-SHEETS-REATIVAR", "Aluno Reativado", "CANCELADO");
  await criarAluno("RA-SHEETS-REMOVER", "Aluno para Remover");
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe.sequential("previa e sincronizacao do Google Sheets", () => {
  it("informa que o período ainda não possui planilha configurada", async () => {
    const response = await request(
      `/api/periodos/${periodoId}/google-sheets/status`,
      { headers: { Cookie: adminCookie } },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      configurado: false,
      conectado: false,
      spreadsheet_id: null,
      titulo: null,
      erro: null,
    });
  });

  it("exige configuracao antes de acessar a planilha", async () => {
    const response = await jsonRequest(
      `/api/periodos/${periodoId}/google-sheets/previa`,
      "POST",
      {},
      adminCookie,
    );
    expect(response.status).toBe(409);
  });

  it("salva a configuracao extraindo o ID de uma URL", async () => {
    const response = await jsonRequest(
      `/api/periodos/${periodoId}/google-sheets`,
      "PUT",
      {
        spreadsheet_id: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
        aba_base_face_fea: "BASE FACE FEA",
        aba_base_fch_ead: "BASE FCH EAD",
        aba_docs_face_fea: "DOCS FACE FEA",
        aba_docs_fch_ead: "DOCS FCH EAD",
        aba_cancelados_face_fea: "CANCELADOS FACE FEA",
        aba_cancelados_fch_ead: "CANCELADOS FCH EAD",
      },
      adminCookie,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      sucesso: true,
      spreadsheet_id: spreadsheetId,
    });

    const configuracao = await request(
      `/api/periodos/${periodoId}/google-sheets`,
      { headers: { Cookie: adminCookie } },
    );
    expect(configuracao.status).toBe(200);
    await expect(configuracao.json()).resolves.toMatchObject({
      periodo_id: periodoId,
      spreadsheet_id: spreadsheetId,
      aba_base_face_fea: "BASE FACE FEA",
    });
  });

  it("gera uma previa completa sem alterar o sistema", async () => {
    const response = await jsonRequest(
      `/api/periodos/${periodoId}/google-sheets/previa`,
      "POST",
      {},
      visualizadorCookie,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      sucesso: true,
      encontrados: 3,
      novos: 1,
      alteracoes_cadastrais: 1,
      documentos_alterados: 1,
      prontos_para_cancelar: 1,
      prontos_para_reativar: 1,
      prontos_para_remover: 1,
      unidades_nao_resolvidas: 0,
      modo: "PREVIA_SOMENTE_LEITURA",
    });

    const alunos = await listarAlunos();
    expect(alunos).toHaveLength(4);
    expect(alunos.some((aluno) => aluno.ra === "RA-SHEETS-NOVO")).toBe(false);
    expect(alunos.find((aluno) => aluno.ra === "RA-SHEETS-001")?.nome).toBe(
      "Aluno Existente",
    );
  });

  it("impede o visualizador de aplicar a sincronizacao", async () => {
    const response = await jsonRequest(
      `/api/periodos/${periodoId}/google-sheets/sincronizar`,
      "POST",
      {},
      visualizadorCookie,
    );
    expect(response.status).toBe(403);
  });

  it("aplica todas as divergencias confirmadas no periodo", async () => {
    const response = await jsonRequest(
      `/api/periodos/${periodoId}/google-sheets/sincronizar`,
      "POST",
      {},
      adminCookie,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      sucesso: true,
      novos: 1,
      alteracoes_cadastrais: 1,
      documentos_alterados: 1,
      cancelamentos: 1,
      reativacoes: 1,
      remocoes: 1,
      total_operacoes: 6,
    });

    const alunos = await listarAlunos();
    expect(alunos).toHaveLength(4);
    expect(alunos.find((aluno) => aluno.ra === "RA-SHEETS-001")).toMatchObject({
      nome: "Aluno Existente Atualizado",
      identidade: 1,
      cpf: 1,
    });
    expect(alunos.find((aluno) => aluno.ra === "RA-SHEETS-NOVO")).toMatchObject({
      status: "ATIVO",
      unidade: "FACE",
      identidade: 1,
    });
    expect(alunos.find((aluno) => aluno.ra === "RA-SHEETS-CANCELAR")?.status).toBe(
      "CANCELADO",
    );
    expect(alunos.find((aluno) => aluno.ra === "RA-SHEETS-REATIVAR")?.status).toBe(
      "ATIVO",
    );
    expect(alunos.some((aluno) => aluno.ra === "RA-SHEETS-REMOVER")).toBe(false);

    // As inclusoes usadas para preparar o teste geram pendencias locais. A
    // sincronizacao de entrada nao as consome; limpamos apenas o fixture para
    // que os proximos cenarios exercitem uma unica alteracao por vez.
    await env.DB.prepare(
      "DELETE FROM google_sheets_pendencias WHERE periodo_id = ?",
    )
      .bind(periodoId)
      .run();
  });

  it("registra alteracoes locais na caixa de saida", async () => {
    const editar = await jsonRequest(
      "/api/alunos/RA-SHEETS-001?periodo=2026-2",
      "PUT",
      {
        ra: "RA-SHEETS-001",
        nome: "Alteracao Local Segura",
        email: "novo@teste.local",
        email_outro: "novo@outro.local",
        curso: "ADMINISTRACAO",
        unidade: "FACE",
      },
      adminCookie,
    );
    expect(editar.status).toBe(200);

    const pendencias = await request(
      `/api/periodos/${periodoId}/google-sheets/pendencias`,
      { headers: { Cookie: adminCookie } },
    );
    expect(pendencias.status).toBe(200);
    await expect(pendencias.json()).resolves.toMatchObject({
      modo: "PREVIA_SOMENTE_LEITURA",
      total: 1,
      atualizar: 1,
      remover: 0,
      conflitos: 0,
    });
  });

  it("exige administrador e confirmacao para escrever na planilha", async () => {
    const semConfirmacao = await jsonRequest(
      `/api/periodos/${periodoId}/google-sheets/pendencias`,
      "POST",
      { confirmacao: "CONFIRMAR" },
      adminCookie,
    );
    expect(semConfirmacao.status).toBe(400);

    const comoVisualizador = await jsonRequest(
      `/api/periodos/${periodoId}/google-sheets/pendencias`,
      "POST",
      { confirmacao: "SINCRONIZAR" },
      visualizadorCookie,
    );
    expect(comoVisualizador.status).toBe(403);
    expect(sheetWrites).toHaveLength(0);
  });

  it("envia uma alteracao elegivel e conclui a pendencia", async () => {
    const enviar = await jsonRequest(
      `/api/periodos/${periodoId}/google-sheets/pendencias`,
      "POST",
      { confirmacao: "SINCRONIZAR" },
      adminCookie,
    );
    expect(enviar.status).toBe(200);
    await expect(enviar.json()).resolves.toMatchObject({
      sucesso: true,
      enviados: 1,
      conflitos: 0,
    });
    expect(sheetWrites).toHaveLength(1);

    const pendencias = await request(
      `/api/periodos/${periodoId}/google-sheets/pendencias`,
      { headers: { Cookie: adminCookie } },
    );
    expect(pendencias.status).toBe(200);
    await expect(pendencias.json()).resolves.toMatchObject({ total: 0 });
  });

  it("bloqueia a escrita quando encontra RA duplicado na planilha", async () => {
    const editar = await jsonRequest(
      "/api/alunos/RA-SHEETS-NOVO?periodo=2026-2",
      "PUT",
      {
        ra: "RA-SHEETS-NOVO",
        nome: "Aluno Novo Alterado Localmente",
        email: "novo.aluno@teste.local",
        curso: "ADMINISTRACAO",
        unidade: "FACE",
      },
      adminCookie,
    );
    expect(editar.status).toBe(200);

    currentValueRanges = structuredClone(valueRanges);
    currentValueRanges[0].values.push([
      "",
      "ADMINISTRACAO",
      "",
      "duplicado@teste.local",
      "Aluno Duplicado",
      "RA-SHEETS-NOVO",
    ]);

    const enviar = await jsonRequest(
      `/api/periodos/${periodoId}/google-sheets/pendencias`,
      "POST",
      { confirmacao: "SINCRONIZAR" },
      adminCookie,
    );
    expect(enviar.status).toBe(200);
    await expect(enviar.json()).resolves.toMatchObject({
      sucesso: true,
      enviados: 0,
      conflitos: 1,
    });
    expect(sheetWrites).toHaveLength(1);

    const pendencias = await request(
      `/api/periodos/${periodoId}/google-sheets/pendencias`,
      { headers: { Cookie: adminCookie } },
    );
    expect(pendencias.status).toBe(200);
    const resultado = await pendencias.json<{
      total: number;
      conflitos: number;
      pendencias: Array<{ status: string; ultimo_erro: string }>;
    }>();
    expect(resultado).toMatchObject({ total: 1, conflitos: 1 });
    expect(resultado.pendencias[0]).toMatchObject({ status: "CONFLITO" });
    expect(resultado.pendencias[0].ultimo_erro).toContain("duplicado");
  });
});
