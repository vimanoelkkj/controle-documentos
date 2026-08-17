import { useEffect, useMemo, useState } from "react";
import { EstatisticasKpis } from "./estatisticas/components/EstatisticasKpis";
import { CardPendenciasDocumento } from "./estatisticas/components/CardPendenciasDocumento";
import { CardCombinacoesPendencias } from "./estatisticas/components/CardCombinacoesPendencias";
import { CardUnidades } from "./estatisticas/components/CardUnidades";
import PageLoading from "../components/PageLoading";
import { FiltroUnidadeEstatisticas } from "./estatisticas/components/FiltroUnidadeEstatisticas";
import { percentual } from "./estatisticas/utils";

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
  {
    campo: "residencia",
    nome: "Comprovante de Residência",
    curto: "Residência",
  },
  { campo: "titulo", nome: "Título de Eleitor", curto: "Título" },
  {
    campo: "ensino_medio",
    nome: "Histórico do Ensino Médio",
    curto: "Ens. Médio",
  },
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

  const totaisPorUnidade = useMemo(() => {
    const totais: Record<string, number> = {};
    for (const aluno of ativos) {
      if (!aluno.unidade) continue;
      totais[aluno.unidade] = (totais[aluno.unidade] ?? 0) + 1;
    }
    return totais;
  }, [ativos]);

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
        <PageLoading label="Calculando estatísticas..." />
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
      <div className="page-local-actions statistics-hero">
        <div className="statistics-unit-filter">
          <FiltroUnidadeEstatisticas
            valor={unidade}
            onChange={setUnidade}
            unidades={unidades}
            totais={totaisPorUnidade}
            totalGeral={ativos.length}
          />
        </div>
      </div>
<EstatisticasKpis resumo={resumo} totalAlunos={base.length} />

      <div className="statistics-grid single-column statistics-bottlenecks-grid">
        <CardPendenciasDocumento documentos={documentos} />
      </div>

      <div
        className={`statistics-grid lower-grid ${
          unidade === "GERAL" ? "two-columns" : "single-column"
        }`}
      >
        <CardCombinacoesPendencias
          combinacoes={combinacoesPendencias}
          maiorCombinacao={maiorCombinacao}
        />

        {unidade === "GERAL" && <CardUnidades unidades={unidadesStats} />}
      </div>
    </section>
  );
}

export default Estatisticas;
