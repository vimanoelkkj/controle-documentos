import { exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

type JsonObject = Record<string, unknown>;

type Log = {
  acao: string;
  entidade: string;
  descricao: string;
  ra: string | null;
  unidade: string | null;
  usuario_nome: string | null;
  usuario_username: string | null;
  periodo_codigo?: string;
};

const baseUrl = "https://controle-documentos.test";
const senha = "SenhaSegura123";
const acaoPeriodoA = "TESTE_LOG_PERIODO_A";
const acaoPeriodoB = "TESTE_LOG_PERIODO_B";
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

async function listarLogs(path: string) {
  const response = await request(path, {
    headers: { Cookie: adminCookie },
  });
  expect(response.status).toBe(200);
  return response.json<Log[]>();
}

beforeAll(async () => {
  const bootstrap = await request("/api/auth/bootstrap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nome: "Administrador dos Logs",
      email: "admin.logs@teste.local",
      username: "admin.logs",
      senha,
    }),
  });
  expect(bootstrap.status).toBe(201);

  const login = await request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identificador: "admin.logs", senha }),
  });
  expect(login.status).toBe(200);
  adminCookie = login.headers.get("Set-Cookie")!.split(";", 1)[0];

  const periodo = await jsonRequest("/api/periodos", "POST", {
    codigo: "2027-1",
  });
  expect(periodo.status).toBe(201);
});

describe.sequential("LOG de operações", () => {
  it("rejeita evento sem os campos obrigatórios", async () => {
    const response = await jsonRequest(
      "/api/log?periodo=2026-2",
      "POST",
      { acao: "", entidade: "ALUNO", descricao: "" },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      erro: "Dados insuficientes para registrar o LOG.",
    });
  });

  it("registra autoria e lista o evento no período atual", async () => {
    const registrar = await jsonRequest(
      "/api/log?periodo=2026-2",
      "POST",
      {
        acao: acaoPeriodoA,
        entidade: "ALUNO",
        descricao: "Evento controlado do período A.",
        ra: "RA-LOG-001",
        unidade: "FACE",
      },
    );
    expect(registrar.status).toBe(201);

    const logs = await listarLogs("/api/log?periodo=2026-2");
    expect(logs.find((log) => log.acao === acaoPeriodoA)).toMatchObject({
      entidade: "ALUNO",
      descricao: "Evento controlado do período A.",
      ra: "RA-LOG-001",
      unidade: "FACE",
      usuario_nome: "Administrador dos Logs",
      usuario_username: "admin.logs",
    });
  });

  it("mantém a listagem comum isolada por período", async () => {
    const registrar = await jsonRequest(
      "/api/log?periodo=2027-1",
      "POST",
      {
        acao: acaoPeriodoB,
        entidade: "PERIODO",
        descricao: "Evento controlado do período B.",
      },
    );
    expect(registrar.status).toBe(201);

    const logsA = await listarLogs("/api/log?periodo=2026-2");
    const logsB = await listarLogs("/api/log?periodo=2027-1");
    expect(logsA.some((log) => log.acao === acaoPeriodoB)).toBe(false);
    expect(logsB.some((log) => log.acao === acaoPeriodoB)).toBe(true);
  });

  it("oferece escopo global identificado e respeita o limite", async () => {
    const globais = await listarLogs("/api/log?periodo=2026-2&scope=all");
    expect(globais.find((log) => log.acao === acaoPeriodoA)).toMatchObject({
      periodo_codigo: "2026-2",
    });
    expect(globais.find((log) => log.acao === acaoPeriodoB)).toMatchObject({
      periodo_codigo: "2027-1",
    });

    const limitado = await listarLogs(
      "/api/log?periodo=2026-2&scope=all&limit=1",
    );
    expect(limitado).toHaveLength(1);
  });
});
