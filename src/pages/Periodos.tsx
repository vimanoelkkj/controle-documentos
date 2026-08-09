import AppIcon from "../components/AppIcon";
import { useEffect, useMemo, useState } from "react";
import { usePeriodo } from "../contexts/PeriodoContext";

function normalizarCodigo(valor: string) {
  return valor.trim().toUpperCase().replace(/\s+/g, "");
}

type SheetsConfig = {
  spreadsheet_id: string;
  aba_base_face_fea: string;
  aba_base_fch_ead: string;
  aba_docs_face_fea: string;
  aba_docs_fch_ead: string;
  aba_cancelados_face_fea: string;
  aba_cancelados_fch_ead: string;
};

type SheetsPrevia = {
  encontrados: number;
  documentos_encontrados: number;
  cancelados_encontrados: number;
  novos: number;
  alteracoes_cadastrais: number;
  documentos_alterados: number;
  prontos_para_cancelar: number;
  ja_cancelados: number;
  unidades_nao_resolvidas: number;
  detalhes_unidades: Array<{ ra: string; nome: string; curso: string }>;
  cursos_pendentes: Array<{ curso: string; quantidade: number; alunos: Array<{ ra: string; nome: string }> }>;
  detalhes: {
    novos: Array<{ ra: string; nome: string; curso: string; unidade: string | null }>;
    cadastros: Array<{ ra: string; nome: string; detalhe: string }>;
    documentos: Array<{ ra: string; nome: string; detalhe: string }>;
    cancelamentos: Array<{ ra: string; nome: string; unidade: string }>;
  };
  modo: string;
};

type AbaPrevia = "novos" | "cadastros" | "documentos" | "cancelamentos" | "unidades";

type SheetsResultadoSync = {
  novos: number;
  alteracoes_cadastrais: number;
  documentos_alterados: number;
  cancelamentos: number;
  total_operacoes: number;
};

const configVazia: SheetsConfig = {
  spreadsheet_id: "",
  aba_base_face_fea: "FACE - FEA 2026 - 2",
  aba_base_fch_ead: "FCH - EAD 2026 - 2",
  aba_docs_face_fea: "CONTROLE DE DOCUMENTOS FACE FEA",
  aba_docs_fch_ead: "CONTROLE DE DOCUMENTOS FCH EAD",
  aba_cancelados_face_fea: "CANCELADOS FACE - FEA 2026-2",
  aba_cancelados_fch_ead: "CANCELADOS FCH - EAD 2026-2",
};

