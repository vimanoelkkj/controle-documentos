import { useEffect, useMemo, useState } from "react";

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

type DocumentoDef = {
  campo: keyof Pick<
    AlunoApi,
    | "identidade"
    | "cpf"
    | "certidao"
    | "residencia"
    | "titulo"
    | "ensino_medio"
    | "contrato"
  >;
  curto: string;
  email: string;
  prioritario?: boolean;
};

type Grupo = {
  chave: string;
  documentos: DocumentoDef[];
  alunos: AlunoApi[];
};

const DOCUMENTOS: DocumentoDef[] = [
  { campo: "identidade", curto: "Identidade", email: "IDENTIDADE" },
  { campo: "cpf", curto: "CPF", email: "CPF" },
  {
    campo: "certidao",
    curto: "Certidão de Registro Civil",
    email: "CERTIDÃO DE REGISTRO CIVIL (NASCIMENTO OU CASAMENTO)",
  },
  {
    campo: "residencia",
    curto: "Comprovante de Residência",
    email: "COMPROVANTE DE RESIDÊNCIA",
  },
  {
    campo: "titulo",
    curto: "Título de Eleitor",
    email: "TÍTULO DE ELEITOR",
  },
  {
    campo: "ensino_medio",
    curto: "Histórico do Ensino Médio",
    email: "HISTÓRICO ESCOLAR DO ENSINO MÉDIO (DOCUMENTO PRIORITÁRIO)",
    prioritario: true,
  },
  {
    campo: "contrato",
    curto: "Contrato",
    email: "CONTRATO DE MATRÍCULA (DOCUMENTO PRIORITÁRIO)",
    prioritario: true,
  },
];

