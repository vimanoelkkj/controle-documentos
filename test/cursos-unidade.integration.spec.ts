import { exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

type JsonObject = Record<string, unknown>;

type Aluno = {
  ra: string;
  curso: string;
  unidade: string;
};

type Periodo = {
  id: number;
  codigo: string;
};

const baseUrl = "https://controle-documentos.test";
const senha = "SenhaSegura123";
const curso = "ADMINISTRACAO";

let adminCookie = "";
let editorCookie = "";
let visualizadorCookie = "";
let periodoAId = 0;
let periodoBId = 0;

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

async function criarAluno(
  periodo: string,
  ra: string,
  nome: string,
  unidade: string,
) {
  const response = await jsonRequest(
    `/api/alunos?periodo=${periodo}`,
    "POST",
    { ra, nome, curso, unidade },
    adminCookie,
  );
  expect(response.status).toBe(201);
}

beforeAll(async () => {
  const bootstrap = await jsonRequest("/api/auth/bootstrap", "POST", {
    nome: "Administrador de Cursos",
    email: "admin.cursos@teste.local",
    username: "admin.cursos",
    senha,
  });
  expect(bootstrap.status).toBe(201);
  adminCookie = await login("admin.cursos");

  for (const usuario of [
    {
      nome: "Editor de Cursos",
      email: "editor.cursos@teste.local",
      username: "editor.cursos",
      perfil: "EDITOR",
    },
    {
      nome: "Visualizador de Cursos",
      email: "visualizador.cursos@teste.local",
      username: "visualizador.cursos",
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

  editorCookie = await login("editor.cursos");
  visualizadorCookie = await login("visualizador.cursos");

  const novoPeriodo = await jsonRequest(
    "/api/periodos",
    "POST",
    { codigo: "2027-1" },
    adminCookie,
  );
  expect(novoPeriodo.status).toBe(201);

  const periodosResponse = await request("/api/periodos", {
    headers: { Cookie: adminCookie },
  });
  expect(periodosResponse.status).toBe(200);
  const periodos = await periodosResponse.json<Periodo[]>();
  periodoAId = periodos.find((periodo) => periodo.codigo === "2026-2")?.id ?? 0;
  periodoBId = periodos.find((periodo) => periodo.codigo === "2027-1")?.id ?? 0;
  expect(periodoAId).toBeGreaterThan(0);
  expect(periodoBId).toBeGreaterThan(0);

  await criarAluno("2026-2", "RA-CURSO-001", "Aluno Curso 1", "FACE");
  await criarAluno("2026-2", "RA-CURSO-002", "Aluno Curso 2", "FCH");
  await criarAluno("2026-2", "RA-CURSO-003", "Aluno Curso 3", "EAD");
  await criarAluno("2027-1", "RA-CURSO-004", "Aluno Outro Periodo", "EAD");
});

describe.sequential("alteracao em massa da unidade de cursos", () => {
  it("exige a confirmacao de seguranca", async () => {
    const response = await jsonRequest(
      "/api/cursos/unidade?periodo=2026-2",
      "PUT",
      { curso, unidade: "FEA", confirmacao: "CONFIRMAR" },
      editorCookie,
    );

    expect(response.status).toBe(400);
    const alunos = await listarAlunos("2026-2");
    expect(alunos.map((aluno) => aluno.unidade)).toEqual([
      "FACE",
      "FCH",
      "EAD",
    ]);
  });

  it("permite que o editor altere todos os alunos do curso", async () => {
    const response = await jsonRequest(
      "/api/cursos/unidade?periodo=2026-2",
      "PUT",
      { curso, unidade: "FEA", confirmacao: "ALTERAR" },
      editorCookie,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      sucesso: true,
      curso,
      unidade: "FEA",
      alunos_total: 3,
      alunos_alterados: 3,
    });

    const alunos = await listarAlunos("2026-2");
    expect(alunos).toHaveLength(3);
    expect(alunos.every((aluno) => aluno.unidade === "FEA")).toBe(true);
  });

  it("salva o mapeamento somente no periodo alterado", async () => {
    const responseA = await request(
      `/api/periodos/${periodoAId}/google-sheets/mapeamentos`,
      { headers: { Cookie: adminCookie } },
    );
    expect(responseA.status).toBe(200);
    await expect(responseA.json()).resolves.toContainEqual({
      curso,
      unidade: "FEA",
    });

    const responseB = await request(
      `/api/periodos/${periodoBId}/google-sheets/mapeamentos`,
      { headers: { Cookie: adminCookie } },
    );
    expect(responseB.status).toBe(200);
    await expect(responseB.json()).resolves.not.toContainEqual({
      curso,
      unidade: "FEA",
    });
  });

  it("preserva os alunos do mesmo curso em outro periodo", async () => {
    const alunos = await listarAlunos("2027-1");
    expect(alunos).toHaveLength(1);
    expect(alunos[0]).toMatchObject({
      ra: "RA-CURSO-004",
      curso,
      unidade: "EAD",
    });
  });

  it("bloqueia a alteracao para o visualizador", async () => {
    const response = await jsonRequest(
      "/api/cursos/unidade?periodo=2027-1",
      "PUT",
      { curso, unidade: "FCH", confirmacao: "ALTERAR" },
      visualizadorCookie,
    );
    expect(response.status).toBe(403);

    const alunos = await listarAlunos("2027-1");
    expect(alunos[0].unidade).toBe("EAD");
  });
});
