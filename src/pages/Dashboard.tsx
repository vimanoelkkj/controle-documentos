import AppIcon from "../components/AppIcon";
import { useEffect, useMemo, useState } from "react";
import AppSelect from "../components/AppSelect";
import { CardStatusDocumental } from "./dashboard/components/CardStatusDocumental";
import { CardPendencias } from "./dashboard/components/CardPendencias";
import { CardDesempenhoUnidades } from "./dashboard/components/CardDesempenhoUnidades";
import { DashboardKpis } from "./dashboard/components/DashboardKpis";

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

const DOCUMENTOS: { campo: DocumentoCampo; nome: string }[] = [
  { campo: "identidade", nome: "Identidade" },
  { campo: "cpf", nome: "CPF" },
  { campo: "certidao", nome: "Certidão de Registro Civil" },
  { campo: "residencia", nome: "Comprovante de Residência" },
  { campo: "titulo", nome: "Título de Eleitor" },
  { campo: "ensino_medio", nome: "Histórico do Ensino Médio" },
  { campo: "contrato", nome: "Contrato" },
];

function statusDocumental(aluno: AlunoApi): StatusDocumental {
  const entregues = DOCUMENTOS.filter((doc) => aluno[doc.campo] === 1).length;

  if (entregues === DOCUMENTOS.length) return "COMPLETO";

  if (aluno.ensino_medio === 1 && aluno.contrato === 1) return "PARCIAL";

  return "CRITICO";
}

function percentual(valor: number, total: number) {
  if (!total) return 0;
  return Math.round((valor / total) * 100);
}

