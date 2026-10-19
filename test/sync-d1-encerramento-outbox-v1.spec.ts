import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("PRÉ-F4: Validação da Atomicidade Estrita do Encerramento D1", () => {
  const periodoId = 1;
  const execToken = "sistema:manutencao_admin:f4_saneamento:EXEC_TEST_TOKEN";
  const timestampExecucao = "2026-10-19 23:59:59";

  // Fixtures 100% fictícias para compliance de dados
  const ra9Fixture = "RA-TESTE-009";
  const payload9Fixture = JSON.stringify({
    ra: ra9Fixture,
    nome: "ALUNO FICTICIO 1",
    email: "aluno1@exemplo.local",
    email_outro: "aluno1.outro@exemplo.local",
    curso: "CIENCIA DA COMPUTACAO",
    unidade: "FACE",
    status: "ATIVO",
    identidade: 0,
    cpf: 0,
    certidao: 0,
    residencia: 0,
    titulo: 0,
    ensino_medio: 1,
    contrato: 1,
  });

  const ra25Fixture = "RA-TESTE-025";
  const payload25Fixture = JSON.stringify({
    ra: ra25Fixture,
    nome: "ALUNA FICTICIA 2",
    email: "aluna2@exemplo.local",
    email_outro: "aluna2.outro@exemplo.local",
    curso: "ADMINISTRACAO",
    unidade: "FACE",
    status: "ATIVO",
    identidade: 1,
    cpf: 1,
    certidao: 1,
    residencia: 1,
    titulo: 1,
    ensino_medio: 1,
    contrato: 1,
  });

  async function resetTabelasTeste() {
    await env.DB.prepare(`DELETE FROM google_sheets_pendencias WHERE id IN (9, 25)`).run();
    await env.DB.prepare(`DELETE FROM logs WHERE acao = 'ENCERRAMENTO_ADMINISTRATIVO'`).run();

    await env.DB.prepare(
      `INSERT INTO google_sheets_pendencias (
        id, periodo_id, ra, operacao, payload_json, status, tentativas, ultimo_erro, usuario_username, criado_em, atualizado_em
      ) VALUES (9, ?, ?, 'ATUALIZAR', ?, 'PENDENTE', 0, NULL, NULL, '2026-08-15 22:32:44', '2026-10-19 15:32:00')`
    ).bind(periodoId, ra9Fixture, payload9Fixture).run();

    await env.DB.prepare(
      `INSERT INTO google_sheets_pendencias (
        id, periodo_id, ra, operacao, payload_json, status, tentativas, ultimo_erro, usuario_username, criado_em, atualizado_em
      ) VALUES (25, ?, ?, 'ATUALIZAR', ?, 'PENDENTE', 0, NULL, NULL, '2026-08-18 20:09:02', '2026-08-18 20:09:02')`
    ).bind(periodoId, ra25Fixture, payload25Fixture).run();
  }

  // Função que executa o script atômico via db.batch()
  async function executarScriptSaneamento(token = execToken) {
    const statements = [
      env.DB.prepare(`
        UPDATE google_sheets_pendencias
        SET status = 'CONCLUIDA',
            usuario_username = ?,
            ultimo_erro = NULL,
            atualizado_em = ?
        WHERE id = 9
          AND periodo_id = 1
          AND ra = ?
          AND operacao = 'ATUALIZAR'
          AND status = 'PENDENTE'
          AND tentativas = 0
          AND atualizado_em = '2026-10-19 15:32:00'
          AND payload_json = ?
      `).bind(token, timestampExecucao, ra9Fixture, payload9Fixture),
      env.DB.prepare(`
        UPDATE google_sheets_pendencias
        SET status = 'CONCLUIDA',
            usuario_username = ?,
            ultimo_erro = NULL,
            atualizado_em = ?
        WHERE id = 25
          AND periodo_id = 1
          AND ra = ?
          AND operacao = 'ATUALIZAR'
          AND status = 'PENDENTE'
          AND tentativas = 0
          AND atualizado_em = '2026-08-18 20:09:02'
          AND payload_json = ?
      `).bind(token, timestampExecucao, ra25Fixture, payload25Fixture),
      env.DB.prepare(`
        INSERT INTO logs (
          periodo_id, acao, entidade, descricao, ra, unidade, usuario_id, usuario_nome, usuario_username, criado_em
        ) VALUES (
          1,
          (SELECT CASE WHEN COUNT(*) = 2 THEN 'ENCERRAMENTO_ADMINISTRATIVO' ELSE NULL END
           FROM google_sheets_pendencias
           WHERE id IN (9, 25)
             AND status = 'CONCLUIDA'
             AND usuario_username = ?
             AND atualizado_em = ?
          ),
          'GOOGLE_SHEETS_OUTBOX',
          'Encerramento seguro e auditado de 2 pendencias legadas V1 (IDs 9 e 25). Fila de saida saneada para F4.',
          'RA-TESTE-009, RA-TESTE-025', 'FACE', NULL, 'MANUTENÇÃO TÉCNICA OFFLINE (PRÉ-F4)', 'sistema:manutencao_admin', CURRENT_TIMESTAMP
        )
      `).bind(token, timestampExecucao)
    ];

    return await env.DB.batch(statements);
  }

  it("1. Sucesso Duplo: encerra exclusivamente as duas pendências e grava auditoria única com token desta execução", async () => {
    await resetTabelasTeste();

    const batchRes = await executarScriptSaneamento();
    expect(batchRes).toBeDefined();

    // Confere que ambos os registros agora estão 'CONCLUIDA' com o token de execução
    const rows = await env.DB.prepare(`SELECT id, status, usuario_username, atualizado_em FROM google_sheets_pendencias WHERE id IN (9, 25)`).all<{ id: number; status: string; usuario_username: string; atualizado_em: string }>();
    expect(rows.results).toHaveLength(2);
    expect(rows.results[0].status).toBe("CONCLUIDA");
    expect(rows.results[0].usuario_username).toBe(execToken);
    expect(rows.results[0].atualizado_em).toBe(timestampExecucao);
    expect(rows.results[1].status).toBe("CONCLUIDA");
    expect(rows.results[1].usuario_username).toBe(execToken);
    expect(rows.results[1].atualizado_em).toBe(timestampExecucao);

    // Confere auditoria
    const auditLogs = await env.DB.prepare(`SELECT acao, entidade, usuario_username FROM logs WHERE acao = 'ENCERRAMENTO_ADMINISTRATIVO'`).all<{ acao: string; entidade: string; usuario_username: string }>();
    expect(auditLogs.results).toHaveLength(1);
    expect(auditLogs.results[0].usuario_username).toBe("sistema:manutencao_admin");
  });

  it("2. Registro ID 9 previamente concluído: impede conclusão falsa de ID 25 e força rollback total", async () => {
    await resetTabelasTeste();

    // ID 9 já foi concluído anteriormente (fora desta execução)
    await env.DB.prepare(`UPDATE google_sheets_pendencias SET status = 'CONCLUIDA', usuario_username = 'sistema:admin_antigo' WHERE id = 9`).run();

    // Execução do lote deve falhar porque o UPDATE de 9 não é aplicado e COUNT(*) com token atual será 1
    await expect(executarScriptSaneamento()).rejects.toThrow(/NOT NULL constraint failed/);

    // Rollback Total: ID 25 permaneceu PENDENTE
    const rows = await env.DB.prepare(`SELECT id, status, usuario_username FROM google_sheets_pendencias WHERE id IN (9, 25)`).all<{ id: number; status: string; usuario_username: string }>();
    expect(rows.results.find(r => r.id === 9)?.usuario_username).toBe("sistema:admin_antigo");
    expect(rows.results.find(r => r.id === 25)?.status).toBe("PENDENTE");

    // Nenhuma auditoria gravada
    const auditLogs = await env.DB.prepare(`SELECT COUNT(*) as cnt FROM logs WHERE acao = 'ENCERRAMENTO_ADMINISTRATIVO'`).first<{ cnt: number }>();
    expect(auditLogs?.cnt).toBe(0);
  });

  it("3. Registro ID 25 previamente concluído: impede conclusão falsa de ID 9 e força rollback total", async () => {
    await resetTabelasTeste();

    // ID 25 já concluído antes
    await env.DB.prepare(`UPDATE google_sheets_pendencias SET status = 'CONCLUIDA', usuario_username = 'sistema:admin_antigo' WHERE id = 25`).run();

    // Execução do lote falha e reverte
    await expect(executarScriptSaneamento()).rejects.toThrow(/NOT NULL constraint failed/);

    // Rollback Total: ID 9 permaneceu PENDENTE
    const rows = await env.DB.prepare(`SELECT id, status FROM google_sheets_pendencias WHERE id IN (9, 25)`).all<{ id: number; status: string }>();
    expect(rows.results.find(r => r.id === 9)?.status).toBe("PENDENTE");

    const auditLogs = await env.DB.prepare(`SELECT COUNT(*) as cnt FROM logs WHERE acao = 'ENCERRAMENTO_ADMINISTRATIVO'`).first<{ cnt: number }>();
    expect(auditLogs?.cnt).toBe(0);
  });

  it("4. Replay subsequente (ambos já concluídos): impede reexecução e não duplica auditoria", async () => {
    await resetTabelasTeste();

    // 1ª execução com sucesso
    await executarScriptSaneamento("sistema:manutencao_admin:f4_saneamento:PRIMEIRA_EXECUCAO");

    // 2ª execução com novo token: deve abortar com erro SQL porque nenhum registro foi alterado
    await expect(
      executarScriptSaneamento("sistema:manutencao_admin:f4_saneamento:SEGUNDA_EXECUCAO")
    ).rejects.toThrow(/NOT NULL constraint failed/);

    // Auditoria permanece com exatamente 1 registro
    const auditLogs = await env.DB.prepare(`SELECT COUNT(*) as cnt FROM logs WHERE acao = 'ENCERRAMENTO_ADMINISTRATIVO'`).first<{ cnt: number }>();
    expect(auditLogs?.cnt).toBe(1);
  });

  it("5. Falha de CAS por divergência de timestamp: aborta com erro SQL e rollback total", async () => {
    await resetTabelasTeste();

    await env.DB.prepare(`UPDATE google_sheets_pendencias SET atualizado_em = '2026-10-19 20:00:00' WHERE id = 25`).run();

    await expect(executarScriptSaneamento()).rejects.toThrow(/NOT NULL constraint failed/);

    const rows = await env.DB.prepare(`SELECT id, status FROM google_sheets_pendencias WHERE id IN (9, 25)`).all<{ id: number; status: string }>();
    expect(rows.results.find(r => r.id === 9)?.status).toBe("PENDENTE");
    expect(rows.results.find(r => r.id === 25)?.status).toBe("PENDENTE");
  });

  it("6. Falha de CAS por divergência de payload: aborta com erro SQL e rollback total", async () => {
    await resetTabelasTeste();

    await env.DB.prepare(`UPDATE google_sheets_pendencias SET payload_json = '{"ra":"RA-TESTE-009","alterado":true}' WHERE id = 9`).run();

    await expect(executarScriptSaneamento()).rejects.toThrow(/NOT NULL constraint failed/);

    const rows = await env.DB.prepare(`SELECT id, status FROM google_sheets_pendencias WHERE id IN (9, 25)`).all<{ id: number; status: string }>();
    expect(rows.results.find(r => r.id === 9)?.status).toBe("PENDENTE");
    expect(rows.results.find(r => r.id === 25)?.status).toBe("PENDENTE");
  });
});
