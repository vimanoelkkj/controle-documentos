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

type Periodo = {
  id: number;
  codigo: string;
  status: "ATIVO" | "ARQUIVADO";
  total_alunos: number;
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

  it("rejeita documentos de aluno inexistente sem alterar o aluno valido", async () => {
    const response = await jsonRequest(
      "/api/alunos/RA-INEXISTENTE/documentos?periodo=2026-2",
      "PUT",
      {
        identidade: false,
        cpf: false,
        certidao: true,
        residencia: true,
        titulo: true,
        ensino_medio: true,
        contrato: true,
      },
      adminCookie,
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      erro: "Aluno não encontrado.",
    });

    const alunos = await listarAlunos("2026-2");
    expect(alunos[0]).toMatchObject({ identidade: 1, cpf: 1 });
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

  it("arquiva e reativa o período preservando seus dados", async () => {
    const listarPeriodos = () =>
      request("/api/periodos", { headers: { Cookie: adminCookie } });

    const respostaInicial = await listarPeriodos();
    expect(respostaInicial.status).toBe(200);
    const periodosIniciais = await respostaInicial.json<Periodo[]>();
    const periodo = periodosIniciais.find((item) => item.codigo === "2027-1");
    expect(periodo).toBeDefined();

    const arquivar = await jsonRequest(
      `/api/periodos/${periodo!.id}`,
      "PUT",
      { status: "ARQUIVADO" },
      adminCookie,
    );
    expect(arquivar.status).toBe(200);
    await expect(arquivar.json()).resolves.toMatchObject({
      id: periodo!.id,
      codigo: "2027-1",
      status: "ARQUIVADO",
    });

    const respostaArquivado = await listarPeriodos();
    const periodosArquivados = await respostaArquivado.json<Periodo[]>();
    expect(
      periodosArquivados.find((item) => item.id === periodo!.id)?.status,
    ).toBe("ARQUIVADO");

    const reativar = await jsonRequest(
      `/api/periodos/${periodo!.id}`,
      "PUT",
      { status: "ATIVO" },
      adminCookie,
    );
    expect(reativar.status).toBe(200);
    await expect(reativar.json()).resolves.toMatchObject({
      id: periodo!.id,
      codigo: "2027-1",
      status: "ATIVO",
    });

    const respostaReativado = await listarPeriodos();
    const periodosReativados = await respostaReativado.json<Periodo[]>();
    const periodoReativado = periodosReativados.find(
      (item) => item.id === periodo!.id,
    );
    expect(periodoReativado).toMatchObject({
      status: "ATIVO",
      total_alunos: 1,
    });

    const alunos = await listarAlunos("2027-1");
    expect(alunos).toHaveLength(1);
    expect(alunos[0].ra).toBe(raCompartilhado);
  });

  it("rejeita edição sem os campos cadastrais obrigatórios", async () => {
    const response = await jsonRequest(
      `/api/alunos/${encodeURIComponent(raCompartilhado)}?periodo=2026-2`,
      "PUT",
      {
        ra: raCompartilhado,
        nome: "",
        curso: "ADMINISTRAÇÃO",
        unidade: "FCH",
      },
      adminCookie,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      erro: "RA, nome, curso e unidade são obrigatórios.",
    });

    const alunos = await listarAlunos("2026-2");
    expect(alunos[0]).toMatchObject({
      ra: raCompartilhado,
      nome: "Aluno A Atualizado",
      unidade: "FCH",
    });
  });

  it("impede trocar o RA por outro já usado no mesmo período", async () => {
    const segundoRa = "RA-ISOLAMENTO-002";
    const cadastrar = await jsonRequest(
      "/api/alunos?periodo=2026-2",
      "POST",
      {
        ra: segundoRa,
        nome: "Segundo Aluno",
        curso: "ADMINISTRAÇÃO",
        unidade: "FACE",
      },
      adminCookie,
    );
    expect(cadastrar.status).toBe(201);

    const response = await jsonRequest(
      `/api/alunos/${encodeURIComponent(segundoRa)}?periodo=2026-2`,
      "PUT",
      {
        ra: raCompartilhado,
        nome: "Segundo Aluno",
        curso: "ADMINISTRAÇÃO",
        unidade: "FACE",
      },
      adminCookie,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      erro: "Já existe outro aluno com este RA.",
    });

    const alunos = await listarAlunos("2026-2");
    expect(alunos.map((aluno) => aluno.ra)).toEqual(
      expect.arrayContaining([raCompartilhado, segundoRa]),
    );
  });
});
