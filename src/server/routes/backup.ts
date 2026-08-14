import type { UsuarioSessao } from "./auth";

interface BackupEnv {
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  D1_DATABASE_ID?: string;
}

type EstadoExportacaoD1 = {
  at_bookmark?: string;
  status?: "complete" | "error";
  error?: string;
  result?: {
    filename?: string;
    signed_url?: string;
  };
};

type RespostaCloudflare<T> = {
  success: boolean;
  result?: T;
  errors?: Array<{ message?: string }>;
};

type EventoBackup = {
  acao: "BACKUP";
  entidade: "BANCO_D1";
  descricao: string;
};

type BackupRouteContext = {
  request: Request;
  url: URL;
  env: BackupEnv;
  usuarioAtual: UsuarioSessao | null;
  obterPeriodoAuditoriaId: () => Promise<number | null>;
  registrarAuditoria: (
    periodoId: number | null,
    evento: EventoBackup,
  ) => Promise<void>;
};

function aguardar(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backupConfigurado(env: BackupEnv) {
  return Boolean(
    env.CLOUDFLARE_ACCOUNT_ID?.trim() &&
      env.CLOUDFLARE_API_TOKEN?.trim() &&
      env.D1_DATABASE_ID?.trim(),
  );
}

async function solicitarExportacaoD1(env: BackupEnv) {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = env.CLOUDFLARE_API_TOKEN?.trim();
  const databaseId = env.D1_DATABASE_ID?.trim();

  if (!accountId || !apiToken || !databaseId) {
    throw new Error("O backup online ainda nao foi configurado no Worker.");
  }

  const endpoint =
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
      accountId,
    )}` + `/d1/database/${encodeURIComponent(databaseId)}/export`;
  const headers = {
    Authorization: `Bearer ${apiToken}`,
    "Content-Type": "application/json",
  };

  let bookmark: string | undefined;
  for (let tentativa = 0; tentativa < 60; tentativa += 1) {
    const resposta = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        output_format: "polling",
        ...(bookmark ? { current_bookmark: bookmark } : {}),
      }),
    });
    const dados =
      (await resposta.json()) as RespostaCloudflare<EstadoExportacaoD1>;

    if (!resposta.ok || !dados.success || !dados.result) {
      const detalhe = dados.errors
        ?.map((erro) => erro.message)
        .filter(Boolean)
        .join("; ");
      throw new Error(detalhe || "A Cloudflare recusou a exportacao do D1.");
    }

    bookmark = dados.result.at_bookmark || bookmark;
    if (dados.result.status === "error") {
      throw new Error(dados.result.error || "A exportacao do D1 falhou.");
    }
    if (dados.result.status === "complete") {
      const arquivo = dados.result.result?.filename;
      const downloadUrl = dados.result.result?.signed_url;
      if (!arquivo || !downloadUrl) {
        throw new Error(
          "A exportacao terminou sem fornecer o arquivo para download.",
        );
      }
      return { arquivo, downloadUrl };
    }
    if (!bookmark) {
      throw new Error(
        "A Cloudflare nao forneceu o identificador da exportacao.",
      );
    }
    await aguardar(1000);
  }

  throw new Error(
    "O backup demorou mais que o esperado. Tente novamente em instantes.",
  );
}

export async function handleBackupRoute({
  request,
  url,
  env,
  usuarioAtual,
  obterPeriodoAuditoriaId,
  registrarAuditoria,
}: BackupRouteContext): Promise<Response | null> {
  if (url.pathname === "/api/admin/backup/status" && request.method === "GET") {
    if (usuarioAtual?.perfil !== "ADMIN") {
      return Response.json(
        { erro: "Apenas administradores podem acessar o backup." },
        { status: 403 },
      );
    }
    return Response.json({ configurado: backupConfigurado(env) });
  }

  if (url.pathname !== "/api/admin/backup" || request.method !== "POST") {
    return null;
  }
  if (usuarioAtual?.perfil !== "ADMIN") {
    return Response.json(
      { erro: "Apenas administradores podem gerar backups." },
      { status: 403 },
    );
  }

  try {
    const periodoId = await obterPeriodoAuditoriaId();
    await registrarAuditoria(periodoId, {
      acao: "BACKUP",
      entidade: "BANCO_D1",
      descricao:
        "Exportacao manual do banco D1 solicitada pelo painel administrativo.",
    });
    const exportacao = await solicitarExportacaoD1(env);
    return Response.json({
      sucesso: true,
      arquivo: exportacao.arquivo,
      download_url: exportacao.downloadUrl,
      expira_em_segundos: 3600,
    });
  } catch (erro) {
    console.error("Falha ao gerar backup do D1:", erro);
    return Response.json(
      {
        erro:
          erro instanceof Error
            ? erro.message
            : "Nao foi possivel gerar o backup do D1.",
      },
      { status: 500 },
    );
  }
}
