import AppIcon from "../components/AppIcon";
import { ListaGrupos } from "./comunicacao/components/ListaGrupos";
import { useEffect, useRef, useState } from "react";
import AppSelect from "../components/AppSelect";
import { useAuth } from "../contexts/auth";
import type { AlunoApi } from "./comunicacao/model";
import { useHistoricoComunicacao } from "./comunicacao/hooks/useHistoricoComunicacao";
import { criarTextoEmail } from "./comunicacao/mensagens";
import { HistoricoComunicacoes } from "./comunicacao/components/HistoricoComunicacoes";
import { CartaoEmail } from "./comunicacao/components/CartaoEmail";
import { useAcoesComunicacao } from "./comunicacao/hooks/useAcoesComunicacao";
import { ListaAlunos } from "./comunicacao/components/ListaAlunos";
import { useGruposComunicacao } from "./comunicacao/hooks/useGruposComunicacao";
import { useDestinatariosComunicacao } from "./comunicacao/hooks/useDestinatariosComunicacao";
import { PainelAcoesComunicacao } from "./comunicacao/components/PainelAcoesComunicacao";
import { ResumoCombinacao } from "./comunicacao/components/ResumoCombinacao";

function Comunicacao() {
  const { modoApresentacao } = useAuth();
  const [alunos, setAlunos] = useState<AlunoApi[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [grupoSelecionado, setGrupoSelecionado] = useState("");
  const [unidade, setUnidade] = useState("TODAS");
  const [buscaGrupo, setBuscaGrupo] = useState("");
  const [buscaAluno, setBuscaAluno] = useState("");
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [prazo, setPrazo] = useState("01/07");
  const [assunto, setAssunto] = useState("Documentação pendente - Matrícula");
  const [feedback, setFeedback] = useState("");
  const {
    historico,
    historicoErro,
    registrandoHistorico,
    carregarHistorico,
    registrarCobranca: registrarCobrancaNoHistorico,
  } = useHistoricoComunicacao();
  const emailCardRef = useRef<HTMLElement | null>(null);
  const [alturaMaximaAlunos, setAlturaMaximaAlunos] = useState<number | null>(
    null,
  );

  useEffect(() => {
    const elemento = emailCardRef.current;
    if (!elemento) return;

    const atualizarAltura = () => {
      setAlturaMaximaAlunos(Math.ceil(elemento.getBoundingClientRect().height));
    };

    atualizarAltura();

    const observer = new ResizeObserver(atualizarAltura);
    observer.observe(elemento);

    window.addEventListener("resize", atualizarAltura);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", atualizarAltura);
    };
  }, [grupoSelecionado, prazo, assunto]);

  useEffect(() => {
    fetch("/api/alunos")
      .then((resposta) => {
        if (!resposta.ok) throw new Error();
        return resposta.json() as Promise<AlunoApi[]>;
      })
      .then((dados) => setAlunos(dados))
      .catch(() => setErro("Não foi possível carregar os alunos."))
      .finally(() => setCarregando(false));
  }, []);

  const { unidades, grupos, grupo } = useGruposComunicacao({
    alunos,
    unidade,
    buscaGrupo,
    grupoSelecionado,
    setGrupoSelecionado,
  });

  useEffect(() => {
    if (!grupo) {
      setSelecionados(new Set());
      return;
    }
    setSelecionados(new Set(grupo.alunos.map((aluno) => aluno.ra)));
    setBuscaAluno("");
  }, [grupo]);

  const {
    alunosVisiveis,
    alunosSelecionados,
    emailsInstitucionais,
    emailsAlternativos,
    selecionadosComInstitucional,
    selecionadosSemInstitucional,
    emailsInstitucionaisInvalidos,
    emailsInstitucionaisDuplicados,
    validacaoOk,
    cobrancasPorRa,
    alunosJaCobrados,
    alunosNaoCobrados,
    ultimaCobrancaGrupo,
    temContrato,
  } = useDestinatariosComunicacao({
    grupo,
    buscaAluno,
    selecionados,
    historico,
  });

  const textoEmail = criarTextoEmail(grupo, prazo);

  function selecionarGrupo(chave: string) {
    setGrupoSelecionado(chave);
    setFeedback("");
  }

  function alternarAluno(ra: string) {
    setSelecionados((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(ra)) proximo.delete(ra);
      else proximo.add(ra);
      return proximo;
    });
  }

  const { copiarEmails, copiarComunicado, copiarAssunto, copiarPacoteOutlook } =
    useAcoesComunicacao({
      emailsInstitucionais,
      emailsAlternativos,
      assunto,
      textoEmail,
      setFeedback,
    });

  async function registrarCobranca() {
    if (!grupo || alunosSelecionados.length === 0) {
      setFeedback(
        "Selecione pelo menos um aluno antes de registrar a cobrança.",
      );
      return;
    }

    try {
      await registrarCobrancaNoHistorico({
        grupo_chave: grupo.chave,
        unidade,
        documentos: grupo.documentos.map((documento) => documento.curto),
        quantidade_alunos: alunosSelecionados.length,
        quantidade_emails: emailsInstitucionais.length,
        assunto: assunto || "Documentação pendente - Matrícula",
        prazo,
        tipo_destinatario: "institucional",
        ras: alunosSelecionados.map((aluno) => aluno.ra),
      });

      setFeedback(
        `✓ Cobrança registrada no histórico para ${
          alunosSelecionados.length
        } aluno${alunosSelecionados.length === 1 ? "" : "s"}.`,
      );
    } catch (erro) {
      setFeedback(
        erro instanceof Error
          ? `⚠ ${erro.message}`
          : "⚠ Não foi possível registrar a cobrança.",
      );
    }
  }

  if (carregando) {
    return (
      <section className="communication-page">
        Carregando comunicação...
      </section>
    );
  }

  if (erro) {
    return <section className="communication-page">{erro}</section>;
  }

  return (
    <section className="communication-page">
      <header className="communication-header">
        <div>
          <span className="communication-eyebrow">CENTRAL DE COMUNICAÇÃO</span>
          <div className="page-title-row">
            <span className="page-title-icon">
              <AppIcon name="mail" size={22} />
            </span>
            <h1>Cobrança de documentos</h1>
          </div>
          <p>
            Grupos automáticos por combinação exata de pendências. Escolha um
            grupo, revise os alunos e copie os destinatários para o Outlook.
          </p>
        </div>

        <div className="communication-summary">
          <strong>{grupos.length}</strong>
          <span>combinações encontradas</span>
        </div>
      </header>

      <div className="communication-toolbar">
        <label>
          Unidade
          <AppSelect
            value={unidade}
            onChange={setUnidade}
            ariaLabel="Filtrar comunicação por unidade"
            options={[
              { value: "TODAS", label: "Todas as unidades" },
              ...unidades.map((item) => ({ value: item, label: item })),
            ]}
          />
        </label>

        <label className="communication-search">
          Buscar combinação
          <input
            type="search"
            value={buscaGrupo}
            onChange={(e) => setBuscaGrupo(e.target.value)}
            placeholder="Ex.: Contrato, CPF, Histórico..."
          />
        </label>
      </div>
      <div className="communication-grid">
        <ListaGrupos
          grupos={grupos}
          grupoSelecionado={grupoSelecionado}
          aoSelecionarGrupo={selecionarGrupo}
        />

        <main className="communication-detail">
          {!grupo ? (
            <div className="communication-empty detail">
              Escolha uma combinação para começar.
            </div>
          ) : (
            <>
              <ResumoCombinacao
                grupo={grupo}
                alunosJaCobrados={alunosJaCobrados.length}
                alunosNaoCobrados={alunosNaoCobrados.length}
                ultimaCobrancaGrupo={ultimaCobrancaGrupo}
              />
              <PainelAcoesComunicacao
                modoApresentacao={modoApresentacao}
                quantidadeSelecionados={alunosSelecionados.length}
                selecionadosComInstitucional={selecionadosComInstitucional}
                selecionadosSemInstitucional={selecionadosSemInstitucional}
                quantidadeAlternativos={emailsAlternativos.length}
                emailsInstitucionaisInvalidos={
                  emailsInstitucionaisInvalidos.length
                }
                emailsInstitucionaisDuplicados={emailsInstitucionaisDuplicados}
                validacaoOk={validacaoOk}
                feedback={feedback}
                registrandoHistorico={registrandoHistorico}
                copiarEmails={copiarEmails}
                copiarPacoteOutlook={copiarPacoteOutlook}
                registrarCobranca={registrarCobranca}
              />
              <div
                className={`communication-content-grid ${
                  modoApresentacao ? "presentation-mode" : ""
                }`}
              >
                {!modoApresentacao && (
                  <CartaoEmail
                    emailCardRef={emailCardRef}
                    grupo={grupo}
                    prazo={prazo}
                    setPrazo={setPrazo}
                    assunto={assunto}
                    setAssunto={setAssunto}
                    quantidadeDestinatarios={alunosSelecionados.length}
                    temContrato={temContrato}
                    copiarAssunto={copiarAssunto}
                    copiarComunicado={copiarComunicado}
                  />
                )}
                <ListaAlunos
                  grupo={grupo}
                  modoApresentacao={modoApresentacao}
                  alturaMaximaAlunos={alturaMaximaAlunos}
                  buscaAluno={buscaAluno}
                  setBuscaAluno={setBuscaAluno}
                  selecionados={selecionados}
                  setSelecionados={setSelecionados}
                  alunosNaoCobrados={alunosNaoCobrados}
                  alunosVisiveis={alunosVisiveis}
                  cobrancasPorRa={cobrancasPorRa}
                  alternarAluno={alternarAluno}
                />
                <HistoricoComunicacoes
                  historico={historico}
                  historicoErro={historicoErro}
                  aoAtualizar={carregarHistorico}
                />
              </div>
            </>
          )}
        </main>
      </div>
    </section>
  );
}

export default Comunicacao;
