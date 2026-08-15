import { exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

type JsonObject = Record<string, unknown>;

type Aluno = {
  ra: string;
  nome: string;
  curso: string;
  unidade: string;
  identidade: number;
  cpf: number;
  contrato: number;
};

const baseUrl = "https://controle-documentos.test";
const periodo = "2026-2";
const senha = "SenhaSegura123";
const ra = "RA-IMPORTACAO-001";
let adminCookie = "";

function request(path: string, init: RequestInit = {}) {
  return exports.default.fetch(`${baseUrl}${path}`, init);
}

function jsonRequest(path: string, method: string, body: JsonObject) {
  return request(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Cookie: adminCookie,
    },
    body: JSON.stringify(body),
  });
}

async function listarAluno() {
  const response = await request(`/api/alunos?periodo=${periodo}`, {
    headers: { Cookie: adminCookie },
  });
  expect(response.status).toBe(200);
  const alunos = await response.json<Aluno[]>();
  return alunos.find((aluno) => aluno.ra === ra);
}

beforeAll(async () => {
  const bootstrap = await request("/api/auth/bootstrap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nome: "Administrador da Importação",
      email: "admin.importacao@teste.local",
      username: "admin.importacao",
      senha,
    }),
  });
  expect(bootstrap.status).toBe(201);

  const login = await request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identificador: "admin.importacao", senha }),
  });
  expect(login.status).toBe(200);
  adminCookie = login.headers.get("Set-Cookie")!.split(";", 1)[0];
});

describe.sequential("importação em massa de alunos", () => {
  it("rejeita unidade inválida", async () => {
    const response = await jsonRequest(
      `/api/alunos/importar?periodo=${periodo}`,
      "POST",
      { unidade: "INVALIDA", alunos: [{ ra, nome: "Aluno", curso: "ADM" }] },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      erro: "Unidade inválida.",
    });
  });

  it("rejeita lote vazio", async () => {
    const response = await jsonRequest(
      `/api/alunos/importar?periodo=${periodo}`,
      "POST",
      { unidade: "FACE", alunos: [] },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      erro: "Nenhum aluno foi enviado para sincronização.",
    });
  });

  it("importa apenas registros válidos e elimina RA duplicado no lote", async () => {
    const response = await jsonRequest(
      `/api/alunos/importar?periodo=${periodo}`,
      "POST",
      {
        unidade: "FACE",
        alunos: [
          {
            ra,
            nome: "Aluno Importado",
            curso: "ADMINISTRAÇÃO",
            email: "aluno@teste.local",
            contrato: true,
          },
          { ra, nome: "Aluno Repetido", curso: "ADMINISTRAÇÃO" },
          { ra: "", nome: "Aluno Inválido", curso: "ADMINISTRAÇÃO" },
        ],
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      sucesso: true,
      encontrados: 3,
      importados: 1,
      atualizados: 0,
      duplicados_no_lote: 1,
      invalidos: 1,
    });

    expect(await listarAluno()).toMatchObject({
      nome: "Aluno Importado",
      unidade: "FACE",
      contrato: 1,
    });
  });

  it("atualiza cadastro sem apagar documentos já conferidos", async () => {
    const documentos = await jsonRequest(
      `/api/alunos/${encodeURIComponent(ra)}/documentos?periodo=${periodo}`,
      "PUT",
      {
        identidade: true,
        cpf: true,
        certidao: false,
        residencia: false,
        titulo: false,
        ensino_medio: false,
        contrato: true,
      },
    );
    expect(documentos.status).toBe(200);

    const response = await jsonRequest(
      `/api/alunos/importar?periodo=${periodo}`,
      "POST",
      {
        unidade: "FEA",
        alunos: [
          {
            ra,
            nome: "Aluno Atualizado pela Importação",
            curso: "ADMINISTRAÇÃO",
            email: "novo@teste.local",
          },
        ],
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      importados: 0,
      atualizados: 1,
      ja_cadastrados: 1,
    });
    expect(await listarAluno()).toMatchObject({
      nome: "Aluno Atualizado pela Importação",
      unidade: "FEA",
      identidade: 1,
      cpf: 1,
      contrato: 1,
    });
  });
});
