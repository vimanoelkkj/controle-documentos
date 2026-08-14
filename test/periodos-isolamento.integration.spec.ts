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
};

const baseUrl = "https://controle-documentos.test";
const senha = "SenhaSegura123";
const raCompartilhado = "RA-ISOLAMENTO-001";

let adminCookie = "";

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

async function listarAlunos(periodo: string) {
  const response = await request(`/api/alunos?periodo=${periodo}`, {
    headers: { Cookie: adminCookie },
  });
  expect(response.status).toBe(200);
  return response.json<Aluno[]>();
}

beforeAll(async () => {
  const bootstrap = await jsonRequest("/api/auth/bootstrap", "POST", {
    nome: "Administrador de Isolamento",
    email: "admin.isolamento@teste.local",
    username: "admin.isolamento",
    senha,
  });
  expect(bootstrap.status).toBe(201);

  const login = await jsonRequest("/api/auth/login", "POST", {
    identificador: "admin.isolamento",
    senha,
  });
  expect(login.status).toBe(200);
  adminCookie = sessionCookie(login);

  const novoPeriodo = await jsonRequest(
    "/api/periodos",
    "POST",
    { codigo: "2027-1" },
    adminCookie,
  );
  expect(novoPeriodo.status).toBe(201);
});

describe.sequential("isolamento de dados entre períodos", () => {
  it("permite o mesmo RA em períodos diferentes", async () => {
    const periodoA = await jsonRequest(
      "/api/alunos?periodo=2026-2",
      "POST",
      {
        ra: raCompartilhado,
        nome: "Aluno do Período A",
        curso: "ADMINISTRAÇÃO",
        unidade: "FACE",
      },
      adminCookie,
    );
    expect(periodoA.status).toBe(201);

    const periodoB = await jsonRequest(
      "/api/alunos?periodo=2027-1",
      "POST",
      {
        ra: raCompartilhado,
        nome: "Aluno do Período B",
        curso: "ADMINISTRAÇÃO",
        unidade: "FEA",
      },
      adminCookie,
    );
    expect(periodoB.status).toBe(201);
  });

  it("lista somente os alunos do período solicitado", async () => {
    const alunosA = await listarAlunos("2026-2");
    const alunosB = await listarAlunos("2027-1");

    expect(alunosA).toHaveLength(1);
    expect(alunosA[0]).toMatchObject({
      ra: raCompartilhado,
      nome: "Aluno do Período A",
      unidade: "FACE",
    });

    expect(alunosB).toHaveLength(1);
    expect(alunosB[0]).toMatchObject({
      ra: raCompartilhado,
      nome: "Aluno do Período B",
      unidade: "FEA",
    });
  });

  it("mantém a edição cadastral restrita ao período atual", async () => {
    const atualizar = await jsonRequest(
      `/api/alunos/${encodeURIComponent(raCompartilhado)}?periodo=2026-2`,
      "PUT",
      {
        ra: raCompartilhado,
        nome: "Aluno A Atualizado",
        curso: "ADMINISTRAÇÃO",
        unidade: "FCH",
      },
      adminCookie,
    );
    expect(atualizar.status).toBe(200);

    const alunosA = await listarAlunos("2026-2");
    const alunosB = await listarAlunos("2027-1");

    expect(alunosA[0]).toMatchObject({
      nome: "Aluno A Atualizado",
      unidade: "FCH",
    });
    expect(alunosB[0]).toMatchObject({
      nome: "Aluno do Período B",
      unidade: "FEA",
    });
  });

  it("mantém os documentos restritos ao período atual", async () => {
    const atualizarDocumentos = await jsonRequest(
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
      adminCookie,
    );
    expect(atualizarDocumentos.status).toBe(200);

    const alunosA = await listarAlunos("2026-2");
    const alunosB = await listarAlunos("2027-1");

    expect(alunosA[0]).toMatchObject({ identidade: 1, cpf: 1 });
    expect(alunosB[0]).toMatchObject({ identidade: 0, cpf: 0 });
  });

  it("mantém a contagem de alunos separada por período", async () => {
    const response = await request("/api/periodos", {
      headers: { Cookie: adminCookie },
    });
    expect(response.status).toBe(200);

    const periodos = await response.json<
      Array<{ codigo: string; total_alunos: number }>
    >();
    const periodoA = periodos.find((periodo) => periodo.codigo === "2026-2");
    const periodoB = periodos.find((periodo) => periodo.codigo === "2027-1");

    expect(Number(periodoA?.total_alunos)).toBe(1);
    expect(Number(periodoB?.total_alunos)).toBe(1);
  });
});
