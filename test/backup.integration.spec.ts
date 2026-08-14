import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const baseUrl = "https://controle-documentos.test";
const senha = "SenhaSegura123";

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

async function login(identificador: string) {
  const response = await jsonRequest("/api/auth/login", "POST", {
    identificador,
    senha,
  });
  expect(response.status).toBe(200);
  return sessionCookie(response);
}

describe.sequential("backup administrativo", () => {
  let adminCookie = "";
  let visualizadorCookie = "";

  it("prepara usuários com perfis distintos", async () => {
    const bootstrap = await jsonRequest("/api/auth/bootstrap", "POST", {
      nome: "Administrador de Backup",
      email: "admin.backup@teste.local",
      username: "admin.backup",
      senha,
    });
    expect(bootstrap.status).toBe(201);
    adminCookie = await login("admin.backup");

    const criarVisualizador = await jsonRequest(
      "/api/usuarios",
      "POST",
      {
        nome: "Visualizador de Backup",
        email: "viewer.backup@teste.local",
        username: "viewer.backup",
        senha,
        perfil: "VISUALIZADOR",
      },
      adminCookie,
    );
    expect(criarVisualizador.status).toBe(201);
    visualizadorCookie = await login("viewer.backup");
  });

  it("informa ao administrador quando o backup não está configurado", async () => {
    const response = await request("/api/admin/backup/status", {
      headers: { Cookie: adminCookie },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ configurado: false });
  });

  it("bloqueia o status do backup para visualizadores", async () => {
    const response = await request("/api/admin/backup/status", {
      headers: { Cookie: visualizadorCookie },
    });
    expect(response.status).toBe(403);
  });
});
