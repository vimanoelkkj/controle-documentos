import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

type JsonObject = Record<string, unknown>;

const baseUrl = "https://controle-documentos.test";

function request(path: string, init: RequestInit = {}) {
  return exports.default.fetch(`${baseUrl}${path}`, init);
}

function jsonRequest(path: string, method: string, body: JsonObject) {
  return request(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function sessionCookie(response: Response) {
  const setCookie = response.headers.get("Set-Cookie");
  expect(setCookie).toBeTruthy();
  return setCookie!.split(";", 1)[0];
}

async function login(identificador: string, senha: string) {
  const response = await jsonRequest("/api/auth/login", "POST", {
    identificador,
    senha,
  });

  return { response, cookie: sessionCookie(response) };
}

describe.sequential("autenticação e permissões", () => {
  const senha = "SenhaSegura123";
  let adminCookie = "";

  it("inicia sem administrador e protege a sessão", async () => {
    const bootstrap = await request("/api/auth/bootstrap");
    expect(bootstrap.status).toBe(200);
    await expect(bootstrap.json()).resolves.toMatchObject({ necessario: true });

    const me = await request("/api/auth/me");
    expect(me.status).toBe(401);
  });

  it("cria somente um administrador inicial", async () => {
    const primeiro = await jsonRequest("/api/auth/bootstrap", "POST", {
      nome: "Administrador de Teste",
      email: "admin@teste.local",
      username: "admin.teste",
      senha,
    });
    expect(primeiro.status).toBe(201);

    const repetido = await jsonRequest("/api/auth/bootstrap", "POST", {
      nome: "Outro Administrador",
      email: "outro@teste.local",
      username: "outro.admin",
      senha,
    });
    expect(repetido.status).toBe(409);
  });

  it("rejeita senha incorreta e cria uma sessão válida", async () => {
    const invalido = await jsonRequest("/api/auth/login", "POST", {
      identificador: "admin.teste",
      senha: "senha-incorreta",
    });
    expect(invalido.status).toBe(401);

    const loginAdmin = await login("admin.teste", senha);
    expect(loginAdmin.response.status).toBe(200);
    adminCookie = loginAdmin.cookie;

    const me = await request("/api/auth/me", {
      headers: { Cookie: adminCookie },
    });
    expect(me.status).toBe(200);
    await expect(me.json()).resolves.toMatchObject({
      usuario: { username: "admin.teste", perfil: "ADMIN" },
    });
  });

  it("aplica permissões diferentes para ADMIN, EDITOR e VISUALIZADOR", async () => {
    const criarEditor = await jsonRequestComSessao(
      "/api/usuarios",
      "POST",
      {
        nome: "Editor de Teste",
        email: "editor@teste.local",
        username: "editor.teste",
        senha,
        perfil: "EDITOR",
      },
      adminCookie,
    );
    expect(criarEditor.status).toBe(201);

    const criarVisualizador = await jsonRequestComSessao(
      "/api/usuarios",
      "POST",
      {
        nome: "Visualizador de Teste",
        email: "visualizador@teste.local",
        username: "visualizador.teste",
        senha,
        perfil: "VISUALIZADOR",
      },
      adminCookie,
    );
    expect(criarVisualizador.status).toBe(201);

    const editor = await login("editor.teste", senha);
    const visualizador = await login("visualizador.teste", senha);

    const usuariosComoAdmin = await request("/api/usuarios", {
      headers: { Cookie: adminCookie },
    });
    expect(usuariosComoAdmin.status).toBe(200);

    const usuariosComoEditor = await request("/api/usuarios", {
      headers: { Cookie: editor.cookie },
    });
    expect(usuariosComoEditor.status).toBe(403);

    const usuariosComoVisualizador = await request("/api/usuarios", {
      headers: { Cookie: visualizador.cookie },
    });
    expect(usuariosComoVisualizador.status).toBe(403);
  });

  it("invalida a sessão no logout", async () => {
    const logout = await request("/api/auth/logout", {
      method: "POST",
      headers: { Cookie: adminCookie },
    });
    expect(logout.status).toBe(200);

    const me = await request("/api/auth/me", {
      headers: { Cookie: adminCookie },
    });
    expect(me.status).toBe(401);
  });
});

function jsonRequestComSessao(
  path: string,
  method: string,
  body: JsonObject,
  cookie: string,
) {
  return request(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify(body),
  });
}
