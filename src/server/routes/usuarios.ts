import { type PerfilUsuario, type UsuarioSessao } from "./auth";
import { emModoApresentacao } from "../middleware/autorizacao";

type EventoAuditoriaUsuario = {
  acao: string;
  entidade: string;
  descricao: string;
};

type UsuariosRouteContext = {
  request: Request;
  url: URL;
  db: D1Database;
  usuarioAtual: UsuarioSessao;
  hashSenha: (senha: string) => Promise<{ hash: string; salt: string }>;
  obterPeriodoAuditoriaId: () => Promise<number | null>;
  registrarAuditoria: (
    periodoId: number | null,
    evento: EventoAuditoriaUsuario,
  ) => Promise<void>;
};

const perfisValidos: PerfilUsuario[] = [
  "ADMIN",
  "EDITOR",
  "VISUALIZADOR",
];

function respostaSemPermissao() {
  return Response.json(
    { erro: "Apenas administradores podem gerenciar usuários." },
    { status: 403 },
  );
}

function podeGerenciarUsuarios(usuario: UsuarioSessao) {
  return usuario.perfil === "ADMIN" && !emModoApresentacao(usuario);
}

export async function handleUsuariosRoute({
  request,
  url,
  db,
  usuarioAtual,
  hashSenha,
  obterPeriodoAuditoriaId,
  registrarAuditoria,
}: UsuariosRouteContext): Promise<Response | null> {
  if (url.pathname === "/api/usuarios") {
    if (!podeGerenciarUsuarios(usuarioAtual)) return respostaSemPermissao();

    if (request.method === "GET") {
      const usuarios = await db
        .prepare(
          `SELECT id, nome, email, username, perfil, ativo, modo_apresentacao, criado_em FROM usuarios ORDER BY nome`,
        )
        .all();
      return Response.json(usuarios.results);
    }

    if (request.method === "POST") {
      const body = await request.json<{
        nome?: string;
        email?: string;
        username?: string;
        senha?: string;
        perfil?: PerfilUsuario;
        modo_apresentacao?: boolean;
      }>();
      const nome = body.nome?.trim();
      const email = body.email?.trim().toLowerCase();
      const username = body.username?.trim().toLowerCase();
      const senha = body.senha || "";
      const perfil = body.perfil;
      const modoApresentacao = body.modo_apresentacao ? 1 : 0;
      if (
        !nome ||
        !email ||
        !username ||
        senha.length < 8 ||
        !perfil ||
        !perfisValidos.includes(perfil)
      ) {
        return Response.json(
          { erro: "Dados de usuário inválidos." },
          { status: 400 },
        );
      }
      if (!/^[a-z0-9._-]{3,40}$/i.test(username)) {
        return Response.json(
          { erro: "Nome de usuário inválido." },
          { status: 400 },
        );
      }
      if (modoApresentacao && perfil !== "VISUALIZADOR") {
        return Response.json(
          {
            erro: "Modo apresentação é exclusivo para usuários visualizadores.",
          },
          { status: 400 },
        );
      }

      const cred = await hashSenha(senha);
      try {
        const result = await db
          .prepare(
            `INSERT INTO usuarios (
              nome,
              email,
              username,
              senha_hash,
              senha_salt,
              perfil,
              ativo,
              modo_apresentacao
            ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
          )
          .bind(
            nome,
            email,
            username,
            cred.hash,
            cred.salt,
            perfil,
            modoApresentacao,
          )
          .run();
        const periodoId = await obterPeriodoAuditoriaId();
        await registrarAuditoria(periodoId, {
          acao: "CRIAR",
          entidade: "USUARIO",
          descricao: modoApresentacao
            ? `Usuário ${nome} (@${username}) criado em modo de apresentação.`
            : `Usuário ${nome} (@${username}) criado com perfil ${perfil}.`,
        });
        return Response.json(
          { sucesso: true, id: result.meta.last_row_id },
          { status: 201 },
        );
      } catch {
        return Response.json(
          { erro: "E-mail ou nome de usuário já cadastrado." },
          { status: 409 },
        );
      }
    }

    return null;
  }

  const rotaUsuario = url.pathname.match(/^\/api\/usuarios\/(\d+)$/);
  if (!rotaUsuario || !["PUT", "DELETE"].includes(request.method)) {
    return null;
  }
  if (!podeGerenciarUsuarios(usuarioAtual)) return respostaSemPermissao();

  const id = Number(rotaUsuario[1]);

  if (request.method === "PUT") {
    const body = await request.json<{
      nome?: string;
      perfil?: PerfilUsuario;
      ativo?: boolean;
      senha?: string;
      modo_apresentacao?: boolean;
    }>();

    if (id === usuarioAtual.id && body.ativo === false) {
      return Response.json(
        { erro: "Você não pode desativar seu próprio usuário." },
        { status: 400 },
      );
    }
    if (body.perfil && !perfisValidos.includes(body.perfil)) {
      return Response.json({ erro: "Perfil inválido." }, { status: 400 });
    }
    if (body.senha && body.senha.length < 8) {
      return Response.json(
        { erro: "A nova senha deve ter pelo menos 8 caracteres." },
        { status: 400 },
      );
    }

    const atual = await db
      .prepare(
        `SELECT id, nome, username, perfil, ativo, modo_apresentacao
         FROM usuarios
         WHERE id = ?`,
      )
      .bind(id)
      .first<{
        id: number;
        nome: string;
        username: string;
        perfil: PerfilUsuario;
        ativo: number;
        modo_apresentacao: number;
      }>();
    if (!atual) {
      return Response.json(
        { erro: "Usuário não encontrado." },
        { status: 404 },
      );
    }

    const nome = body.nome?.trim() || atual.nome;
    const perfil = body.perfil || atual.perfil;
    const ativo = body.ativo === undefined ? atual.ativo : body.ativo ? 1 : 0;
    const modoApresentacao =
      body.modo_apresentacao === undefined
        ? atual.modo_apresentacao
        : body.modo_apresentacao
          ? 1
          : 0;

    if (modoApresentacao && perfil !== "VISUALIZADOR") {
      return Response.json(
        {
          erro: "Modo apresentação é exclusivo para usuários visualizadores.",
        },
        { status: 400 },
      );
    }

    const deixaDeSerAdminAtivo =
      atual.perfil === "ADMIN" &&
      atual.ativo === 1 &&
      (perfil !== "ADMIN" || ativo === 0);

    if (deixaDeSerAdminAtivo) {
      const outrosAdmins = await db
        .prepare(
          `SELECT COUNT(*) AS total
           FROM usuarios
           WHERE perfil = 'ADMIN' AND ativo = 1 AND id <> ?`,
        )
        .bind(id)
        .first<{ total: number }>();
      if (Number(outrosAdmins?.total || 0) === 0) {
        return Response.json(
          {
            erro: "Não é possível desativar ou remover o perfil do último administrador ativo.",
          },
          { status: 409 },
        );
      }
    }

    await db
      .prepare(
        `UPDATE usuarios
         SET nome = ?, perfil = ?, ativo = ?, modo_apresentacao = ?,
             atualizado_em = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(nome, perfil, ativo, modoApresentacao, id)
      .run();

    if (body.senha) {
      const cred = await hashSenha(body.senha);
      await db
        .prepare(
          `UPDATE usuarios
           SET senha_hash = ?, senha_salt = ?, atualizado_em = CURRENT_TIMESTAMP
           WHERE id = ?`,
        )
        .bind(cred.hash, cred.salt, id)
        .run();
      await db.prepare(`DELETE FROM sessoes WHERE usuario_id = ?`).bind(id).run();
    }

    if (atual.ativo === 1 && ativo === 0) {
      await db.prepare(`DELETE FROM sessoes WHERE usuario_id = ?`).bind(id).run();
    }

    const alteracoes = [
      nome !== atual.nome ? `nome: ${atual.nome} → ${nome}` : null,
      perfil !== atual.perfil ? `perfil: ${atual.perfil} → ${perfil}` : null,
      ativo !== atual.ativo
        ? `status: ${atual.ativo ? "ativo" : "inativo"} → ${ativo ? "ativo" : "inativo"}`
        : null,
      modoApresentacao !== atual.modo_apresentacao
        ? `modo apresentação: ${atual.modo_apresentacao ? "ativo" : "inativo"} → ${modoApresentacao ? "ativo" : "inativo"}`
        : null,
      body.senha ? "senha redefinida e sessões encerradas" : null,
    ].filter(Boolean);
    const periodoId = await obterPeriodoAuditoriaId();
    await registrarAuditoria(periodoId, {
      acao:
        body.senha && alteracoes.length === 1 ? "REDEFINIR_SENHA" : "EDITAR",
      entidade: "USUARIO",
      descricao: `Usuário ${atual.nome} atualizado: ${
        alteracoes.join("; ") || "sem mudanças efetivas"
      }.`,
    });

    return Response.json({ sucesso: true });
  }

  if (id === usuarioAtual.id) {
    return Response.json(
      { erro: "Você não pode excluir seu próprio usuário." },
      { status: 400 },
    );
  }

  const usuarioExcluir = await db
    .prepare(
      `SELECT id, nome, username, perfil, ativo FROM usuarios WHERE id = ?`,
    )
    .bind(id)
    .first<{
      id: number;
      nome: string;
      username: string;
      perfil: PerfilUsuario;
      ativo: number;
    }>();
  if (!usuarioExcluir) {
    return Response.json(
      { erro: "Usuário não encontrado." },
      { status: 404 },
    );
  }

  if (usuarioExcluir.perfil === "ADMIN" && usuarioExcluir.ativo === 1) {
    const outrosAdmins = await db
      .prepare(
        `SELECT COUNT(*) AS total
         FROM usuarios
         WHERE perfil = 'ADMIN' AND ativo = 1 AND id <> ?`,
      )
      .bind(id)
      .first<{ total: number }>();
    if (Number(outrosAdmins?.total || 0) === 0) {
      return Response.json(
        { erro: "Não é possível excluir o último administrador ativo." },
        { status: 409 },
      );
    }
  }

  const periodoId = await obterPeriodoAuditoriaId();
  await registrarAuditoria(periodoId, {
    acao: "EXCLUIR",
    entidade: "USUARIO",
    descricao: `Usuário ${usuarioExcluir.nome} (@${usuarioExcluir.username}) excluído.`,
  });
  await db.prepare(`DELETE FROM usuarios WHERE id = ?`).bind(id).run();

  return Response.json({ sucesso: true });
}
