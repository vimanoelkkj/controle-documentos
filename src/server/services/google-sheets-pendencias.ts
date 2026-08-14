import type { UsuarioAuditoria } from "./auditoria";

type AlunoPendente = {
  ra: string; nome: string; email: string | null; email_outro: string | null;
  curso: string; unidade: string; identidade: number; cpf: number;
  certidao: number; residencia: number; titulo: number; ensino_medio: number;
  contrato: number; status: "ATIVO" | "CANCELADO";
};

export async function registrarPendenciaGoogleSheets(
  db: D1Database,
  usuario: UsuarioAuditoria | null,
  periodoId: number,
  ra: string,
  operacao: "ATUALIZAR" | "REMOVER" = "ATUALIZAR",
  motivo = "ATUALIZAÃ‡ÃƒO",
) {
  let payload: string | null = null;
  if (operacao === "ATUALIZAR") {
    const aluno = await db.prepare(`
      SELECT a.ra, a.nome, a.email, a.email_outro, a.curso, a.unidade, a.status,
             d.identidade, d.cpf, d.certidao, d.residencia, d.titulo,
             d.ensino_medio, d.contrato
      FROM alunos a
      LEFT JOIN documentos d ON d.aluno_id = a.id
      WHERE a.periodo_id = ? AND a.ra = ?`)
      .bind(periodoId, ra)
      .first<AlunoPendente>();
    if (!aluno) operacao = "REMOVER";
    else payload = JSON.stringify(aluno);
  }

  await db.prepare(`INSERT INTO google_sheets_pendencias (
      periodo_id, ra, operacao, payload_json, status,
      tentativas, ultimo_erro, usuario_id, usuario_nome, usuario_username, motivos
    ) VALUES (?, ?, ?, ?, 'PENDENTE', 0, NULL, ?, ?, ?, ?)
    ON CONFLICT(periodo_id, ra) DO UPDATE SET
      operacao = excluded.operacao,
      payload_json = excluded.payload_json,
      status = 'PENDENTE',
      tentativas = 0,
      ultimo_erro = NULL,
      usuario_id = excluded.usuario_id,
      usuario_nome = excluded.usuario_nome,
      usuario_username = excluded.usuario_username,
      motivos = CASE
        WHEN instr('|' || google_sheets_pendencias.motivos || '|', '|' || excluded.motivos || '|') > 0
          THEN google_sheets_pendencias.motivos
        WHEN google_sheets_pendencias.motivos = '' THEN excluded.motivos
        ELSE google_sheets_pendencias.motivos || '|' || excluded.motivos
      END,
      atualizado_em = CURRENT_TIMESTAMP`)
    .bind(
      periodoId, ra, operacao, payload,
      usuario?.id ?? null, usuario?.nome ?? null, usuario?.username ?? null,
      motivo,
    )
    .run();
}
