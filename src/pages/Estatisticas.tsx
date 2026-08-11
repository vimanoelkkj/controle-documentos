import AppIcon from "../components/AppIcon";
import { useEffect, useMemo, useState } from "react";
import AppSelect from "../components/AppSelect";

type AlunoApi = {
  ra: string;
  nome: string;
  email: string | null;
  email_outro: string | null;
  curso: string;
  unidade: string;
  identidade: number;
  cpf: number;
  certidao: number;
  residencia: number;
  titulo: number;
  ensino_medio: number;
  contrato: number;
  status: "ATIVO" | "CANCELADO";
};

type DocumentoCampo =
  | "identidade"
  | "cpf"
  | "certidao"
  | "residencia"
  | "titulo"
  | "ensino_medio"
  | "contrato";

type StatusDocumental = "COMPLETO" | "PARCIAL" | "CRITICO";

const DOCUMENTOS: { campo: DocumentoCampo; nome: string; curto: string }[] = [
  { campo: "identidade", nome: "Identidade", curto: "Identidade" },
  { campo: "cpf", nome: "CPF", curto: "CPF" },
  { campo: "certidao", nome: "Certidão de Registro Civil", curto: "Certidão" },
  { campo: "residencia", nome: "Comprovante de Residência", curto: "Residência" },
  { campo: "titulo", nome: "Título de Eleitor", curto: "Título" },
  { campo: "ensino_medio", nome: "Histórico do Ensino Médio", curto: "Ens. Médio" },
  { campo: "contrato", nome: "Contrato", curto: "Contrato" },
];

function entreguesDoAluno(aluno: AlunoApi) {
  return DOCUMENTOS.reduce(
    (total, documento) => total + (aluno[documento.campo] === 1 ? 1 : 0),
    0,
  );
}

function statusDocumental(aluno: AlunoApi): StatusDocumental {
  const entregues = entreguesDoAluno(aluno);
  if (entregues === DOCUMENTOS.length) return "COMPLETO";
  if (aluno.ensino_medio === 1 && aluno.contrato === 1) return "PARCIAL";
  return "CRITICO";
}

function percentual(valor: number, total: number) {
  if (!total) return 0;
  return Math.round((valor / total) * 100);
}

