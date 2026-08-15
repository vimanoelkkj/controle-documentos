import { exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

type JsonObject = Record<string, unknown>;

type Aluno = {
  ra: string;
  unidade: string;
  status: "ATIVO" | "CANCELADO";
  identidade: number;
  cpf: number;
};

const baseUrl = "https://controle-documentos.test";
const senha = "SenhaSegura123";
const raCompartilhado = "RA-CANCELAMENTO-001";

let adminCookie = "";
let editorCookie = "";
let visualizadorCookie = "";

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

async function listarAlunos(periodo: string) {
  const response = await request(`/api/alunos?periodo=${periodo}`, {
    headers: { Cookie: adminCookie },
  });
  expect(response.status).toBe(200);
  return response.json<Aluno[]>();
}

async function obterAluno(periodo: string, ra: string) {
  const alunos = await listarAlunos(periodo);
  const aluno = alunos.find((item) => item.ra === ra);
  expect(aluno).toBeDefined();
  return aluno!;
}

async function criarAluno(
  periodo: string,
  ra: string,
  nome: string,
  unidade: string,
) {
  const response = await jsonRequest(
    `/api/alunos?periodo=${periodo}`,
    "POST",
    { ra, nome, curso: "DIREITO", unidade },
    adminCookie,
  );
  expect(response.status).toBe(201);
}

beforeAll(async () => {
  const bootstrap = await jsonRequest("/api/auth/bootstrap", "POST", {
    nome: "Administrador de Cancelamentos",
    email: "admin.cancelamentos@teste.local",
    username: "admin.cancelamentos",
    senha,
  });
  expect(bootstrap.status).toBe(201);
  adminCookie = await login("admin.cancelamentos");

  for (const usuario of [
    {
      nome: "Editor de Cancelamentos",
      email: "editor.cancelamentos@teste.local",
      username: "editor.cancelamentos",
      perfil: "EDITOR",
    },
    {
      nome: "Visualizador de Cancelamentos",
      email: "visualizador.cancelamentos@teste.local",
      username: "visualizador.cancelamentos",
      perfil: "VISUALIZADOR",
    },
  ]) {
    const response = await jsonRequest(
      "/api/usuarios",
      "POST",
      { ...usuario, senha },
      adminCookie,
    );
    expect(response.status).toBe(201);
  }

  editorCookie = await login("editor.cancelamentos");
  visualizadorCookie = await login("visualizador.cancelamentos");

  const novoPeriodo = await jsonRequest(
    "/api/periodos",
    "POST",
    { codigo: "2027-1" },
    adminCookie,
  );
  expect(novoPeriodo.status).toBe(201);

  await criarAluno(
    "2026-2",
    raCompartilhado,
    "Aluno para Cancelar",
    "FACE",
  );
  await criarAluno("2026-2", "RA-OUTRA-UNIDADE", "Aluno FCH", "FCH");
  await criarAluno(
    "2027-1",
    raCompartilhado,
    "Aluno do Outro Periodo",
    "FACE",
  );

  const documentos = await jsonRequest(
    `/api/alunos/${encodeURIComponent(raCompartilhado)}/documentos?periodo=2026-2`,
    "PUT",
    {
      identidade: true,
      cpf: true,
      certidao: false,
      residencia: false,
      titulo: false,
      ensino_medio: false,
      contrato: false,
    },
    editorCookie,
  );
  expect(documentos.status).toBe(200);
});

describe.sequential("cancelamento e reativacao de alunos", () => {
  it("classifica a previa sem alterar os alunos", async () => {
    const response = await jsonRequest(
      "/api/alunos/cancelados/previa?periodo=2026-2",
      "POST",
      {
        unidade: "FACE",
        ras: [raCompartilhado, raCompartilhado, "RA-OUTRA-UNIDADE", "RA-INEXISTENTE"],
      },
      editorCookie,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      sucesso: true,
      recebidos: 3,
      prontos_para_cancelar: 1,
      ja_cancelados: 0,
      nao_encontrados: 1,
      outra_unidade: 1,
    });

    expect((await obterAluno("2026-2", raCompartilhado)).status).toBe("ATIVO");
  });

  it("cancela somente alunos validos da unidade selecionada", async () => {
    const response = await jsonRequest(
      "/api/alunos/cancelados?periodo=2026-2",
      "POST",
      {
        unidade: "FACE",
        ras: [raCompartilhado, "RA-OUTRA-UNIDADE", "RA-INEXISTENTE"],
      },
      editorCookie,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      sucesso: true,
      recebidos: 3,
      cancelados: 1,
      ja_cancelados: 0,
      nao_encontrados: 1,
      outra_unidade: 1,
    });

    expect((await obterAluno("2026-2", raCompartilhado)).status).toBe(
      "CANCELADO",
    );
    expect((await obterAluno("2026-2", "RA-OUTRA-UNIDADE")).status).toBe(
      "ATIVO",
    );
  });

  it("preserva documentos e o mesmo RA em outro periodo", async () => {
    const alunoCancelado = await obterAluno("2026-2", raCompartilhado);
    expect(alunoCancelado).toMatchObject({
      status: "CANCELADO",
      identidade: 1,
      cpf: 1,
    });

    const alunoOutroPeriodo = await obterAluno("2027-1", raCompartilhado);
    expect(alunoOutroPeriodo).toMatchObject({
      status: "ATIVO",
      identidade: 0,
      cpf: 0,
    });
  });

  it("reativa o aluno e trata repeticao como operacao idempotente", async () => {
    const path = `/api/alunos/${encodeURIComponent(raCompartilhado)}/status?periodo=2026-2`;
    const reativar = await jsonRequest(
      path,
      "PUT",
      { status: "ATIVO" },
      editorCookie,
    );
    expect(reativar.status).toBe(200);
    await expect(reativar.json()).resolves.toMatchObject({
      sucesso: true,
      ra: raCompartilhado,
      status: "ATIVO",
      alterado: true,
    });

    const repetir = await jsonRequest(
      path,
      "PUT",
      { status: "ATIVO" },
      editorCookie,
    );
    expect(repetir.status).toBe(200);
    await expect(repetir.json()).resolves.toMatchObject({ alterado: false });
    expect((await obterAluno("2026-2", raCompartilhado)).status).toBe("ATIVO");
  });

  it("rejeita status invalido sem alterar a matricula", async () => {
    const response = await jsonRequest(
      `/api/alunos/${encodeURIComponent(raCompartilhado)}/status?periodo=2026-2`,
      "PUT",
      { status: "PENDENTE" },
      editorCookie,
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      erro: "Status inválido.",
    });
    expect((await obterAluno("2026-2", raCompartilhado)).status).toBe("ATIVO");
  });

  it("bloqueia cancelamento e reativacao para o visualizador", async () => {
    const cancelar = await jsonRequest(
      "/api/alunos/cancelados?periodo=2026-2",
      "POST",
      { unidade: "FACE", ras: [raCompartilhado] },
      visualizadorCookie,
    );
    expect(cancelar.status).toBe(403);

    const alterarStatus = await jsonRequest(
      `/api/alunos/${encodeURIComponent(raCompartilhado)}/status?periodo=2026-2`,
      "PUT",
      { status: "CANCELADO" },
      visualizadorCookie,
    );
    expect(alterarStatus.status).toBe(403);
    expect((await obterAluno("2026-2", raCompartilhado)).status).toBe("ATIVO");
  });
});