function Periodos() {
  const { periodos, periodoAtual, selecionarPeriodo, recarregarPeriodos } = usePeriodo();
  const [novoCodigo, setNovoCodigo] = useState("");
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState("");
  const [confirmacao, setConfirmacao] = useState<{ id: number; codigo: string; status: "ATIVO" | "ARQUIVADO" } | null>(null);
  const [sheetsConfig, setSheetsConfig] = useState<SheetsConfig>(configVazia);
  const [sheetsSalvo, setSheetsSalvo] = useState(false);
  const [sheetsCarregando, setSheetsCarregando] = useState(false);
  const [sheetsErro, setSheetsErro] = useState("");
  const [sheetsPrevia, setSheetsPrevia] = useState<SheetsPrevia | null>(null);
  const [abaPrevia, setAbaPrevia] = useState<AbaPrevia | null>(null);
  const [mapeamentos, setMapeamentos] = useState<Record<string, string>>({});
  const [salvandoMapeamentos, setSalvandoMapeamentos] = useState(false);
  const [mapeamentosSalvos, setMapeamentosSalvos] = useState<Record<string, string>>({});
  const [modalSincronizar, setModalSincronizar] = useState(false);
  const [sincronizandoSheets, setSincronizandoSheets] = useState(false);
  const [resultadoSync, setResultadoSync] = useState<SheetsResultadoSync | null>(null);

  useEffect(() => {
    if (!periodoAtual) return;
    let ativo = true;
    setSheetsPrevia(null);
    setAbaPrevia(null);
    setMapeamentos({});
    setMapeamentosSalvos({});
    setSheetsErro("");
    setModalSincronizar(false);
    fetch(`/api/periodos/${periodoAtual.id}/google-sheets`)
      .then(async (resposta) => {
        if (!resposta.ok) throw new Error("Não foi possível carregar a configuração do Google Sheets.");
        return resposta.json() as Promise<SheetsConfig | null>;
      })
      .then((config) => {
        if (!ativo) return;
        setSheetsConfig(config ?? { ...configVazia,
          aba_base_face_fea: `FACE - FEA ${periodoAtual.codigo.replace("-", " - ")}`,
          aba_base_fch_ead: `FCH - EAD ${periodoAtual.codigo.replace("-", " - ")}`,
          aba_cancelados_face_fea: `CANCELADOS FACE - FEA ${periodoAtual.codigo}`,
          aba_cancelados_fch_ead: `CANCELADOS FCH - EAD ${periodoAtual.codigo}`,
        });
        setSheetsSalvo(Boolean(config));
      })
      .catch((e) => ativo && setSheetsErro(e instanceof Error ? e.message : "Erro ao carregar integração."));
    return () => { ativo = false; };
  }, [periodoAtual]);

  async function salvarSheets() {
    if (!periodoAtual) return;
    try {
      setSheetsCarregando(true); setSheetsErro(""); setSheetsPrevia(null);
      const resposta = await fetch(`/api/periodos/${periodoAtual.id}/google-sheets`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sheetsConfig),
      });
      const dados = await resposta.json() as { erro?: string; spreadsheet_id?: string };
      if (!resposta.ok) throw new Error(dados.erro || "Não foi possível salvar a integração.");
      setSheetsConfig((atual) => ({ ...atual, spreadsheet_id: dados.spreadsheet_id || atual.spreadsheet_id }));
      setSheetsSalvo(true);
    } catch (e) { setSheetsErro(e instanceof Error ? e.message : "Erro ao salvar integração."); }
    finally { setSheetsCarregando(false); }
  }

  async function gerarPreviaSheets() {
    if (!periodoAtual) return;
    try {
      setSheetsCarregando(true); setSheetsErro(""); setSheetsPrevia(null);
      const resposta = await fetch(`/api/periodos/${periodoAtual.id}/google-sheets/previa`, { method: "POST" });
      const dados = await resposta.json() as SheetsPrevia & { erro?: string };
      if (!resposta.ok) throw new Error(dados.erro || "Não foi possível ler a planilha.");
      setSheetsPrevia(dados);
    } catch (e) { setSheetsErro(e instanceof Error ? e.message : "Erro ao ler Google Sheets."); }
    finally { setSheetsCarregando(false); }
  }

  const mapeamentosAlterados = useMemo(
    () =>
      Object.entries(mapeamentos).filter(
        ([curso, unidade]) =>
          Boolean(unidade) && unidade !== (mapeamentosSalvos[curso] || ""),
      ),
    [mapeamentos, mapeamentosSalvos],
  );

  async function salvarMapeamentos() {
    if (!periodoAtual || !mapeamentosAlterados.length) return;

    try {
      setSalvandoMapeamentos(true);
      setSheetsErro("");

      for (const [curso, unidade] of mapeamentosAlterados) {
        const resposta = await fetch(
          `/api/periodos/${periodoAtual.id}/google-sheets/mapeamentos`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ curso, unidade }),
          },
        );

        const dados = await resposta.json() as { erro?: string };

        if (!resposta.ok) {
          throw new Error(
            dados.erro || `Não foi possível salvar o mapeamento de ${curso}.`,
          );
        }
      }

      setMapeamentosSalvos((atual) => ({
        ...atual,
        ...Object.fromEntries(mapeamentosAlterados),
      }));

      await gerarPreviaSheets();
      setAbaPrevia("unidades");
    } catch (e) {
      setSheetsErro(
        e instanceof Error ? e.message : "Erro ao salvar os mapeamentos.",
      );
    } finally {
      setSalvandoMapeamentos(false);
    }
  }

  async function sincronizarSheets() {
    if (!periodoAtual || !sheetsPrevia || sheetsPrevia.unidades_nao_resolvidas > 0) return;

    try {
      setSincronizandoSheets(true);
      setSheetsErro("");

      const resposta = await fetch(
        `/api/periodos/${periodoAtual.id}/google-sheets/sincronizar`,
        { method: "POST" },
      );

      const dados = await resposta.json() as SheetsResultadoSync & { erro?: string };

      if (!resposta.ok) {
        throw new Error(dados.erro || "Não foi possível sincronizar a planilha.");
      }

      setModalSincronizar(false);

      // Atualiza os dados da própria página sem recarregar o navegador.
      // O resumo só aparece depois que a prévia e os períodos terminarem de atualizar.
      await gerarPreviaSheets();
      await recarregarPeriodos();

      setResultadoSync(dados);
    } catch (e) {
      setSheetsErro(
        e instanceof Error ? e.message : "Erro ao sincronizar Google Sheets.",
      );
      setModalSincronizar(false);
    } finally {
      setSincronizandoSheets(false);
    }
  }

  const totalOperacoesPrevia = sheetsPrevia
    ? sheetsPrevia.novos +
      sheetsPrevia.alteracoes_cadastrais +
      sheetsPrevia.documentos_alterados +
      sheetsPrevia.prontos_para_cancelar
    : 0;

  const ativos = useMemo(() => periodos.filter((periodo) => periodo.status === "ATIVO"), [periodos]);
  const arquivados = useMemo(() => periodos.filter((periodo) => periodo.status === "ARQUIVADO"), [periodos]);

  async function criarPeriodo() {
    const codigo = normalizarCodigo(novoCodigo);
    if (!/^\d{4}-(1|2)$/.test(codigo)) {
      setErro("Use o formato AAAA-1 ou AAAA-2. Ex.: 2027-1.");
      return;
    }

    try {
      setProcessando(true);
      setErro("");
      const resposta = await fetch("/api/periodos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo }),
      });
      const dados = (await resposta.json()) as { erro?: string };
      if (!resposta.ok) throw new Error(dados.erro || "Não foi possível criar o período.");
      setNovoCodigo("");
      await recarregarPeriodos();
      selecionarPeriodo(codigo);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível criar o período.");
    } finally {
      setProcessando(false);
    }
  }

  async function alterarStatus(id: number, status: "ATIVO" | "ARQUIVADO") {
    try {
      setProcessando(true);
      setErro("");
      const resposta = await fetch(`/api/periodos/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const dados = (await resposta.json()) as { erro?: string };
      if (!resposta.ok) throw new Error(dados.erro || "Não foi possível alterar o período.");
      await recarregarPeriodos();
      setConfirmacao(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível alterar o período.");
    } finally {
      setProcessando(false);
    }
  }

  const renderPeriodo = (periodo: (typeof periodos)[number]) => (
    <article className={`period-card ${periodo.codigo === periodoAtual?.codigo ? "current" : ""}`} key={periodo.id}>
      <div>
        <span className={`period-status ${periodo.status.toLowerCase()}`}>{periodo.status}</span>
        <h3>{periodo.codigo}</h3>
        <p>{periodo.total_alunos} aluno{periodo.total_alunos === 1 ? "" : "s"} vinculado{periodo.total_alunos === 1 ? "" : "s"}</p>
      </div>
      <div className="period-actions">
        <button type="button" onClick={() => selecionarPeriodo(periodo.codigo)} disabled={periodo.codigo === periodoAtual?.codigo}>Abrir período</button>
        <button
          type="button"
          className={periodo.status === "ATIVO" ? "danger-soft" : "secondary"}
          onClick={() => setConfirmacao({ id: periodo.id, codigo: periodo.codigo, status: periodo.status === "ATIVO" ? "ARQUIVADO" : "ATIVO" })}
          disabled={processando}
        >
          {periodo.status === "ATIVO" ? "Arquivar" : "Reativar"}
        </button>
      </div>
    </article>
  );

  return (
    <section className="period-page">
      <header className="period-hero">
        <div>
          <span className="period-eyebrow">GESTÃO ACADÊMICA</span>
          <div className="page-title-row">
          <span className="page-title-icon"><AppIcon name="calendar" size={22} /></span>
          <h1>Períodos letivos</h1>
        </div>
          <p>Crie novos ciclos, alterne o contexto do sistema e arquive períodos antigos sem perder o acesso aos dados.</p>
        </div>
        <div className="period-current">
          <span>PERÍODO EM USO</span>
          <strong>{periodoAtual?.codigo ?? "—"}</strong>
          <small>{periodoAtual?.status ?? ""}</small>
        </div>
      </header>

      <section className="period-create-card">
        <div>
          <span>NOVO PERÍODO</span>
          <h2>Criar período letivo</h2>
          <p>Use o padrão <strong>AAAA-1</strong> ou <strong>AAAA-2</strong>.</p>
        </div>
        <div className="period-create-form">
          <input value={novoCodigo} onChange={(e) => setNovoCodigo(e.target.value)} placeholder="2027-1" maxLength={6} />
          <button type="button" onClick={criarPeriodo} disabled={processando}>+ Criar período</button>
        </div>
      </section>

      <section className="period-sheets-card">
        <div className="period-sheets-heading">
          <div><span>INTEGRAÇÃO</span><h2>Google Sheets</h2><p>Leitura segura da planilha vinculada ao período <strong>{periodoAtual?.codigo ?? "—"}</strong>. A prévia não altera o sistema nem a planilha.</p></div>
          <span className={`period-sheets-status ${sheetsSalvo ? "connected" : ""}`}>{sheetsSalvo ? "CONFIGURADO" : "NÃO CONFIGURADO"}</span>
        </div>
        <label className="period-sheets-main"><span>Link ou ID da planilha</span><input value={sheetsConfig.spreadsheet_id} onChange={(e) => setSheetsConfig({ ...sheetsConfig, spreadsheet_id: e.target.value })} placeholder="https://docs.google.com/spreadsheets/d/..." /></label>
        <div className="period-sheets-grid">
          {([
            ["Base FACE / FEA", "aba_base_face_fea"], ["Base FCH / EAD", "aba_base_fch_ead"],
            ["Documentos FACE / FEA", "aba_docs_face_fea"], ["Documentos FCH / EAD", "aba_docs_fch_ead"],
            ["Cancelados FACE / FEA", "aba_cancelados_face_fea"], ["Cancelados FCH / EAD", "aba_cancelados_fch_ead"],
          ] as Array<[string, keyof SheetsConfig]>).map(([rotulo, campo]) => (
            <label key={campo}><span>{rotulo}</span><input value={sheetsConfig[campo]} onChange={(e) => setSheetsConfig({ ...sheetsConfig, [campo]: e.target.value })} /></label>
          ))}
        </div>
        {sheetsErro && <div className="period-sheets-error">{sheetsErro}</div>}
        <div className="period-sheets-actions"><button type="button" className="secondary" onClick={salvarSheets} disabled={sheetsCarregando || !periodoAtual}>{sheetsCarregando ? "Aguarde..." : "Salvar configuração"}</button><button type="button" onClick={gerarPreviaSheets} disabled={sheetsCarregando || !sheetsSalvo}>{sheetsCarregando ? "Lendo..." : "Ler planilha e gerar prévia"}</button></div>
        {sheetsPrevia && <div className="period-sheets-preview">
          <div className="period-sheets-preview-title"><div><span>PRÉVIA · SOMENTE LEITURA</span><h3>{sheetsPrevia.encontrados} alunos encontrados</h3></div><strong>✓ NADA ALTERADO</strong></div>
          <div className="period-sheets-metrics">
            {([
              ["novos", sheetsPrevia.novos, "Novos alunos"],
              ["cadastros", sheetsPrevia.alteracoes_cadastrais, "Cadastros diferentes"],
              ["documentos", sheetsPrevia.documentos_alterados, "Documentos diferentes"],
              ["cancelamentos", sheetsPrevia.prontos_para_cancelar, "Cancelamentos"],
              ["unidades", sheetsPrevia.unidades_nao_resolvidas, "Unidades a resolver"],
            ] as Array<[AbaPrevia, number, string]>).map(([aba, valor, rotulo]) => (
              <button type="button" key={aba} className={`${aba === "unidades" && valor ? "warning" : ""} ${abaPrevia === aba ? "active" : ""}`} onClick={() => setAbaPrevia(abaPrevia === aba ? null : aba)}>
                <strong>{valor}</strong><span>{rotulo}</span><small>Ver detalhes</small>
              </button>
            ))}
          </div>

          {abaPrevia && <div className="period-sheets-detail">
            <div className="period-sheets-detail-head"><div><span>CONFERÊNCIA</span><h4>{abaPrevia === "unidades" ? "Mapear cursos por unidade" : "Detalhes da prévia"}</h4></div><button type="button" onClick={() => setAbaPrevia(null)}>×</button></div>
            {abaPrevia === "unidades" ? (
              sheetsPrevia.cursos_pendentes.length ? <div className="period-course-map">
                {sheetsPrevia.cursos_pendentes.map((grupo) => <article key={grupo.curso}>
                  <div className="period-course-info">
                    <strong>{grupo.curso}</strong>
                    <span>{grupo.quantidade} aluno(s) será(ão) resolvido(s)</span>
                    <small>{grupo.alunos.slice(0, 3).map((a) => a.nome).join(" · ")}{grupo.alunos.length > 3 ? ` · +${grupo.alunos.length - 3}` : ""}</small>
                  </div>
                  <div className="period-course-actions">
                    <select
                      value={mapeamentos[grupo.curso] || ""}
                      onChange={(e) =>
                        setMapeamentos((atual) => ({
                          ...atual,
                          [grupo.curso]: e.target.value,
                        }))
                      }
                      disabled={salvandoMapeamentos}
                    >
                      <option value="">Selecionar unidade</option>
                      <option value="FACE">FACE</option>
                      <option value="FEA">FEA</option>
                      <option value="FCH">FCH</option>
                      <option value="EAD">EAD</option>
                    </select>
                  </div>
                </article>)}
                <div className="period-course-map-save">
                  <div>
                    <span>MAPEAMENTO DE UNIDADES</span>
                    <strong>
                      {mapeamentosAlterados.length
                        ? `${mapeamentosAlterados.length} alteração(ões) pronta(s) para salvar`
                        : "Nenhuma alteração para salvar"}
                    </strong>
                    <small>Ajuste todos os cursos acima e salve tudo de uma vez.</small>
                  </div>
                  <button
                    type="button"
                    onClick={salvarMapeamentos}
                    disabled={!mapeamentosAlterados.length || salvandoMapeamentos}
                  >
                    {salvandoMapeamentos
                      ? "Salvando unidades..."
                      : mapeamentosAlterados.length
                        ? `Salvar ${mapeamentosAlterados.length} alteração(ões)`
                        : "Salvar unidades"}
                  </button>
                </div>
              </div> : <div className="period-sheets-resolved">✓ Todas as unidades foram resolvidas.</div>
            ) : (
              <div className="period-preview-list">
                {(abaPrevia === "novos" ? sheetsPrevia.detalhes.novos : abaPrevia === "cadastros" ? sheetsPrevia.detalhes.cadastros : abaPrevia === "documentos" ? sheetsPrevia.detalhes.documentos : sheetsPrevia.detalhes.cancelamentos).map((item) => (
                  <article key={`${abaPrevia}-${item.ra}`}><div><strong>{item.nome}</strong><span>RA {item.ra}</span></div><p>{"curso" in item ? `${item.curso} · ${item.unidade || "Unidade pendente"}` : "detalhe" in item ? item.detalhe : `Unidade ${item.unidade}`}</p></article>
                ))}
                {((abaPrevia === "novos" && !sheetsPrevia.detalhes.novos.length) || (abaPrevia === "cadastros" && !sheetsPrevia.detalhes.cadastros.length) || (abaPrevia === "documentos" && !sheetsPrevia.detalhes.documentos.length) || (abaPrevia === "cancelamentos" && !sheetsPrevia.detalhes.cancelamentos.length)) && <div className="period-sheets-resolved">Nenhuma divergência nesta categoria.</div>}
              </div>
            )}
          </div>}
          {sheetsPrevia.unidades_nao_resolvidas > 0 && <div className="period-sheets-warning"><strong>Atenção:</strong> existem {sheetsPrevia.unidades_nao_resolvidas} alunos sem unidade definida. Clique em <strong>Unidades a resolver</strong> e mapeie cada curso antes da sincronização.</div>}
          {sheetsPrevia.unidades_nao_resolvidas === 0 && (
            <>
              <div className="period-sheets-ready">
                <strong>✓ Unidades resolvidas.</strong> A prévia está pronta para sincronização.
              </div>
              <div className={`period-sheets-sync-bar ${totalOperacoesPrevia === 0 ? "is-synced" : ""}`}>
                <div>
                  <span>{totalOperacoesPrevia === 0 ? "TUDO SINCRONIZADO" : "APLICAR ALTERAÇÕES"}</span>
                  <strong>
                    {totalOperacoesPrevia === 0
                      ? "✓ Nenhuma alteração encontrada"
                      : `${totalOperacoesPrevia} operação(ões) pronta(s)`}
                  </strong>
                  <small>
                    {totalOperacoesPrevia === 0
                      ? "O Google Sheets e o sistema estão sem divergências."
                      : "A planilha será lida novamente no momento da sincronização."}
                  </small>
                </div>
                <button
                  type="button"
                  onClick={() => { setResultadoSync(null); setModalSincronizar(true); }}
                  disabled={sincronizandoSheets || totalOperacoesPrevia === 0}
                >
                  {totalOperacoesPrevia === 0 ? "Sem alterações" : "Sincronizar agora"}
                </button>
              </div>
            </>
          )}
        </div>}
      </section>

      {erro && <div className="period-error">{erro}</div>}

      <section className="period-section">
        <div className="period-section-header"><div><span>OPERAÇÃO</span><h2>Períodos ativos</h2></div><strong>{ativos.length}</strong></div>
        <div className="period-list">{ativos.map(renderPeriodo)}</div>
      </section>

      <section className={`period-section archived ${arquivados.length === 0 ? "empty" : ""}`}>
        <div className="period-section-header"><div><span>HISTÓRICO</span><h2>Períodos arquivados</h2></div><strong>{arquivados.length}</strong></div>
        {arquivados.length ? (
          <div className="period-list">{arquivados.map(renderPeriodo)}</div>
        ) : (
          <div className="period-empty">
            <div className="period-empty-icon" aria-hidden="true">◷</div>
            <strong>Nenhum período arquivado</strong>
            <p>Quando um período for arquivado, ele continuará disponível aqui para consulta, edição ou reativação.</p>
          </div>
        )}
      </section>

      {resultadoSync && (
        <div className="period-sheets-sync-result">
          <div>
            <span>ÚLTIMA SINCRONIZAÇÃO</span>
            <strong>✓ Google Sheets aplicado ao sistema</strong>
          </div>
          <p>
            {resultadoSync.novos} novo(s) · {resultadoSync.alteracoes_cadastrais} cadastro(s) · {resultadoSync.documentos_alterados} documento(s) · {resultadoSync.cancelamentos} cancelamento(s)
          </p>
          <button type="button" onClick={() => setResultadoSync(null)}>×</button>
        </div>
      )}

      {modalSincronizar && sheetsPrevia && (
        <div className="modal-overlay">
          <section className="period-sync-confirm-modal" role="dialog" aria-modal="true">
            <header>
              <span>SINCRONIZAÇÃO</span>
              <h2>Aplicar Google Sheets?</h2>
              <p>
                As diferenças da prévia serão gravadas no período <strong>{periodoAtual?.codigo}</strong>.
                Antes de escrever, o servidor lerá a planilha novamente.
              </p>
            </header>

            <div className="period-sync-confirm-grid">
              <div><strong>{sheetsPrevia.novos}</strong><span>Novos</span></div>
              <div><strong>{sheetsPrevia.alteracoes_cadastrais}</strong><span>Cadastros</span></div>
              <div><strong>{sheetsPrevia.documentos_alterados}</strong><span>Documentos</span></div>
              <div><strong>{sheetsPrevia.prontos_para_cancelar}</strong><span>Cancelamentos</span></div>
            </div>

            <div className="period-sync-confirm-note">
              <strong>Importante:</strong> esta operação altera o banco do sistema e será registrada no LOG.
            </div>

            <footer>
              <button
                type="button"
                className="period-sync-back-button"
                onClick={() => setModalSincronizar(false)}
                disabled={sincronizandoSheets}
              >
                Voltar
              </button>
              <button type="button" onClick={sincronizarSheets} disabled={sincronizandoSheets}>
                {sincronizandoSheets ? "Sincronizando..." : "Confirmar sincronização"}
              </button>
            </footer>
          </section>
        </div>
      )}

      {confirmacao && (
        <div className="modal-overlay" onMouseDown={() => !processando && setConfirmacao(null)}>
          <div className="period-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="period-confirm-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-cabecalho">
              <div>
                <span className="modal-eyebrow">PERÍODOS LETIVOS</span>
                <h2 id="period-confirm-title">{confirmacao.status === "ARQUIVADO" ? "Arquivar período?" : "Reativar período?"}</h2>
                <p>
                  {confirmacao.status === "ARQUIVADO"
                    ? <>O período <strong>{confirmacao.codigo}</strong> sairá da operação diária, mas continuará acessível e poderá ser editado quando necessário.</>
                    : <>O período <strong>{confirmacao.codigo}</strong> voltará para a lista de períodos ativos e poderá ser usado normalmente.</>}
                </p>
              </div>
              <button type="button" className="modal-fechar" onClick={() => setConfirmacao(null)} disabled={processando}>×</button>
            </div>
            <div className="modal-acoes">
              <button type="button" className="botao-cancelar" onClick={() => setConfirmacao(null)} disabled={processando}>Cancelar</button>
              <button
                type="button"
                className={confirmacao.status === "ARQUIVADO" ? "period-confirm-danger" : "botao-cadastrar"}
                onClick={() => alterarStatus(confirmacao.id, confirmacao.status)}
                disabled={processando}
              >
                {processando ? "Processando..." : confirmacao.status === "ARQUIVADO" ? "Arquivar período" : "Reativar período"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default Periodos;