function numero(valor: number, casas = 0) {
  return valor.toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

function Estatisticas() {
  const [alunos, setAlunos] = useState<AlunoApi[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [unidade, setUnidade] = useState("GERAL");

  useEffect(() => {
    fetch("/api/alunos", { cache: "no-store" })
      .then((resposta) => {
        if (!resposta.ok) throw new Error();
        return resposta.json() as Promise<AlunoApi[]>;
      })
      .then(setAlunos)
      .catch(() => setErro("Não foi possível carregar as estatísticas."))
      .finally(() => setCarregando(false));
  }, []);

  const ativos = useMemo(
    () => alunos.filter((aluno) => aluno.status === "ATIVO"),
    [alunos],
  );

  const unidades = useMemo(
    () =>
      [...new Set(ativos.map((aluno) => aluno.unidade))]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "pt-BR")),
    [ativos],
  );

  const base = useMemo(
    () =>
      unidade === "GERAL"
        ? ativos
        : ativos.filter((aluno) => aluno.unidade === unidade),
    [ativos, unidade],
  );

  const resumo = useMemo(() => {
    let documentosEntregues = 0;
    let completos = 0;
    let parciais = 0;
    let criticos = 0;
    let zerados = 0;

    base.forEach((aluno) => {
      const entregues = entreguesDoAluno(aluno);
      documentosEntregues += entregues;
      if (entregues === 0) zerados += 1;

      const status = statusDocumental(aluno);
      if (status === "COMPLETO") completos += 1;
      if (status === "PARCIAL") parciais += 1;
      if (status === "CRITICO") criticos += 1;
    });

    const documentosPossiveis = base.length * DOCUMENTOS.length;

    return {
      documentosEntregues,
      documentosPossiveis,
      completos,
      parciais,
      criticos,
      zerados,
      mediaPorAluno: base.length ? documentosEntregues / base.length : 0,
      taxaDocumental: percentual(documentosEntregues, documentosPossiveis),
    };
  }, [base]);

  const distribuicao = useMemo(
    () =>
      Array.from({ length: DOCUMENTOS.length + 1 }, (_, entregues) => ({
        entregues,
        quantidade: base.filter(
          (aluno) => entreguesDoAluno(aluno) === entregues,
        ).length,
      })),
    [base],
  );

  const maiorFaixa = Math.max(1, ...distribuicao.map((item) => item.quantidade));

  const documentos = useMemo(
    () =>
      DOCUMENTOS.map((documento) => {
        const entregues = base.filter(
          (aluno) => aluno[documento.campo] === 1,
        ).length;
        const pendentes = base.length - entregues;

        return {
          ...documento,
          entregues,
          pendentes,
          taxaEntrega: percentual(entregues, base.length),
          taxaPendencia: percentual(pendentes, base.length),
        };
      }).sort(
        (a, b) => b.pendentes - a.pendentes || a.nome.localeCompare(b.nome),
      ),
    [base],
  );

  const unidadesStats = useMemo(
    () =>
      unidades
        .map((nomeUnidade) => {
          const lista = ativos.filter((aluno) => aluno.unidade === nomeUnidade);
          const docs = lista.reduce(
            (total, aluno) => total + entreguesDoAluno(aluno),
            0,
          );
          const completos = lista.filter(
            (aluno) => statusDocumental(aluno) === "COMPLETO",
          ).length;
          const criticos = lista.filter(
            (aluno) => statusDocumental(aluno) === "CRITICO",
          ).length;

          return {
            unidade: nomeUnidade,
            total: lista.length,
            media: lista.length ? docs / lista.length : 0,
            progresso: percentual(docs, lista.length * DOCUMENTOS.length),
            completos,
            taxaCompleta: percentual(completos, lista.length),
            criticos,
            taxaCritica: percentual(criticos, lista.length),
            pendenciasPorAluno: lista.length
              ? (lista.length * DOCUMENTOS.length - docs) / lista.length
              : 0,
          };
        })
        .sort((a, b) => b.progresso - a.progresso),
    [ativos, unidades],
  );

  const cursosStats = useMemo(() => {
    const mapa = new Map<string, AlunoApi[]>();

    base.forEach((aluno) => {
      const curso = aluno.curso?.trim() || "Sem curso informado";
      const lista = mapa.get(curso) || [];
      lista.push(aluno);
      mapa.set(curso, lista);
    });

    return [...mapa.entries()]
      .map(([curso, lista]) => {
        const documentosEntregues = lista.reduce(
          (total, aluno) => total + entreguesDoAluno(aluno),
          0,
        );
        const completos = lista.filter(
          (aluno) => statusDocumental(aluno) === "COMPLETO",
        ).length;

        return {
          curso,
          total: lista.length,
          completos,
          taxaCompleta: percentual(completos, lista.length),
          progresso: percentual(
            documentosEntregues,
            lista.length * DOCUMENTOS.length,
          ),
        };
      })
      .sort((a, b) => b.total - a.total || b.progresso - a.progresso)
      .slice(0, 8);
  }, [base]);

  const combinacoesPendencias = useMemo(() => {
    const mapa = new Map<string, { nomes: string[]; quantidade: number }>();

    base.forEach((aluno) => {
      const pendentes = DOCUMENTOS.filter(
        (documento) => aluno[documento.campo] !== 1,
      ).map((documento) => documento.curto);

      if (!pendentes.length) return;

      const chave = pendentes.join("|");
      const atual = mapa.get(chave);
      if (atual) atual.quantidade += 1;
      else mapa.set(chave, { nomes: pendentes, quantidade: 1 });
    });

    return [...mapa.values()]
      .sort((a, b) => b.quantidade - a.quantidade)
      .slice(0, 6);
  }, [base]);

  const maiorCombinacao = Math.max(
    1,
    ...combinacoesPendencias.map((item) => item.quantidade),
  );

  if (carregando) {
    return (
      <section className="statistics-page">
        <div className="statistics-state">Calculando estatísticas...</div>
      </section>
    );
  }

  if (erro) {
    return (
      <section className="statistics-page">
        <div className="statistics-state error">{erro}</div>
      </section>
    );
  }

  return (
    <section className="statistics-page">
      <header className="statistics-hero">
        <div>
          <span className="statistics-eyebrow">ANÁLISE OPERACIONAL</span>
          <div className="page-title-row">
          <span className="page-title-icon"><AppIcon name="stats" size={22} /></span>
          <h1>Estatísticas documentais</h1>
        </div>
          <p>
            Onde estão os gargalos, como os alunos se distribuem e quais grupos
            merecem prioridade na conferência.
          </p>
        </div>

        <div className="statistics-unit-filter">
          <span>RECORTE</span>
          <AppSelect
            value={unidade}
            onChange={setUnidade}
            ariaLabel="Recorte por unidade"
            options={[
              { value: "GERAL", label: "Geral — todas as unidades" },
              ...unidades.map((item) => ({ value: item, label: item })),
            ]}
          />
        </div>
      </header>

      <div className="statistics-kpis">
        <article className="statistics-kpi">
          <span>MÉDIA POR ALUNO</span>
          <strong>{numero(resumo.mediaPorAluno, 1)} / 7</strong>
          <small>documentos entregues por matrícula</small>
        </article>

        <article className="statistics-kpi progress">
          <span>TAXA DOCUMENTAL</span>
          <strong>{resumo.taxaDocumental}%</strong>
          <small>
            {numero(resumo.documentosEntregues)} de {numero(resumo.documentosPossiveis)} conferidos
          </small>
        </article>

        <article className="statistics-kpi complete">
          <span>ALUNOS 7/7</span>
          <strong>{numero(resumo.completos)}</strong>
          <small>{percentual(resumo.completos, base.length)}% da base analisada</small>
        </article>

        <article className="statistics-kpi critical">
          <span>ALUNOS 0/7</span>
          <strong>{numero(resumo.zerados)}</strong>
          <small>{percentual(resumo.zerados, base.length)}% sem nenhum documento</small>
        </article>
      </div>

      <div className="statistics-grid two-columns">
        <article className="statistics-card">
          <div className="statistics-card-header">
            <div>
              <span>DISTRIBUIÇÃO</span>
              <h2>Quantidade de documentos por aluno</h2>
            </div>
            <small>{numero(base.length)} alunos ativos</small>
          </div>

          <div className="statistics-histogram" aria-label="Distribuição de documentos entregues">
            {distribuicao.map((item) => (
              <div className="statistics-histogram-column" key={item.entregues}>
                <div className="statistics-histogram-value">{item.quantidade}</div>
                <div className="statistics-histogram-track">
                  <div
                    className={`statistics-histogram-bar ${item.entregues === 7 ? "complete" : item.entregues === 0 ? "critical" : ""}`}
                    style={{
                      height: `${Math.max(
                        item.quantidade ? 8 : 0,
                        (item.quantidade / maiorFaixa) * 100,
                      )}%`,
                    }}
                  />
                </div>
                <strong>{item.entregues}/7</strong>
                <small>{percentual(item.quantidade, base.length)}%</small>
              </div>
            ))}
          </div>
        </article>

        <article className="statistics-card">
          <div className="statistics-card-header">
            <div>
              <span>GARGALOS</span>
              <h2>Pendência por documento</h2>
            </div>
            <small>maior primeiro</small>
          </div>

          <div className="statistics-document-list">
            {documentos.map((documento, indice) => (
              <div className="statistics-document-row" key={documento.campo}>
                <div className="statistics-document-title">
                  <span className={indice === 0 ? "priority" : ""}>{indice + 1}</span>
                  <div>
                    <strong>{documento.nome}</strong>
                    <small>{documento.taxaEntrega}% já entregue</small>
                  </div>
                </div>
                <div className="statistics-document-meter">
                  <div>
                    <span
                      className={indice === 0 ? "priority" : ""}
                      style={{ width: `${documento.taxaPendencia}%` }}
                    />
                  </div>
                  <strong>{documento.pendentes}</strong>
                  <small>pendentes</small>
                </div>
              </div>
            ))}
          </div>
        </article>
      </div>

      <div className="statistics-grid two-columns lower-grid">
        <article className="statistics-card">
          <div className="statistics-card-header">
            <div>
              <span>PADRÕES RECORRENTES</span>
              <h2>Combinações de pendências</h2>
            </div>
            <small>top {combinacoesPendencias.length}</small>
          </div>

          <div className="statistics-combination-list">
            {combinacoesPendencias.length ? (
              combinacoesPendencias.map((grupo, indice) => (
                <div className="statistics-combination-row" key={grupo.nomes.join("|")}>
                  <div className="statistics-combination-number">#{indice + 1}</div>
                  <div className="statistics-combination-main">
                    <div className="statistics-combination-tags">
                      {grupo.nomes.map((nome) => (
                        <span key={nome}>{nome}</span>
                      ))}
                    </div>
                    <div className="statistics-combination-track">
                      <span style={{ width: `${(grupo.quantidade / maiorCombinacao) * 100}%` }} />
                    </div>
                  </div>
                  <div className="statistics-combination-count">
                    <strong>{grupo.quantidade}</strong>
                    <small>alunos</small>
                  </div>
                </div>
              ))
            ) : (
              <div className="statistics-empty">Nenhuma pendência nesta seleção.</div>
            )}
          </div>
        </article>

        <article className="statistics-card">
          <div className="statistics-card-header">
            <div>
              <span>CURSOS</span>
              <h2>Maiores bases da seleção</h2>
            </div>
            <small>até 8 cursos</small>
          </div>

          <div className="statistics-course-list">
            {cursosStats.map((curso) => (
              <div className="statistics-course-row" key={curso.curso}>
                <div className="statistics-course-name">
                  <strong title={curso.curso}>{curso.curso}</strong>
                  <small>{curso.total} alunos · {curso.completos} completos</small>
                </div>
                <div className="statistics-course-progress">
                  <div>
                    <span style={{ width: `${curso.progresso}%` }} />
                  </div>
                  <strong>{curso.progresso}%</strong>
                </div>
              </div>
            ))}
          </div>
        </article>
      </div>

      {unidade === "GERAL" && (
        <article className="statistics-card statistics-units-card">
          <div className="statistics-card-header">
            <div>
              <span>COMPARATIVO</span>
              <h2>Eficiência documental por unidade</h2>
            </div>
            <small>ordenado por progresso</small>
          </div>

          <div className="statistics-unit-table">
            <div className="statistics-unit-head">
              <span>Unidade</span>
              <span>Alunos</span>
              <span>Média</span>
              <span>Progresso</span>
              <span>7/7</span>
              <span>Críticos</span>
              <span>Pend./aluno</span>
            </div>

            {unidadesStats.map((item) => (
              <div className="statistics-unit-row" key={item.unidade}>
                <strong>{item.unidade}</strong>
                <span>{item.total}</span>
                <span>{numero(item.media, 1)} / 7</span>
                <span className="statistics-unit-progress-cell">
                  <span className="statistics-mini-progress">
                    <i style={{ width: `${item.progresso}%` }} />
                  </span>
                  <b>{item.progresso}%</b>
                </span>
                <span className="complete">{item.completos} <small>({item.taxaCompleta}%)</small></span>
                <span className="critical">{item.criticos} <small>({item.taxaCritica}%)</small></span>
                <span>{numero(item.pendenciasPorAluno, 1)}</span>
              </div>
            ))}
          </div>
        </article>
      )}
    </section>
  );
}

export default Estatisticas;
