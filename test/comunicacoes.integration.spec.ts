import { exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

type JsonObject = Record<string, unknown>;

type Comunicacao = {
  id: number;
  grupo_chave: string;
  unidade: string;
  documentos: string[];
  quantidade_alunos: number;
  quantidade_emails: number;
  assunto: string;
  ras: string[];
};

const baseUrl = "https://controle-documentos.test";
const senha = "SenhaSegura123";
let adminCookie = "";
let apresentacaoCookie = "";

function request(path: string, init: RequestInit = {}) {
  return exports.default.fetch(`${baseUrl}${path}`, init);
}

function jsonRequest(
  path: string,
  method: string,
  body: JsonObject,
  cookie = adminCookie,
) {
  return request(path, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  });
}

async function login(identificador: string) {
  const response = await request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identificador, senha }),
  });
  expect(response.status).toBe(200);
  return response.headers.get("Set-Cookie")!.split(";", 1)[0];
}

async function listar(periodo: string, cookie = adminCookie, limit?: number) {
  const sufixo = limit ? `&limit=${limit}` : "";
  const response = await request(
    `/api/comunicacoes?periodo=${periodo}${sufixo}`,
    { headers: { Cookie: cookie } },
  );
  expect(response.status).toBe(200);
  return response.json<Comunicacao[]>();
}

function cobranca(grupo: string) {
  return {
    grupo_chave: grupo,
    unidade: "FACE",
    documentos: ["Identidade", "CPF"],
    quantidade_alunos: 2,
    quantidade_emails: 3,
    assunto: `Cobrança ${grupo}`,
    prazo: "15/08",
    tipo_destinatario: "ambos",
    ras: [`${grupo}-001`, `${grupo}-002`],
  };
}

beforeAll(async () => {
  const bootstrap = await request("/api/auth/bootstrap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nome: "Administrador de Comunicação",
      email: "admin.comunicacao@teste.local",
      username: "admin.comunicacao",
      senha,
    }),
  });
  expect(bootstrap.status).toBe(201);
  adminCookie = await login("admin.comunicacao");

  const periodo = await jsonRequest("/api/periodos", "POST", {
    codigo: "2027-1",
  });
  expect(periodo.status).toBe(201);

  const usuario = await jsonRequest(
    "/api/usuarios?periodo=2026-2",
    "POST",
    {
      nome: "Apresentador",
      email: "apresentador@teste.local",
      username: "apresentador",
      senha,
      perfil: "VISUALIZADOR",
      modo_apresentacao: true,
    },
  );
  expect(usuario.status).toBe(201);
  apresentacaoCookie = await login("apresentador");
});

describe.sequential("histórico de comunicações", () => {
  it("rejeita cobrança sem dados suficientes", async () => {
    const response = await jsonRequest(
      "/api/comunicacoes?periodo=2026-2",
      "POST",
      {
        grupo_chave: "",
        documentos: [],
        ras: [],
        quantidade_alunos: 0,
      },
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      erro: "Dados insuficientes para registrar a cobrança.",
    });
  });

  it("registra e devolve o histórico mais recente primeiro", async () => {
    const primeira = await jsonRequest(
      "/api/comunicacoes?periodo=2026-2",
      "POST",
      cobranca("GRUPO-A"),
    );
    const segunda = await jsonRequest(
      "/api/comunicacoes?periodo=2026-2",
      "POST",
      cobranca("GRUPO-B"),
    );
    expect(primeira.status).toBe(201);
    expect(segunda.status).toBe(201);

    const historico = await listar("2026-2", adminCookie, 1);
    expect(historico).toHaveLength(1);
    expect(historico[0]).toMatchObject({
      grupo_chave: "GRUPO-B",
      documentos: ["Identidade", "CPF"],
      quantidade_emails: 3,
      ras: ["GRUPO-B-001", "GRUPO-B-002"],
    });
  });

  it("mantém as comunicações isoladas por período", async () => {
    const response = await jsonRequest(
      "/api/comunicacoes?periodo=2027-1",
      "POST",
      cobranca("GRUPO-C"),
    );
    expect(response.status).toBe(201);

    const historicoA = await listar("2026-2");
    const historicoB = await listar("2027-1");
    expect(historicoA.some((item) => item.grupo_chave === "GRUPO-C")).toBe(
      false,
    );
    expect(historicoB.some((item) => item.grupo_chave === "GRUPO-C")).toBe(
      true,
    );
  });

  it("oculta destinatários e bloqueia escrita no modo apresentação", async () => {
    const historico = await listar("2026-2", apresentacaoCookie);
    expect(historico[0]).toMatchObject({ quantidade_emails: 0, ras: [] });

    const response = await jsonRequest(
      "/api/comunicacoes?periodo=2026-2",
      "POST",
      cobranca("BLOQUEADO"),
      apresentacaoCookie,
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      erro: "Ação indisponível no modo apresentação.",
    });
  });
});
