import { exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

type JsonObject = Record<string, unknown>;

type Usuario = {
  id: number;
  nome: string;
  username: string;
  perfil: "ADMIN" | "EDITOR" | "VISUALIZADOR";
  ativo: number;
};

const baseUrl = "https://controle-documentos.test";
const senhaInicial = "SenhaSegura123";
const senhaNova = "SenhaNova456";

let adminCookie = "";
let editorCookie = "";
let visualizadorCookie = "";
let adminId = 0;
let editorId = 0;
let visualizadorId = 0;

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

async function login(identificador: string, senha = senhaInicial) {
  const response = await jsonRequest("/api/auth/login", "POST", {
    identificador,
    senha,
  });
  return response;
}

async function listarUsuarios(cookie = adminCookie) {
  const response = await request("/api/usuarios", {
    headers: { Cookie: cookie },
  });
  expect(response.status).toBe(200);
  return response.json<Usuario[]>();
}

async function criarUsuario(usuario: {
  nome: string;
  email: string;
  username: string;
  perfil: Usuario["perfil"];
}) {
  const response = await jsonRequest(
    "/api/usuarios",
    "POST",
    { ...usuario, senha: senhaInicial },
    adminCookie,
  );
  expect(response.status).toBe(201);
  return response.json<{ id: number }>();
}

beforeAll(async () => {
  const bootstrap = await jsonRequest("/api/auth/bootstrap", "POST", {
    nome: "Administrador de Usuarios",
    email: "admin.usuarios@teste.local",
    username: "admin.usuarios",
    senha: senhaInicial,
  });
  expect(bootstrap.status).toBe(201);

  const loginAdmin = await login("admin.usuarios");
  expect(loginAdmin.status).toBe(200);
  adminCookie = sessionCookie(loginAdmin);

  const editor = await criarUsuario({
    nome: "Editor Gerenciado",
    email: "editor.gerenciado@teste.local",
    username: "editor.gerenciado",
    perfil: "EDITOR",
  });
  editorId = Number(editor.id);

  const visualizador = await criarUsuario({
    nome: "Visualizador Gerenciado",
    email: "visualizador.gerenciado@teste.local",
    username: "visualizador.gerenciado",
    perfil: "VISUALIZADOR",
  });
  visualizadorId = Number(visualizador.id);

  const usuarios = await listarUsuarios();
  adminId = usuarios.find((usuario) => usuario.username === "admin.usuarios")?.id ?? 0;
  expect(adminId).toBeGreaterThan(0);
  expect(editorId).toBeGreaterThan(0);
  expect(visualizadorId).toBeGreaterThan(0);

  const loginEditor = await login("editor.gerenciado");
  expect(loginEditor.status).toBe(200);
  editorCookie = sessionCookie(loginEditor);

  const loginVisualizador = await login("visualizador.gerenciado");
  expect(loginVisualizador.status).toBe(200);
  visualizadorCookie = sessionCookie(loginVisualizador);
});

describe.sequential("operacoes administrativas de usuarios", () => {
  it("restringe o gerenciamento de usuarios ao administrador", async () => {
    const listarComoEditor = await request("/api/usuarios", {
      headers: { Cookie: editorCookie },
    });
    expect(listarComoEditor.status).toBe(403);

    const editarComoVisualizador = await jsonRequest(
      `/api/usuarios/${editorId}`,
      "PUT",
      { nome: "Alteracao Indevida" },
      visualizadorCookie,
    );
    expect(editarComoVisualizador.status).toBe(403);

    const excluirComoEditor = await request(`/api/usuarios/${visualizadorId}`, {
      method: "DELETE",
      headers: { Cookie: editorCookie },
    });
    expect(excluirComoEditor.status).toBe(403);
  });

  it("impede o administrador de desativar ou excluir a propria conta", async () => {
    const desativar = await jsonRequest(
      `/api/usuarios/${adminId}`,
      "PUT",
      { ativo: false },
      adminCookie,
    );
    expect(desativar.status).toBe(400);

    const excluir = await request(`/api/usuarios/${adminId}`, {
      method: "DELETE",
      headers: { Cookie: adminCookie },
    });
    expect(excluir.status).toBe(400);

    const me = await request("/api/auth/me", {
      headers: { Cookie: adminCookie },
    });
    expect(me.status).toBe(200);
  });

  it("redefine a senha e encerra todas as sessoes anteriores", async () => {
    const redefinir = await jsonRequest(
      `/api/usuarios/${editorId}`,
      "PUT",
      { senha: senhaNova },
      adminCookie,
    );
    expect(redefinir.status).toBe(200);

    const sessaoAntiga = await request("/api/auth/me", {
      headers: { Cookie: editorCookie },
    });
    expect(sessaoAntiga.status).toBe(401);

    const senhaAntiga = await login("editor.gerenciado", senhaInicial);
    expect(senhaAntiga.status).toBe(401);

    const senhaAtual = await login("editor.gerenciado", senhaNova);
    expect(senhaAtual.status).toBe(200);
    editorCookie = sessionCookie(senhaAtual);
  });

  it("desativa a conta, invalida a sessao e permite reativacao", async () => {
    const desativar = await jsonRequest(
      `/api/usuarios/${editorId}`,
      "PUT",
      { ativo: false },
      adminCookie,
    );
    expect(desativar.status).toBe(200);

    const sessaoEncerrada = await request("/api/auth/me", {
      headers: { Cookie: editorCookie },
    });
    expect(sessaoEncerrada.status).toBe(401);

    const loginInativo = await login("editor.gerenciado", senhaNova);
    expect(loginInativo.status).toBe(401);

    const reativar = await jsonRequest(
      `/api/usuarios/${editorId}`,
      "PUT",
      { ativo: true },
      adminCookie,
    );
    expect(reativar.status).toBe(200);

    const loginReativado = await login("editor.gerenciado", senhaNova);
    expect(loginReativado.status).toBe(200);
    editorCookie = sessionCookie(loginReativado);
  });

  it("altera o perfil e aplica a nova permissao na sessao existente", async () => {
    const promover = await jsonRequest(
      `/api/usuarios/${editorId}`,
      "PUT",
      { perfil: "ADMIN" },
      adminCookie,
    );
    expect(promover.status).toBe(200);

    const usuariosComoNovoAdmin = await request("/api/usuarios", {
      headers: { Cookie: editorCookie },
    });
    expect(usuariosComoNovoAdmin.status).toBe(200);

    const restaurar = await jsonRequest(
      `/api/usuarios/${editorId}`,
      "PUT",
      { perfil: "EDITOR" },
      adminCookie,
    );
    expect(restaurar.status).toBe(200);

    const usuariosComoEditor = await request("/api/usuarios", {
      headers: { Cookie: editorCookie },
    });
    expect(usuariosComoEditor.status).toBe(403);
  });

  it("exclui a conta, encerra seu acesso e preserva os demais usuarios", async () => {
    const excluir = await request(`/api/usuarios/${visualizadorId}`, {
      method: "DELETE",
      headers: { Cookie: adminCookie },
    });
    expect(excluir.status).toBe(200);

    const sessaoExcluida = await request("/api/auth/me", {
      headers: { Cookie: visualizadorCookie },
    });
    expect(sessaoExcluida.status).toBe(401);

    const loginExcluido = await login("visualizador.gerenciado");
    expect(loginExcluido.status).toBe(401);

    const usuarios = await listarUsuarios();
    expect(
      usuarios.some((usuario) => usuario.username === "visualizador.gerenciado"),
    ).toBe(false);
    expect(usuarios.some((usuario) => usuario.username === "admin.usuarios")).toBe(
      true,
    );
    expect(
      usuarios.some((usuario) => usuario.username === "editor.gerenciado"),
    ).toBe(true);
  });
});
