import { exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

const baseUrl = "https://controle-documentos.test";
const senha = "SenhaSegura123";
let adminCookie = "";

function request(path: string, init: RequestInit = {}) {
  return exports.default.fetch(`${baseUrl}${path}`, init);
}

function jsonRequest(
  path: string,
  method: string,
  body: Record<string, unknown>,
  cookie?: string,
) {
  return request(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function sessionCookie(response: Response) {
  const cookie = response.headers.get("Set-Cookie");
  expect(cookie).toBeTruthy();
  return cookie!.split(";", 1)[0];
}

beforeAll(async () => {
  const bootstrap = await jsonRequest("/api/auth/bootstrap", "POST", {
    nome: "Administrador Dev",
    email: "admin.dev@teste.local",
    username: "admin.dev",
    senha,
  });
  expect(bootstrap.status).toBe(201);

  const login = await jsonRequest("/api/auth/login", "POST", {
    identificador: "admin.dev",
    senha,
  });
  adminCookie = sessionCookie(login);

  for (const aluno of [
    { ra: "DEV-001", nome: "Aluno FACE", unidade: "FACE" },
    { ra: "DEV-002", nome: "Aluno FEA", unidade: "FEA" },
  ]) {
    const response = await jsonRequest(
      "/api/alunos?periodo=2026-2",
      "POST",
      { ...aluno, curso: "CURSO DEV" },
      adminCookie,
    );
    expect(response.status).toBe(201);
  }
});

describe.sequential("ferramentas exclusivas do ambiente DEV", () => {
  it("habilita a limpeza somente para o administrador no DEV", async () => {
    const response = await request("/api/dev/alunos-reset/status", {
      headers: { Cookie: adminCookie },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ habilitado: true });
  });

  it("exige a confirmação correspondente à unidade", async () => {
    const response = await jsonRequest(
      "/api/dev/alunos-reset?periodo=2026-2",
      "DELETE",
      { unidade: "FACE", confirmacao: "LIMPAR FEA" },
      adminCookie,
    );
    expect(response.status).toBe(400);
  });

  it("remove somente os alunos da unidade confirmada", async () => {
    const response = await jsonRequest(
      "/api/dev/alunos-reset?periodo=2026-2",
      "DELETE",
      { unidade: "FACE", confirmacao: "LIMPAR FACE" },
      adminCookie,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      sucesso: true,
      unidade: "FACE",
      removidos: 1,
      periodo: "2026-2",
    });

    const alunos = await request("/api/alunos?periodo=2026-2", {
      headers: { Cookie: adminCookie },
    });
    const dados = (await alunos.json()) as Array<{ ra: string }>;
    expect(dados.some((aluno) => aluno.ra === "DEV-001")).toBe(false);
    expect(dados.some((aluno) => aluno.ra === "DEV-002")).toBe(true);
  });
});
