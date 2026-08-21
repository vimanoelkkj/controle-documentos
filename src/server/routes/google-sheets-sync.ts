import type { UsuarioSessao } from "./auth";
import type { SheetsConfig } from "./google-sheets-config";
import {
  carregarUnidadePorCurso,
  montarCursoUnidades,
  resolverUnidadeGoogleSheets,
  lerBaseGoogleSheets,
  lerCanceladosGoogleSheets,
  lerDocumentosGoogleSheets,
  ehReservaDeVaga,
  type AlunoRow,
  type RangeGoogle,
} from "./google-sheets-reconciliation";

type GoogleSheetsSyncContext = {
  request: Request;
  url: URL;
  db: D1Database;
  usuarioAtual: UsuarioSessao | null;
  podeEditar: boolean;
  lerRanges: (config: SheetsConfig) => Promise<RangeGoogle[]>;
  normalizarTexto: (valor: unknown) => string;
  normalizarComparacao: (valor: unknown) => string;
  valorBooleano: (valor: unknown) => boolean;
};

export async function handleGoogleSheetsSyncRoute({
  request,
  url,
  db,
  usuarioAtual,
  podeEditar,
  lerRanges,
  normalizarTexto,
  normalizarComparacao,
  valorBooleano,
}: GoogleSheetsSyncContext): Promise<Response | null> {
  const rotaSheetsSincronizar = url.pathname.match(
    /^\/api\/periodos\/(\d+)\/google-sheets\/sincronizar$/,
  );

  if (rotaSheetsSincronizar && request.method === "POST") {
    try {
      if (!podeEditar) {
        return Response.json(
          { erro: "Seu perfil não permite sincronizar dados." },
          { status: 403 },
        );
      }

      const periodoId = Number(rotaSheetsSincronizar[1]);
      const config = await db
        .prepare(`SELECT * FROM google_sheets_periodos WHERE periodo_id = ?`)
        .bind(periodoId)
        .first<SheetsConfig>();

      if (!config) {
        return Response.json(
          { erro: "Configure a planilha deste período primeiro." },
          { status: 409 },
        );
      }

      const ranges = await lerRanges(config);
      const [
        baseFaceFea,
        baseFchEad,
        docsFaceFea,
        docsFchEad,
        cancelFaceFea,
        cancelFchEad,
      ] = ranges;

      const basesLidas = [
        ...lerBaseGoogleSheets(
          baseFaceFea.linhas,
          "FACE_FEA",
          normalizarTexto,
          normalizarComparacao,
        ),
        ...lerBaseGoogleSheets(
          baseFchEad.linhas,
          "FCH_EAD",
          normalizarTexto,
          normalizarComparacao,
        ),
      ];

      // Reserva de vaga ainda não é aluno efetivamente matriculado para o
      // Controle de Documentos. Mantemos a linha apenas na planilha de origem
      // e a tratamos como ausente do sistema até a situação mudar.
      const reservas = basesLidas.filter((aluno) =>
        ehReservaDeVaga(aluno, normalizarComparacao),
      );
      const rasReserva = new Set(reservas.map((aluno) => aluno.ra));
      const bases = basesLidas.filter((aluno) => !rasReserva.has(aluno.ra));

      const docs = new Map([
        ...lerDocumentosGoogleSheets(
          docsFaceFea.linhas,
          normalizarTexto,
          valorBooleano,
        ),
        ...lerDocumentosGoogleSheets(
          docsFchEad.linhas,
          normalizarTexto,
          valorBooleano,
        ),
      ]);

      const cancelados = new Set([
        ...lerCanceladosGoogleSheets(cancelFaceFea.linhas, normalizarTexto),
        ...lerCanceladosGoogleSheets(cancelFchEad.linhas, normalizarTexto),
      ]);

      const atuais = await db
        .prepare(
          `
          SELECT a.id, a.ra, a.nome, a.curso, a.unidade, a.email, a.email_outro, a.status,
                 d.identidade, d.cpf, d.certidao, d.residencia, d.titulo, d.ensino_medio, d.contrato
          FROM alunos a
          LEFT JOIN documentos d ON d.aluno_id = a.id
          WHERE a.periodo_id = ?
        `,
        )
        .bind(periodoId)
        .all<AlunoRow & { id: number }>();

      const porRa = new Map(atuais.results.map((a) => [a.ra, a]));
      const cursoUnidades = montarCursoUnidades(
        atuais.results,
        normalizarComparacao,
      );

      const unidadePorCurso = await carregarUnidadePorCurso(db, periodoId);

      const resolvidos = bases.map((aluno) => ({
        aluno,
        unidade: resolverUnidadeGoogleSheets(
          aluno,
          unidadePorCurso,
          cursoUnidades,
          normalizarComparacao,
        ),
      }));

      const semUnidade = resolvidos.filter((item) => !item.unidade);

      if (semUnidade.length) {
        return Response.json(
          {
            erro: `Sincronização bloqueada: ${semUnidade.length} aluno(s) ainda estão sem unidade definida.`,
            unidades_nao_resolvidas: semUnidade.length,
          },
          { status: 409 },
        );
      }

      let novos = 0;
      let cadastros = 0;
      let documentosAlterados = 0;
      let cancelamentos = 0;
      let reativacoes = 0;
      let remocoes = 0;

      const comandos: D1PreparedStatement[] = [];

      for (const { aluno, unidade } of resolvidos) {
        const atual = porRa.get(aluno.ra);
        const doc = docs.get(aluno.ra);

        if (!atual) {
          novos += 1;

          const novoJaCancelado = cancelados.has(aluno.ra);

          if (novoJaCancelado) {
            cancelamentos += 1;
          }

          const statusInicial = novoJaCancelado ? "CANCELADO" : "ATIVO";

          comandos.push(
            db
              .prepare(
                `
      INSERT INTO alunos (
        periodo_id, ra, nome, email, email_outro, curso, unidade, status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
              )
              .bind(
                periodoId,
                aluno.ra,
                aluno.nome,
                aluno.email || null,
                aluno.email_outro || null,
                aluno.curso,
                unidade!,
                statusInicial,
              ),
          );

          comandos.push(
            db
              .prepare(
                `
                INSERT INTO documentos (
                  aluno_id, identidade, cpf, certidao, residencia,
                  titulo, ensino_medio, contrato
                )
                SELECT id, ?, ?, ?, ?, ?, ?, ?
                FROM alunos
                WHERE periodo_id = ? AND ra = ?
              `,
              )
              .bind(
                doc?.identidade ? 1 : 0,
                doc?.cpf ? 1 : 0,
                doc?.certidao ? 1 : 0,
                doc?.residencia ? 1 : 0,
                doc?.titulo ? 1 : 0,
                doc?.ensino_medio ? 1 : 0,
                doc ? (doc.contrato ? 1 : 0) : aluno.contrato ? 1 : 0,
                periodoId,
                aluno.ra,
              ),
          );

          continue;
        }
        if (atual.status === "CANCELADO" && !cancelados.has(aluno.ra)) {
          reativacoes += 1;

          comandos.push(
            db
              .prepare(
                `
      UPDATE alunos
      SET status = 'ATIVO', atualizado_em = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
              )
              .bind(atual.id),
          );
        }
        const cadastroMudou =
          normalizarComparacao(atual.nome) !==
            normalizarComparacao(aluno.nome) ||
          normalizarComparacao(atual.curso) !==
            normalizarComparacao(aluno.curso) ||
          normalizarComparacao(atual.unidade ?? "") !==
            normalizarComparacao(unidade ?? "") ||
          normalizarComparacao(atual.email ?? "") !==
            normalizarComparacao(aluno.email) ||
          normalizarComparacao(atual.email_outro ?? "") !==
            normalizarComparacao(aluno.email_outro);

        if (cadastroMudou) {
          cadastros += 1;

          comandos.push(
            db
              .prepare(
                `
      UPDATE alunos
      SET nome = ?,
          email = ?,
          email_outro = ?,
          curso = ?,
          unidade = ?,
          atualizado_em = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
              )
              .bind(
                aluno.nome,
                aluno.email || null,
                aluno.email_outro || null,
                aluno.curso,
                unidade!,
                atual.id,
              ),
          );
        }

        const mudouUnidade =
          normalizarComparacao(atual.unidade) !== normalizarComparacao(unidade);

        if (doc && !mudouUnidade) {
          const docMudou =
            Boolean(atual.identidade) !== doc.identidade ||
            Boolean(atual.cpf) !== doc.cpf ||
            Boolean(atual.certidao) !== doc.certidao ||
            Boolean(atual.residencia) !== doc.residencia ||
            Boolean(atual.titulo) !== doc.titulo ||
            Boolean(atual.ensino_medio) !== doc.ensino_medio ||
            Boolean(atual.contrato) !== doc.contrato;

          if (docMudou) {
            documentosAlterados += 1;
            comandos.push(
              db
                .prepare(
                  `
                  INSERT INTO documentos (
                    aluno_id, identidade, cpf, certidao, residencia,
                    titulo, ensino_medio, contrato
                  )
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(aluno_id) DO UPDATE SET
                    identidade = excluded.identidade,
                    cpf = excluded.cpf,
                    certidao = excluded.certidao,
                    residencia = excluded.residencia,
                    titulo = excluded.titulo,
                    ensino_medio = excluded.ensino_medio,
                    contrato = excluded.contrato,
                    atualizado_em = CURRENT_TIMESTAMP
                `,
                )
                .bind(
                  atual.id,
                  doc.identidade ? 1 : 0,
                  doc.cpf ? 1 : 0,
                  doc.certidao ? 1 : 0,
                  doc.residencia ? 1 : 0,
                  doc.titulo ? 1 : 0,
                  doc.ensino_medio ? 1 : 0,
                  doc.contrato ? 1 : 0,
                ),
            );
          }
        }
      }

      for (const ra of cancelados) {
        if (rasReserva.has(ra)) continue;
        const atual = porRa.get(ra);
        if (!atual || atual.status === "CANCELADO") continue;

        cancelamentos += 1;
        comandos.push(
          db
            .prepare(
              `
              UPDATE alunos
              SET status = 'CANCELADO', atualizado_em = CURRENT_TIMESTAMP
              WHERE id = ?
            `,
            )
            .bind(atual.id),
        );
      }

      const rasAtivosNaPlanilha = new Set(bases.map((aluno) => aluno.ra));

      for (const atual of atuais.results) {
        const estaNaBaseAtiva = rasAtivosNaPlanilha.has(atual.ra);
        const estaNosCancelados = cancelados.has(atual.ra);

        if (
          rasReserva.has(atual.ra) ||
          (!estaNaBaseAtiva && !estaNosCancelados)
        ) {
          remocoes += 1;

          comandos.push(
            db
              .prepare(
                `
        DELETE FROM alunos
        WHERE id = ?
      `,
              )
              .bind(atual.id),
          );
        }
      }

      // D1 batch é atômico: se uma instrução falhar, o lote inteiro é revertido.
      const TAMANHO_BATCH = 80;
      for (let i = 0; i < comandos.length; i += TAMANHO_BATCH) {
        await db.batch(comandos.slice(i, i + TAMANHO_BATCH));
      }

      const periodo = await db
        .prepare(`SELECT codigo FROM periodos WHERE id = ?`)
        .bind(periodoId)
        .first<{ codigo: string }>();

      const descricao =
        `Google Sheets sincronizado no período ${
          periodo?.codigo ?? periodoId
        }: ` +
        `${novos} novo(s), ${cadastros} cadastro(s), ` +
        `${documentosAlterados} documento(s), ${cancelamentos} cancelamento(s), ` +
        `${reativacoes} reativação(ões) e ${remocoes} remoção(ões).`;

      await db
        .prepare(
          `
          INSERT INTO logs (
            acao,
            entidade,
            descricao,
            ra,
            unidade,
            periodo_id,
            usuario_id,
            usuario_nome,
            usuario_username
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        )
        .bind(
          "SINCRONIZAR",
          "GOOGLE_SHEETS",
          descricao,
          null,
          null,
          periodoId,
          usuarioAtual?.id ?? null,
          usuarioAtual?.nome ?? null,
          usuarioAtual?.username ?? null,
        )
        .run();

      const novosCancelados = resolvidos.filter(
        ({ aluno }) => !porRa.has(aluno.ra) && cancelados.has(aluno.ra),
      ).length;

      return Response.json({
        sucesso: true,
        novos,
        alteracoes_cadastrais: cadastros,
        documentos_alterados: documentosAlterados,
        cancelamentos,
        reativacoes,
        remocoes,
        total_operacoes:
          novos +
          cadastros +
          documentosAlterados +
          cancelamentos +
          reativacoes +
          remocoes -
          novosCancelados,
      });
    } catch (erro) {
      console.error("Erro na sincronização Google Sheets:", erro);
      return Response.json(
        {
          erro:
            erro instanceof Error
              ? erro.message
              : "Não foi possível sincronizar o Google Sheets.",
        },
        { status: 500 },
      );
    }
  }

  return null;
}