function normalizarEmail(valor: string | null | undefined) {
  const email = (valor || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function criarGrupos(alunos: AlunoApi[]): Grupo[] {
  const mapa = new Map<string, Grupo>();

  alunos
    .filter((aluno) => aluno.status === "ATIVO")
    .forEach((aluno) => {
      const pendentes = DOCUMENTOS.filter(
        (documento) => aluno[documento.campo] !== 1,
      );

      if (pendentes.length === 0) return;

      // A chave representa a combinação EXATA. Alguém que deve só
      // Contrato nunca cai no grupo Contrato + Histórico.
      const chave = DOCUMENTOS.map((documento) =>
        aluno[documento.campo] === 1 ? "0" : "1",
      ).join("");

      const existente = mapa.get(chave);

      if (existente) {
        existente.alunos.push(aluno);
      } else {
        mapa.set(chave, {
          chave,
          documentos: pendentes,
          alunos: [aluno],
        });
      }
    });

  return [...mapa.values()]
    .map((grupo) => ({
      ...grupo,
      alunos: [...grupo.alunos].sort((a, b) =>
        a.nome.localeCompare(b.nome, "pt-BR"),
      ),
    }))
    .sort(
      (a, b) =>
        b.alunos.length - a.alunos.length ||
        a.documentos.length - b.documentos.length,
    );
}

async function copiar(texto: string) {
  await navigator.clipboard.writeText(texto);
}

function Comunicacao() {
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

  const unidades = useMemo(
    () =>
      [...new Set(alunos.map((aluno) => aluno.unidade))]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "pt-BR")),
    [alunos],
  );

  const grupos = useMemo(() => {
    const base =
      unidade === "TODAS"
        ? alunos
        : alunos.filter((aluno) => aluno.unidade === unidade);

    const termo = buscaGrupo.trim().toLocaleLowerCase("pt-BR");

    return criarGrupos(base).filter(
      (grupo) =>
        !termo ||
        grupo.documentos.some((documento) =>
          documento.curto.toLocaleLowerCase("pt-BR").includes(termo),
        ),
    );
  }, [alunos, unidade, buscaGrupo]);

  useEffect(() => {
    if (!grupos.length) {
      setGrupoSelecionado("");
      return;
    }

    if (!grupos.some((grupo) => grupo.chave === grupoSelecionado)) {
      setGrupoSelecionado(grupos[0].chave);
    }
  }, [grupos, grupoSelecionado]);

  const grupo = grupos.find((item) => item.chave === grupoSelecionado);

  useEffect(() => {
    if (!grupo) {
      setSelecionados(new Set());
      return;
    }
    setSelecionados(new Set(grupo.alunos.map((aluno) => aluno.ra)));
    setBuscaAluno("");
  }, [grupoSelecionado, grupo?.chave]);

  const alunosVisiveis = useMemo(() => {
    if (!grupo) return [];
    const termo = buscaAluno.trim().toLocaleLowerCase("pt-BR");
    return grupo.alunos.filter(
      (aluno) =>
        !termo ||
        `${aluno.nome} ${aluno.ra} ${aluno.curso} ${aluno.email || ""} ${
          aluno.email_outro || ""
        }`
          .toLocaleLowerCase("pt-BR")
          .includes(termo),
    );
  }, [grupo, buscaAluno]);

  const alunosSelecionados =
    grupo?.alunos.filter((aluno) => selecionados.has(aluno.ra)) || [];

  const emailsInstitucionais = [
    ...new Set(
      alunosSelecionados.map((a) => normalizarEmail(a.email)).filter(Boolean),
    ),
  ];

  const emailsAlternativos = [
    ...new Set(
      alunosSelecionados
        .map((a) => normalizarEmail(a.email_outro))
        .filter(Boolean),
    ),
  ];

  const temContrato =
    grupo?.documentos.some((documento) => documento.campo === "contrato") ??
    false;

  const textoEmail = grupo
    ? `⚠️ ATENÇÃO! NÃO RESPONDER A ESTE E-MAIL. MANDE A SUA RESPOSTA PARA O E-MAIL ABAIXO⬇️:

matriculadecalouro@fumec.br

Prezado(a), boa tarde.
Informo que em verificação ao nosso sistema a sua matrícula está pendente alguns documentos importantes. Peço que realize o envio dos mesmos o mais rápido possível via e-mail para matriculadecalouro@fumec.br ou, se preferir, pode comparecer pessoalmente na secretaria acadêmica até o dia ${prazo || "___/___"}. Informo que a não apresentação destes documentos poderá resultar no bloqueio da sua matrícula. Segue lista abaixo:

${grupo.documentos.map((documento) => `${documento.email};`).join("\n")}${
        temContrato
          ? `

Caso esteja pendente o CONTRATO DE MATRÍCULA assinado, você irá receber no seu e-mail o link para o portal de visualização e assinatura do contrato. Caso contrário, desconsidere as orientações.`
          : ""
      }`
    : "";

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

  async function copiarEmails(tipo: "institucional" | "alternativo" | "ambos") {
    let lista: string[] = [];
    if (tipo === "institucional") lista = emailsInstitucionais;
    if (tipo === "alternativo") lista = emailsAlternativos;
    if (tipo === "ambos")
      lista = [...new Set([...emailsInstitucionais, ...emailsAlternativos])];

    if (!lista.length) {
      setFeedback("Nenhum e-mail válido nos alunos selecionados.");
      return;
    }

    await copiar(lista.join("; "));
    setFeedback(
      `✓ ${lista.length} e-mail${lista.length === 1 ? "" : "s"} copiado${
        lista.length === 1 ? "" : "s"
      } para colar no CCO do Outlook.`,
    );
  }

  async function copiarComunicado() {
    await copiar(textoEmail);
    setFeedback("✓ Texto do comunicado copiado.");
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
          <h1>Cobrança de documentos</h1>
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
          <select value={unidade} onChange={(e) => setUnidade(e.target.value)}>
            <option value="TODAS">Todas as unidades</option>
            {unidades.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
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
        <aside className="communication-groups">
          <div className="communication-panel-title">
            <div>
              <span>COMBINAÇÕES EXATAS</span>
              <strong>{grupos.length} grupos</strong>
            </div>
          </div>

          <div className="communication-group-list">
            {grupos.map((item) => (
              <button
                key={item.chave}
                type="button"
                className={`communication-group-card ${
                  item.chave === grupoSelecionado ? "active" : ""
                }`}
                onClick={() => selecionarGrupo(item.chave)}
              >
                <div className="communication-group-copy">
                  <strong>
                    {item.documentos.length === 7
                      ? "Todos os documentos"
                      : item.documentos.map((doc) => doc.curto).join(" + ")}
                  </strong>
                  <span>
                    {item.alunos.length} aluno
                    {item.alunos.length === 1 ? "" : "s"}
                  </span>
                </div>
                <span className="communication-group-count">
                  {item.alunos.length}
                </span>
              </button>
            ))}

            {!grupos.length && (
              <div className="communication-empty">
                Nenhuma combinação encontrada.
              </div>
            )}
          </div>
        </aside>

        <main className="communication-detail">
          {!grupo ? (
            <div className="communication-empty detail">
              Escolha uma combinação para começar.
            </div>
          ) : (
            <>
              <div className="communication-detail-header">
                <div>
                  <span>COMBINAÇÃO EXATA</span>
                  <h2>
                    {grupo.documentos.length === 7
                      ? "Todos os documentos"
                      : grupo.documentos.map((doc) => doc.curto).join(" + ")}
                  </h2>
                  <p>
                    Aqui entram somente alunos que devem exatamente estes
                    documentos — nenhum a mais e nenhum a menos.
                  </p>
                </div>
                <strong className="communication-big-count">
                  {grupo.alunos.length}
                </strong>
              </div>

              <div className="communication-tags">
                {grupo.documentos.map((documento) => (
                  <span
                    key={documento.campo}
                    className={documento.prioritario ? "priority" : ""}
                  >
                    {documento.curto}
                    {documento.prioritario ? " • prioritário" : ""}
                  </span>
                ))}
              </div>

              <div className="communication-actions">
                <div>
                  <span>DESTINATÁRIOS</span>
                  <strong>
                    {alunosSelecionados.length} alunos selecionados
                  </strong>
                  <small>
                    {emailsInstitucionais.length} institucionais •{" "}
                    {emailsAlternativos.length} alternativos
                  </small>
                </div>
                <div className="communication-action-buttons">
                  <button onClick={() => copiarEmails("institucional")}>
                    Copiar institucionais
                  </button>
                  <button onClick={() => copiarEmails("alternativo")}>
                    Copiar alternativos
                  </button>
                  <button onClick={() => copiarEmails("ambos")}>
                    Copiar ambos
                  </button>
                </div>
              </div>

              {feedback && (
                <div className="communication-feedback">{feedback}</div>
              )}

              <div className="communication-content-grid">
                <section className="communication-email-card">
                  <div className="communication-email-settings">
                    <label>
                      Data limite
                      <input
                        value={prazo}
                        onChange={(e) => setPrazo(e.target.value)}
                        placeholder="01/07"
                      />
                    </label>
                    <label>
                      Assunto
                      <input
                        value={assunto}
                        onChange={(e) => setAssunto(e.target.value)}
                      />
                    </label>
                    <button type="button" onClick={copiarComunicado}>
                      Copiar texto
                    </button>
                  </div>

                  <div className="communication-preview">
                    <div className="communication-preview-top">
                      <div>
                        <span>PRÉ-VISUALIZAÇÃO</span>
                        <strong>{assunto || "Sem assunto"}</strong>
                      </div>
                      <span>{grupo.documentos.length} pendência(s)</span>
                    </div>

                    <div className="communication-email-body">
                      <p className="communication-warning">
                        ⚠️ <b>ATENÇÃO! NÃO RESPONDER A ESTE E-MAIL.</b> MANDE A
                        SUA RESPOSTA PARA O E-MAIL ABAIXO⬇️:
                      </p>
                      <p className="communication-address">
                        matriculadecalouro@fumec.br
                      </p>
                      <p>Prezado(a), boa tarde.</p>
                      <p>
                        Informo que em verificação ao nosso sistema a sua
                        matrícula está pendente alguns documentos importantes.
                        Peço que realize o envio dos mesmos o mais rápido
                        possível via e-mail para{" "}
                        <b>matriculadecalouro@fumec.br</b> ou, se preferir, pode
                        comparecer pessoalmente na secretaria acadêmica até o
                        dia <b>{prazo || "___/___"}</b>. Informo que a não
                        apresentação destes documentos poderá resultar no
                        bloqueio da sua matrícula. Segue lista abaixo:
                      </p>

                      <ul>
                        {grupo.documentos.map((documento) => (
                          <li
                            key={documento.campo}
                            className={documento.prioritario ? "priority" : ""}
                          >
                            {documento.email};
                          </li>
                        ))}
                      </ul>

                      {temContrato && (
                        <p>
                          Caso esteja pendente o{" "}
                          <b className="communication-priority-text">
                            CONTRATO DE MATRÍCULA
                          </b>{" "}
                          assinado, você irá receber no seu e-mail o link para o
                          portal de visualização e assinatura do contrato. Caso
                          contrário, desconsidere as orientações.
                        </p>
                      )}
                    </div>
                  </div>
                </section>

                <section className="communication-students-card">
                  <div className="communication-students-header">
                    <div>
                      <span>ALUNOS DO GRUPO</span>
                      <strong>
                        {selecionados.size}/{grupo.alunos.length} selecionados
                      </strong>
                    </div>
                    <input
                      type="search"
                      value={buscaAluno}
                      onChange={(e) => setBuscaAluno(e.target.value)}
                      placeholder="Nome, RA, curso ou e-mail"
                    />
                  </div>

                  <div className="communication-select-actions">
                    <button
                      type="button"
                      onClick={() =>
                        setSelecionados(
                          new Set(grupo.alunos.map((aluno) => aluno.ra)),
                        )
                      }
                    >
                      Selecionar todos
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelecionados(new Set())}
                    >
                      Limpar seleção
                    </button>
                  </div>

                  <div className="communication-student-list">
                    {alunosVisiveis.map((aluno) => (
                      <label key={aluno.ra} className="communication-student">
                        <input
                          type="checkbox"
                          checked={selecionados.has(aluno.ra)}
                          onChange={() => alternarAluno(aluno.ra)}
                        />
                        <div>
                          <strong>{aluno.nome}</strong>
                          <span>
                            RA {aluno.ra} • {aluno.curso} • {aluno.unidade}
                          </span>
                          <small>
                            {normalizarEmail(aluno.email) ||
                              "Sem e-mail institucional"}
                            {" • "}
                            {normalizarEmail(aluno.email_outro) ||
                              "Sem e-mail alternativo"}
                          </small>
                        </div>
                      </label>
                    ))}
                  </div>
                </section>
              </div>
            </>
          )}
        </main>
      </div>
    </section>
  );
}

export default Comunicacao;
