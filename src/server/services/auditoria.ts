export type UsuarioAuditoria = { id: number; nome: string; username: string };

export type EventoAuditoria = {
  acao: string;
  entidade: string;
  descricao: string;
  ra?: string | null;
  unidade?: string | null;
};

export async function registrarAuditoria(
  db: D1Database,
  usuario: UsuarioAuditoria | null,
  periodoId: number | null,
  evento: EventoAuditoria,
) {
  try {
    await db.prepare(`INSERT INTO logs (
      acao, entidade, descricao, ra, unidade, periodo_id,
      usuario_id, usuario_nome, usuario_username
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        evento.acao, evento.entidade, evento.descricao,
        evento.ra || null, evento.unidade || null, periodoId,
        usuario?.id ?? null, usuario?.nome ?? null, usuario?.username ?? null,
      )
      .run();
  } catch (erro) {
    console.error("Falha ao registrar auditoria:", erro);
  }
}