function Dashboard() {
  const [alunos, setAlunos] = useState<AlunoApi[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [unidade, setUnidade] = useState("GERAL");
  const [pendenciasSelecionadas, setPendenciasSelecionadas] = useState<
    DocumentoCampo[]
  >([]);

  function abrirConferencia(
    filtros: {
      unidade?: string;
      docStatus?: StatusDocumental;
      pendencias?: DocumentoCampo[];
    } = {},
  ) {
    const params = new URLSearchParams();
    params.set("status", "ATIVO");

    const unidadeDestino =
      filtros.unidade ?? (unidade !== "GERAL" ? unidade : "");

    if (unidadeDestino) params.set("unidade", unidadeDestino);
    if (filtros.docStatus) params.set("docStatus", filtros.docStatus);

    const pendencias = filtros.pendencias ?? [];
    if (pendencias.length > 0) {
      params.set("pendencia", pendencias.join(","));
    }

    window.location.assign(`/conferencia?${params.toString()}`);
  }

  function alternarPendenciaDashboard(campo: DocumentoCampo) {
    setPendenciasSelecionadas((atuais) =>
      atuais.includes(campo)
        ? atuais.filter((item) => item !== campo)
        : [...atuais, campo],
    );
  }

  function abrirPendenciasSelecionadas() {
    if (pendenciasSelecionadas.length === 0) return;

    abrirConferencia({
      pendencias: pendenciasSelecionadas,
    });
  }

  useEffect(() => {
    fetch("/api/alunos")
      .then((resposta) => {
        if (!resposta.ok) throw new Error();
        return resposta.json() as Promise<AlunoApi[]>;
      })
      .then(setAlunos)
      .catch(() => setErro("Não foi possível carregar os dados do dashboard."))
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
    const contagem = {
      completo: 0,
      parcial: 0,
      critico: 0,
      documentosEntregues: 0,
      documentosPossiveis: base.length * DOCUMENTOS.length,
    };

    base.forEach((aluno) => {
      const status = statusDocumental(aluno);

      if (status === "COMPLETO") contagem.completo += 1;
      if (status === "PARCIAL") contagem.parcial += 1;
      if (status === "CRITICO") contagem.critico += 1;

      DOCUMENTOS.forEach((doc) => {
        if (aluno[doc.campo] === 1) contagem.documentosEntregues += 1;
      });
    });

    return contagem;
  }, [base]);

  const pendencias = useMemo(
    () =>
      DOCUMENTOS.map((doc) => ({
        ...doc,
        quantidade: base.filter((aluno) => aluno[doc.campo] !== 1).length,
      })).sort((a, b) => b.quantidade - a.quantidade),
    [base],
  );

  const comparacaoUnidades = useMemo(
    () =>
      unidades.map((nomeUnidade) => {
        const alunosUnidade = ativos.filter(
          (aluno) => aluno.unidade === nomeUnidade,
        );

        const completo = alunosUnidade.filter(
          (aluno) => statusDocumental(aluno) === "COMPLETO",
        ).length;
        const parcial = alunosUnidade.filter(
          (aluno) => statusDocumental(aluno) === "PARCIAL",
        ).length;
        const critico = alunosUnidade.length - completo - parcial;

        return {
          unidade: nomeUnidade,
          total: alunosUnidade.length,
          completo,
          parcial,
          critico,
        };
      }),
    [ativos, unidades],
  );

  const total = base.length;
  const taxaCompleta = percentual(resumo.completo, total);
  const progressoGeral = percentual(
    resumo.documentosEntregues,
    resumo.documentosPossiveis,
  );

  const quantidadePendenciasExatas = useMemo(() => {
    if (pendenciasSelecionadas.length === 0) return 0;

    const selecionadas = new Set(pendenciasSelecionadas);

    return base.filter((aluno) => {
      const pendenciasDoAluno = DOCUMENTOS.filter(
        (doc) => aluno[doc.campo] !== 1,
      ).map((doc) => doc.campo);

      return (
        pendenciasDoAluno.length === selecionadas.size &&
        pendenciasDoAluno.every((campo) => selecionadas.has(campo))
      );
    }).length;
  }, [base, pendenciasSelecionadas]);

  const donut = useMemo(() => {
    const raio = 54;
    const circunferencia = 2 * Math.PI * raio;
    const partes = [
      { chave: "completo", valor: resumo.completo, classe: "complete" },
      { chave: "parcial", valor: resumo.parcial, classe: "partial" },
      { chave: "critico", valor: resumo.critico, classe: "critical" },
    ];

    let acumulado = 0;

    return {
      raio,
      circunferencia,
      partes: partes.map((parte) => {
        const fracao = total ? parte.valor / total : 0;
        const comprimento = circunferencia * fracao;
        const atual = {
          ...parte,
          comprimento,
          deslocamento: -acumulado,
        };
        acumulado += comprimento;
        return atual;
      }),
    };
  }, [resumo, total]);

  if (carregando) {
    return (
      <section className="dashboard-page">
        <div className="dashboard-state">Carregando visão geral...</div>
      </section>
    );
  }

  if (erro) {
    return (
      <section className="dashboard-page">
        <div className="dashboard-state error">{erro}</div>
      </section>
    );
  }

  return (
    <section className="dashboard-page">
      <header className="dashboard-hero">
        <div>
          <span className="dashboard-eyebrow">VISÃO EXECUTIVA</span>
          <div className="page-title-row">
            <span className="page-title-icon">
              <AppIcon name="dashboard" size={22} />
            </span>
            <h1>Dashboard documental</h1>
          </div>
          <p>
            Panorama da documentação ativa, pendências prioritárias e desempenho
            por unidade.
          </p>
        </div>

        <div className="dashboard-unit-filter">
          <span>VISUALIZAÇÃO</span>
          <AppSelect
            value={unidade}
            onChange={setUnidade}
            ariaLabel="Visualização por unidade"
            options={[
              { value: "GERAL", label: "Geral — todas as unidades" },
              ...unidades.map((item) => ({ value: item, label: item })),
            ]}
          />
        </div>
      </header>

      <DashboardKpis
        total={total}
        unidade={unidade}
        resumo={resumo}
        taxaCompleta={taxaCompleta}
        progressoGeral={progressoGeral}
        percentualCritico={percentual(resumo.critico, total)}
        abrirConferencia={abrirConferencia}
      />

      <div className="dashboard-main-grid">
        <CardStatusDocumental
          total={total}
          taxaCompleta={taxaCompleta}
          resumo={resumo}
          donut={donut}
          abrirConferencia={abrirConferencia}
        />

        <CardPendencias
          pendencias={pendencias}
          total={total}
          pendenciasSelecionadas={pendenciasSelecionadas}
          quantidadePendenciasExatas={quantidadePendenciasExatas}
          alternarPendencia={alternarPendenciaDashboard}
          limparPendencias={() => setPendenciasSelecionadas([])}
          abrirPendenciasSelecionadas={abrirPendenciasSelecionadas}
        />
      </div>
      <CardDesempenhoUnidades
        unidades={unidades}
        comparacaoUnidades={comparacaoUnidades}
        abrirUnidade={(unidadeDestino) =>
          abrirConferencia({ unidade: unidadeDestino })
        }
      />
    </section>
  );
}

export default Dashboard;
