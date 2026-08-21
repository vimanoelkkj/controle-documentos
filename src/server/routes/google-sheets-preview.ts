import type { SheetsConfig } from "./google-sheets-config";
import {
  lerBaseGoogleSheets,
  lerCanceladosGoogleSheets,
  montarCursoUnidades,
  carregarUnidadePorCurso,
  resolverUnidadeGoogleSheets,
  lerDocumentosGoogleSheets,
  ehReservaDeVaga,
  type AlunoRow,
  type RangeGoogle,
} from "./google-sheets-reconciliation";

type GoogleSheetsPreviewContext = {
  request: Request;
  url: URL;
  db: D1Database;
  modoApresentacao: boolean;
  lerRanges: (config: SheetsConfig) => Promise<RangeGoogle[]>;
  normalizarTexto: (valor: unknown) => string;
  normalizarComparacao: (valor: unknown) => string;
  valorBooleano: (valor: unknown) => boolean;
};

export async function handleGoogleSheetsPreviewRoute({
  request,
  url,
  db,
  modoApresentacao,
  lerRanges,
  normalizarTexto,
  normalizarComparacao,
  valorBooleano,
}: GoogleSheetsPreviewContext): Promise<Response | null> {
  const rotaSheetsPrevia = url.pathname.match(
    /^\/api\/periodos\/(\d+)\/google-sheets\/previa$/,
  );
  if (rotaSheetsPrevia && request.method === "POST") {
    try {
      const periodoId = Number(rotaSheetsPrevia[1]);
      const config = await db
        .prepare(`SELECT * FROM google_sheets_periodos WHERE periodo_id = ?`)
        .bind(periodoId)
        .first<SheetsConfig>();
      if (!config)
        return Response.json(
          { erro: "Configure a planilha deste período primeiro." },
          { status: 409 },
        );
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

      const documentosMarcados = [...docs.values()].reduce(
        (total, doc) =>
          total +
          [
            doc.identidade,
            doc.cpf,
            doc.certidao,
            doc.residencia,
            doc.titulo,
            doc.ensino_medio,
            doc.contrato,
          ].filter(Boolean).length,
        0,
      );

      const cancelados = new Set([
        ...lerCanceladosGoogleSheets(cancelFaceFea.linhas, normalizarTexto),
        ...lerCanceladosGoogleSheets(cancelFchEad.linhas, normalizarTexto),
      ]);

      const atuais = await db
        .prepare(
          `
          SELECT a.ra, a.nome, a.curso, a.unidade, a.email, a.email_outro, a.status,
                 d.identidade, d.cpf, d.certidao, d.residencia, d.titulo, d.ensino_medio, d.contrato
          FROM alunos a LEFT JOIN documentos d ON d.aluno_id = a.id WHERE a.periodo_id = ?
        `,
        )
        .bind(periodoId)
        .all<AlunoRow>();
      const porRa = new Map(atuais.results.map((a) => [a.ra, a]));
      const cursoUnidades = montarCursoUnidades(
        atuais.results,
        normalizarComparacao,
      );
      const unidadePorCurso = await carregarUnidadePorCurso(db, periodoId);

      let novos = 0,
        cadastrais = 0,
        documentosAlterados = 0,
        cancelar = 0,
        reativar = 0,
        jaCancelados = 0,
        remover = 0;

      const detalhesRemocoes: Array<{
        ra: string;
        nome: string;
        unidade: string;
      }> = [];

      const semUnidade: Array<{ ra: string; nome: string; curso: string }> = [];
      const detalhesNovos: Array<{
        ra: string;
        nome: string;
        curso: string;
        unidade: string | null;
      }> = [];
      const detalhesCadastrais: Array<{
        ra: string;
        nome: string;
        detalhe: string;
      }> = [];
      const detalhesDocumentos: Array<{
        ra: string;
        nome: string;
        detalhe: string;
      }> = [];
      const detalhesCancelamentos: Array<{
        ra: string;
        nome: string;
        unidade: string;
      }> = [];
      const detalhesReativacoes: Array<{
        ra: string;
        nome: string;
        unidade: string;
      }> = [];

      for (const aluno of bases) {
        const atual = porRa.get(aluno.ra);
        const unidade = resolverUnidadeGoogleSheets(
          aluno,
          unidadePorCurso,
          cursoUnidades,
          normalizarComparacao,
        );
        if (!unidade)
          semUnidade.push({
            ra: aluno.ra,
            nome: aluno.nome,
            curso: aluno.curso,
          });
        if (!atual) {
          novos += 1;
          detalhesNovos.push({
            ra: aluno.ra,
            nome: aluno.nome,
            curso: aluno.curso,
            unidade,
          });

          // Se o aluno já estiver na planilha de cancelados,
          // ele entrará no primeiro import já como CANCELADO.
          if (cancelados.has(aluno.ra)) {
            cancelar += 1;

            detalhesCancelamentos.push({
              ra: aluno.ra,
              nome: aluno.nome,
              unidade: unidade ?? "",
            });
          }
        } else {
          if (atual.status === "CANCELADO" && !cancelados.has(aluno.ra)) {
            reativar += 1;

            detalhesReativacoes.push({
              ra: aluno.ra,
              nome: aluno.nome,
              unidade: atual.unidade,
            });
          }

          const campos = [
            ["Nome", atual.nome, aluno.nome],
            ["Curso", atual.curso, aluno.curso],
            ["E-mail", atual.email ?? "", aluno.email],
            ["Unidade", atual.unidade ?? "", unidade ?? ""],
            ["E-mail alternativo", atual.email_outro ?? "", aluno.email_outro],
          ].filter(
            ([, antes, depois]) =>
              normalizarComparacao(antes) !== normalizarComparacao(depois),
          );

          if (campos.length) {
            cadastrais += 1;

            detalhesCadastrais.push({
              ra: aluno.ra,
              nome: aluno.nome,
              detalhe: campos
                .map(
                  ([campo, antes, depois]) =>
                    `${campo}: ${antes || "—"} → ${depois || "—"}`,
                )
                .join("\n"),
            });
          }
        }
        const doc = docs.get(aluno.ra);

        const mudouUnidade =
          atual &&
          normalizarComparacao(atual.unidade) !== normalizarComparacao(unidade);

        if (atual && doc && !mudouUnidade) {
          const pares = [
            ["Identidade", Boolean(atual.identidade), doc.identidade],
            ["CPF", Boolean(atual.cpf), doc.cpf],
            ["Certidão", Boolean(atual.certidao), doc.certidao],
            ["Residência", Boolean(atual.residencia), doc.residencia],
            ["Título", Boolean(atual.titulo), doc.titulo],
            ["Ensino Médio", Boolean(atual.ensino_medio), doc.ensino_medio],
            ["Contrato", Boolean(atual.contrato), doc.contrato],
          ] as Array<[string, boolean, boolean]>;
          const diferentes = pares.filter(
            ([, antes, depois]) => antes !== depois,
          );

          if (diferentes.length) {
            documentosAlterados += 1;

            detalhesDocumentos.push({
              ra: aluno.ra,
              nome: aluno.nome,
              detalhe: diferentes
                .map(
                  ([nome, antes, depois]) =>
                    `${nome}: ${antes ? "Entregue" : "Pendente"} → ${
                      depois ? "Entregue" : "Pendente"
                    }`,
                )
                .join("\n"),
            });
          }
        }
      }
      for (const ra of cancelados) {
        if (rasReserva.has(ra)) continue;
        const atual = porRa.get(ra);

        // Alunos novos já foram contabilizados acima.
        if (!atual) continue;

        if (atual.status === "CANCELADO") {
          jaCancelados += 1;
        } else {
          cancelar += 1;

          detalhesCancelamentos.push({
            ra,
            nome: atual.nome,
            unidade: atual.unidade,
          });
        }
      }
      const rasAtivosNaPlanilha = new Set(bases.map((aluno) => aluno.ra));

      for (const [ra, atual] of porRa) {
        const estaNaBaseAtiva = rasAtivosNaPlanilha.has(ra);
        const estaNosCancelados = cancelados.has(ra);

        if (rasReserva.has(ra) || (!estaNaBaseAtiva && !estaNosCancelados)) {
          remover += 1;

          detalhesRemocoes.push({
            ra,
            nome: atual.nome,
            unidade: atual.unidade,
          });
        }
      }
      const cursosPendentes = new Map<
        string,
        {
          curso: string;
          quantidade: number;
          alunos: Array<{ ra: string; nome: string }>;
        }
      >();
      for (const item of semUnidade) {
        const chave = normalizarComparacao(item.curso);
        const grupo = cursosPendentes.get(chave) ?? {
          curso: item.curso,
          quantidade: 0,
          alunos: [],
        };
        grupo.quantidade += 1;
        grupo.alunos.push({ ra: item.ra, nome: item.nome });
        cursosPendentes.set(chave, grupo);
      }
      const modoApresentacaoAtivo = modoApresentacao;

      const anonimizarPessoa = (
        item: { ra: string; nome: string },
        indice: number,
      ) => ({
        ...item,
        ra: `APRESENTACAO-${String(indice + 1).padStart(4, "0")}`,
        nome: `Aluno ${String(indice + 1).padStart(4, "0")}`,
      });

      const anonimizarLista = <T extends { ra: string; nome: string }>(
        itens: T[],
      ): T[] =>
        modoApresentacaoAtivo
          ? itens.map((item, indice) => anonimizarPessoa(item, indice) as T)
          : itens;
      const anonimizarDetalheCadastral = (detalhe: string) => {
        if (!modoApresentacaoAtivo) return detalhe;

        return detalhe
          .split("\n")
          .map((linha) => {
            const [campo] = linha.split(": ");

            if (
              campo === "Nome" ||
              campo === "E-mail" ||
              campo === "E-mail alternativo"
            ) {
              return `${campo}: dado oculto → dado oculto`;
            }

            return linha;
          })
          .join("\n");
      };
      return Response.json({
        sucesso: true,
        planilha: {
          spreadsheet_id: config.spreadsheet_id,
          abas_lidas: ranges.map((r) => r.aba),
        },
        encontrados: bases.length,
        documentos_encontrados: docs.size,
        documentos_marcados: documentosMarcados,
        cancelados_encontrados: cancelados.size,
        novos,
        alteracoes_cadastrais: cadastrais,
        documentos_alterados: documentosAlterados,
        prontos_para_cancelar: cancelar,
        prontos_para_reativar: reativar,
        prontos_para_remover: remover,
        ja_cancelados: jaCancelados,
        alunos_sem_unidade: semUnidade.length,
        cursos_nao_mapeados: cursosPendentes.size,
        unidades_nao_resolvidas: semUnidade.length,
        detalhes_unidades: anonimizarLista(semUnidade),
        cursos_pendentes: [...cursosPendentes.values()]
          .sort(
            (a, b) =>
              b.quantidade - a.quantidade || a.curso.localeCompare(b.curso),
          )
          .map((grupo) => ({
            ...grupo,
            alunos: anonimizarLista(grupo.alunos),
          })),
        detalhes: {
          novos: anonimizarLista(detalhesNovos),
          cadastros: anonimizarLista(detalhesCadastrais).map((item) => ({
            ...item,
            detalhe: anonimizarDetalheCadastral(item.detalhe),
          })),
          documentos: anonimizarLista(detalhesDocumentos),
          cancelamentos: anonimizarLista(detalhesCancelamentos),
          reativacoes: anonimizarLista(detalhesReativacoes),
          remocoes: anonimizarLista(detalhesRemocoes),
        },
        modo: "PREVIA_SOMENTE_LEITURA",
      });
    } catch (erro) {
      console.error(erro);
      return Response.json(
        {
          erro:
            erro instanceof Error
              ? erro.message
              : "Não foi possível ler o Google Sheets.",
        },
        { status: 500 },
      );
    }
  }

  return null;
}
