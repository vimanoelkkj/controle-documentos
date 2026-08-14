import AppIcon from "../components/AppIcon";
import { useEffect, useMemo, useState } from "react";
import { usePeriodo } from "../contexts/periodo";
import AppSelect from "../components/AppSelect";
import { api } from "../lib/api";
import { useAuth } from "../contexts/auth";
import { useGoogleSheetsPeriodo } from "./periodos/hooks/useGoogleSheetsPeriodo";

function normalizarCodigo(valor: string) {
  return valor.trim().toUpperCase().replace(/\s+/g, "");
}

function formatarCodigoPeriodo(valor: string) {
  const numeros = valor.replace(/\D/g, "").slice(0, 5);
  if (numeros.length < 4) return numeros;
  if (numeros.length === 4) return `${numeros}-`;
  return `${numeros.slice(0, 4)}-${numeros.slice(4)}`;
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

type AbaPrevia =
  | "novos"
  | "cadastros"
  | "documentos"
  | "cancelamentos"
  | "reativacoes"
  | "unidades"
  | "remocoes";

function Periodos() {
  const { modoApresentacao } = useAuth();
  const { periodos, periodoAtual, selecionarPeriodo, recarregarPeriodos } =
    usePeriodo();
  const {
    sheetsConfig,
    setSheetsConfig,
    sheetsStatus,
    sheetsTitulo,
    sheetsSalvo,
    sheetsCarregando,
    sheetsErro,
    sheetsPrevia,
    abaPrevia,
    setAbaPrevia,
    listaPreviaRef,
    mapeamentos,
    setMapeamentos,
    salvandoMapeamentos,
    mapeamentosAlterados,
    modalSincronizar,
    setModalSincronizar,
    sincronizandoSheets,
    resultadoSync,
    setResultadoSync,
    modalSucessoSync,
    setModalSucessoSync,
    mostrarAlteracoesSync,
    setMostrarAlteracoesSync,
    salvarSheets,
    gerarPreviaSheets,
    salvarMapeamentos,
    sincronizarSheets,
    totalOperacoesPrevia,
  } = useGoogleSheetsPeriodo({
    periodoAtual,
    recarregarPeriodos,
  });
  const [novoCodigo, setNovoCodigo] = useState("");
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState("");
  const [confirmacao, setConfirmacao] = useState<{
    id: number;
    codigo: string;
    status: "ATIVO" | "ARQUIVADO";
  } | null>(null);
  useEffect(() => {
    const temModalAberto =
      modalSincronizar || modalSucessoSync || confirmacao !== null;

    if (!temModalAberto) return;

    const overflowAnterior = document.body.style.overflow;

    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = overflowAnterior;
    };
  }, [modalSincronizar, modalSucessoSync, confirmacao]);

  const ativos = useMemo(
    () => periodos.filter((periodo) => periodo.status === "ATIVO"),
    [periodos],
  );
  const arquivados = useMemo(
    () => periodos.filter((periodo) => periodo.status === "ARQUIVADO"),
    [periodos],
  );

  async function criarPeriodo() {
    const codigo = normalizarCodigo(novoCodigo);
    if (!/^\d{4}-(1|2)$/.test(codigo)) {
      setErro("Use o formato AAAA-1 ou AAAA-2. Ex.: 2027-1.");
      return;
    }

    try {
      setProcessando(true);
      setErro("");
      await api.post<{ sucesso: boolean; id: number }>("/api/periodos", {
        codigo,
      });
      setNovoCodigo("");
      await recarregarPeriodos();
      selecionarPeriodo(codigo);
    } catch (e) {
      setErro(
        e instanceof Error ? e.message : "Não foi possível criar o período.",
      );
    } finally {
      setProcessando(false);
    }
  }

  async function alterarStatus(id: number, status: "ATIVO" | "ARQUIVADO") {
    try {
      setProcessando(true);
      setErro("");
      await api.put<{ sucesso: boolean }>(`/api/periodos/${id}`, { status });
      await recarregarPeriodos();
      setConfirmacao(null);
    } catch (e) {
      setErro(
        e instanceof Error ? e.message : "Não foi possível alterar o período.",
      );
    } finally {
      setProcessando(false);
    }
  }

  const renderPeriodo = (periodo: (typeof periodos)[number]) => (
    <article
      className={`period-card ${periodo.codigo === periodoAtual?.codigo ? "current" : ""}`}
      key={periodo.id}
    >
      <div>
        <span className={`period-status ${periodo.status.toLowerCase()}`}>
          {periodo.status}
        </span>
        <h3>{periodo.codigo}</h3>
        <p>
          {periodo.total_alunos} aluno{periodo.total_alunos === 1 ? "" : "s"}{" "}
          vinculado{periodo.total_alunos === 1 ? "" : "s"}
        </p>
      </div>
      <div className="period-actions">
        <button
          type="button"
          onClick={() => selecionarPeriodo(periodo.codigo)}
          disabled={periodo.codigo === periodoAtual?.codigo}
        >
          Abrir período
        </button>
        {!modoApresentacao && (
          <button
            type="button"
            className={periodo.status === "ATIVO" ? "danger-soft" : "secondary"}
            onClick={() =>
              setConfirmacao({
                id: periodo.id,
                codigo: periodo.codigo,
                status: periodo.status === "ATIVO" ? "ARQUIVADO" : "ATIVO",
              })
            }
            disabled={processando}
          >
            {periodo.status === "ATIVO" ? "Arquivar" : "Reativar"}
          </button>
        )}
      </div>
    </article>
  );

  return (
    <section className="period-page">
      <header className="period-hero">
        <div>
          <span className="period-eyebrow">GESTÃO ACADÊMICA</span>
          <div className="page-title-row">
            <span className="page-title-icon">
              <AppIcon name="calendar" size={22} />
            </span>
            <h1>Períodos letivos</h1>
          </div>
          <p>
            Crie novos ciclos, alterne o contexto do sistema e arquive períodos
            antigos sem perder o acesso aos dados.
          </p>
        </div>
        <div className="period-current">
          <span>PERÍODO EM USO</span>
          <strong>{periodoAtual?.codigo ?? "—"}</strong>
          <small>{periodoAtual?.status ?? ""}</small>
        </div>
      </header>

      {!modoApresentacao && (
        <section className="period-create-card">
          <div>
            <span>NOVO PERÍODO</span>
            <h2>Criar período letivo</h2>
            <p>
              Use o padrão <strong>AAAA-1</strong> ou <strong>AAAA-2</strong>.
            </p>
          </div>

          <div className="period-create-form">
            <input
              value={novoCodigo}
              onChange={(e) =>
                setNovoCodigo(formatarCodigoPeriodo(e.target.value))
              }
              onKeyDown={(e) => {
                const input = e.currentTarget;
                const cursorNoFim =
                  input.selectionStart === novoCodigo.length &&
                  input.selectionEnd === novoCodigo.length;

                if (
                  e.key === "Backspace" &&
                  novoCodigo.endsWith("-") &&
                  cursorNoFim
                ) {
                  e.preventDefault();
                  setNovoCodigo(novoCodigo.slice(0, -2));
                }
              }}
              placeholder="2027-1"
              maxLength={6}
              inputMode="numeric"
              aria-label="Novo período letivo no formato ano e semestre"
            />

            <button type="button" onClick={criarPeriodo} disabled={processando}>
              + Criar período
            </button>
          </div>
        </section>
      )}

      <section className="period-sheets-card">
        <div className="period-sheets-heading">
          <div>
            <span>INTEGRAÇÃO</span>
            <h2>Google Sheets</h2>
            <p>
              Leitura segura da planilha vinculada ao período{" "}
              <strong>{periodoAtual?.codigo ?? "—"}</strong>. A prévia não
              altera o sistema nem a planilha.
            </p>
          </div>
          <div className="period-sheets-heading-status">
            <span
              className={`period-sheets-status ${sheetsStatus === "configurado" ? "connected" : ""}`}
            >
              {sheetsStatus === "carregando"
                ? "CARREGANDO..."
                : sheetsStatus === "configurado"
                  ? "CONFIGURADO"
                  : sheetsStatus === "indisponivel"
                    ? "INDISPONÍVEL"
                    : "NÃO CONFIGURADO"}
            </span>
            {sheetsTitulo && (
              <div className="period-sheets-file" title={sheetsTitulo}>
                <span>PLANILHA VINCULADA</span>
                <strong>{sheetsTitulo}</strong>
              </div>
            )}
          </div>
        </div>
        <label className="period-sheets-main">
          <span>Link ou ID da planilha</span>
          <input
            value={
              modoApresentacao
                ? sheetsConfig.spreadsheet_id
                  ? "Planilha configurada"
                  : ""
                : sheetsConfig.spreadsheet_id
            }
            disabled={modoApresentacao}
            onChange={(e) =>
              setSheetsConfig({
                ...sheetsConfig,
                spreadsheet_id: e.target.value,
              })
            }
            placeholder="https://docs.google.com/spreadsheets/d/..."
          />
        </label>
        <div className="period-sheets-grid">
          {(
            [
              ["Base FACE / FEA", "aba_base_face_fea"],
              ["Base FCH / EAD", "aba_base_fch_ead"],
              ["Documentos FACE / FEA", "aba_docs_face_fea"],
              ["Documentos FCH / EAD", "aba_docs_fch_ead"],
              ["Cancelados FACE / FEA", "aba_cancelados_face_fea"],
              ["Cancelados FCH / EAD", "aba_cancelados_fch_ead"],
            ] as Array<[string, keyof SheetsConfig]>
          ).map(([rotulo, campo]) => (
            <label key={campo}>
              <span>{rotulo}</span>
              <input
                value={sheetsConfig[campo]}
                disabled={modoApresentacao}
                onChange={(e) =>
                  setSheetsConfig({ ...sheetsConfig, [campo]: e.target.value })
                }
              />
            </label>
          ))}
        </div>
        {sheetsErro && <div className="period-sheets-error">{sheetsErro}</div>}
        <div className="period-sheets-actions">
          {!modoApresentacao && (
            <button
              type="button"
              className="secondary"
              onClick={salvarSheets}
              disabled={sheetsCarregando || !periodoAtual}
            >
              {sheetsCarregando ? "Aguarde..." : "Salvar configuração"}
            </button>
          )}
          <button
            type="button"
            onClick={gerarPreviaSheets}
            disabled={sheetsCarregando || !sheetsSalvo}
          >
            {sheetsCarregando ? "Lendo..." : "Ler planilha e gerar prévia"}
          </button>
        </div>
        {sheetsPrevia && (
          <div className="period-sheets-preview">
            <div className="period-sheets-preview-title">
              <div>
                <span>PRÉVIA · SOMENTE LEITURA</span>
                <h3>{sheetsPrevia.encontrados} alunos encontrados</h3>
              </div>
              <strong>✓ NADA ALTERADO</strong>
            </div>
            <div className="period-sheets-metrics">
              {(
                [
                  ["novos", sheetsPrevia.novos, "Novos alunos"],
                  [
                    "cadastros",
                    sheetsPrevia.alteracoes_cadastrais,
                    "Cadastros diferentes",
                  ],
                  [
                    "documentos",
                    sheetsPrevia.documentos_alterados,
                    "Documentos diferentes",
                  ],
                  [
                    "cancelamentos",
                    sheetsPrevia.prontos_para_cancelar,
                    "Cancelamentos",
                  ],
                  [
                    "reativacoes",
                    sheetsPrevia.prontos_para_reativar,
                    "Reativações",
                  ],
                  ["remocoes", sheetsPrevia.prontos_para_remover, "Remoções"],
                  [
                    "unidades",
                    sheetsPrevia.cursos_nao_mapeados ??
                      sheetsPrevia.cursos_pendentes.length,
                    "Cursos a mapear",
                  ],
                ] as Array<[AbaPrevia, number, string]>
              ).map(([aba, valor, rotulo]) => (
                <button
                  type="button"
                  key={aba}
                  className={[
                    aba === "unidades" && valor ? "warning" : "",
                    abaPrevia === aba ? "active" : "",
                    (
                      aba === "documentos"
                        ? sheetsPrevia.documentos_alterados > 0
                        : valor > 0
                    )
                      ? "has-details"
                      : "no-details",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => {
                    const temDetalhes =
                      aba === "documentos"
                        ? sheetsPrevia.documentos_alterados > 0
                        : valor > 0;

                    if (temDetalhes) {
                      setAbaPrevia(aba);
                    }
                  }}
                >
                  <strong>{valor}</strong>
                  <span>{rotulo}</span>
                  {(aba === "documentos"
                    ? sheetsPrevia.documentos_alterados > 0
                    : valor > 0) && <small>Ver detalhes</small>}
                </button>
              ))}
            </div>

            {abaPrevia && (
              <div className="period-sheets-detail">
                <div className="period-sheets-detail-head">
                  <div>
                    <span>CONFERÊNCIA</span>
                    <h4>
                      {abaPrevia === "unidades"
                        ? "Mapear cursos por unidade"
                        : "Detalhes da prévia"}
                    </h4>
                  </div>
                  <button type="button" onClick={() => setAbaPrevia(null)}>
                    ×
                  </button>
                </div>
                {abaPrevia === "unidades" ? (
                  sheetsPrevia.cursos_pendentes.length ? (
                    <div className="period-course-map">
                      {sheetsPrevia.cursos_pendentes.map((grupo) => (
                        <article key={grupo.curso}>
                          <div className="period-course-info">
                            <strong>{grupo.curso}</strong>
                            <span>
                              {grupo.quantidade} aluno(s) será(ão) resolvido(s)
                            </span>
                            <small>
                              {grupo.alunos
                                .slice(0, 3)
                                .map((a) => a.nome)
                                .join(" · ")}
                              {grupo.alunos.length > 3
                                ? ` · +${grupo.alunos.length - 3}`
                                : ""}
                            </small>
                          </div>
                          <div className="period-course-actions">
                            <AppSelect
                              value={mapeamentos[grupo.curso] || ""}
                              onChange={(valor) =>
                                setMapeamentos((atual) => ({
                                  ...atual,
                                  [grupo.curso]: valor,
                                }))
                              }
                              disabled={modoApresentacao || salvandoMapeamentos}
                              ariaLabel={`Mapear ${grupo.curso} para uma unidade`}
                              options={[
                                { value: "", label: "Selecionar unidade" },
                                { value: "FACE", label: "FACE" },
                                { value: "FEA", label: "FEA" },
                                { value: "FCH", label: "FCH" },
                                { value: "EAD", label: "EAD" },
                              ]}
                            />
                          </div>
                        </article>
                      ))}
                      <div className="period-course-map-save">
                        <div>
                          <span>MAPEAMENTO DE UNIDADES</span>
                          <strong>
                            {mapeamentosAlterados.length
                              ? `${mapeamentosAlterados.length} alteração(ões) pronta(s) para salvar`
                              : "Nenhuma alteração para salvar"}
                          </strong>
                          <small>
                            Ajuste todos os cursos acima e salve tudo de uma
                            vez.
                          </small>
                        </div>
                        {!modoApresentacao && (
                          <button
                            type="button"
                            onClick={salvarMapeamentos}
                            disabled={
                              !mapeamentosAlterados.length ||
                              salvandoMapeamentos
                            }
                          >
                            {salvandoMapeamentos
                              ? "Salvando unidades..."
                              : mapeamentosAlterados.length
                                ? `Salvar ${mapeamentosAlterados.length} alteração(ões)`
                                : "Salvar unidades"}
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="period-sheets-resolved">
                      ✓ Todas as unidades foram resolvidas.
                    </div>
                  )
                ) : (
                  <div className="period-preview-list" ref={listaPreviaRef}>
                    {(abaPrevia === "novos"
                      ? sheetsPrevia.detalhes.novos
                      : abaPrevia === "cadastros"
                        ? sheetsPrevia.detalhes.cadastros
                        : abaPrevia === "documentos"
                          ? sheetsPrevia.detalhes.documentos
                          : abaPrevia === "reativacoes"
                            ? sheetsPrevia.detalhes.reativacoes
                            : abaPrevia === "remocoes"
                              ? sheetsPrevia.detalhes.remocoes
                              : sheetsPrevia.detalhes.cancelamentos
                    ).map((item) => (
                      <article key={`${abaPrevia}-${item.ra}`}>
                        <div>
                          <strong>{item.nome}</strong>
                          <span>RA {item.ra}</span>
                        </div>
                        {"curso" in item ? (
                          <p>{`${item.curso} · ${item.unidade || "Unidade pendente"}`}</p>
                        ) : "detalhe" in item ? (
                          <div className="period-preview-change">
                            {item.detalhe.split("\n").map((linha) => {
                              const [campo, alteracao] = linha.split(": ");

                              return (
                                <div key={linha}>
                                  <strong>{campo}</strong>
                                  <span>{alteracao}</span>
                                </div>
                              );
                            })}
                          </div>
                        ) : abaPrevia === "reativacoes" ? (
                          <div className="period-preview-change">
                            <div>
                              <strong>Reativação</strong>
                              <span>
                                Cancelado → Ativo · Unidade {item.unidade}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <p>{`Unidade ${item.unidade}`}</p>
                        )}
                      </article>
                    ))}
                    {((abaPrevia === "novos" &&
                      !sheetsPrevia.detalhes.novos.length) ||
                      (abaPrevia === "cadastros" &&
                        !sheetsPrevia.detalhes.cadastros.length) ||
                      (abaPrevia === "documentos" &&
                        !sheetsPrevia.detalhes.documentos.length) ||
                      (abaPrevia === "cancelamentos" &&
                        !sheetsPrevia.detalhes.cancelamentos.length)) && (
                      <div className="period-sheets-resolved">
                        Nenhuma divergência nesta categoria.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {sheetsPrevia.unidades_nao_resolvidas > 0 && (
              <div className="period-sheets-warning">
                <strong>Atenção:</strong>{" "}
                {sheetsPrevia.cursos_nao_mapeados ??
                  sheetsPrevia.cursos_pendentes.length}{" "}
                curso(s) precisam ser mapeados, afetando{" "}
                {sheetsPrevia.alunos_sem_unidade ??
                  sheetsPrevia.unidades_nao_resolvidas}{" "}
                aluno(s). Clique em <strong>Cursos a mapear</strong> antes da
                sincronização.
              </div>
            )}
            {sheetsPrevia.unidades_nao_resolvidas === 0 && (
              <>
                <div
                  className={`period-sheets-ready ${
                    totalOperacoesPrevia === 0 ? "is-synced" : ""
                  }`}
                >
                  {totalOperacoesPrevia === 0 ? (
                    <>
                      <strong>✓ Tudo sincronizado.</strong> Nenhuma divergência
                      encontrada.
                    </>
                  ) : (
                    <>
                      <strong>✓ Unidades resolvidas.</strong> A prévia está
                      pronta para sincronização.
                    </>
                  )}
                </div>
                <div
                  className={`period-sheets-sync-bar ${
                    modoApresentacao
                      ? "is-presentation"
                      : totalOperacoesPrevia === 0
                        ? "is-synced"
                        : ""
                  }`}
                >
                  <div>
                    <span>
                      {modoApresentacao
                        ? "PRÉVIA CONCLUÍDA"
                        : totalOperacoesPrevia === 0
                          ? "TUDO SINCRONIZADO"
                          : "APLICAR ALTERAÇÕES"}
                    </span>
                    <strong>
                      {modoApresentacao
                        ? totalOperacoesPrevia === 0
                          ? "✓ Nenhuma divergência encontrada"
                          : totalOperacoesPrevia === 1
                            ? "✓ 1 divergência encontrada"
                            : `✓ ${totalOperacoesPrevia} divergências encontradas`
                        : totalOperacoesPrevia === 0
                          ? "✓ Nenhuma alteração encontrada"
                          : `${totalOperacoesPrevia} operação(ões) pronta(s)`}
                    </strong>
                    <small>
                      {modoApresentacao
                        ? "Consulta somente leitura. Nenhuma alteração será aplicada."
                        : totalOperacoesPrevia === 0
                          ? "O Google Sheets e o sistema estão sem divergências."
                          : "A planilha será lida novamente no momento da sincronização."}
                    </small>
                  </div>
                  {!modoApresentacao && (
                    <button
                      type="button"
                      onClick={() => {
                        setResultadoSync(null);
                        setModalSucessoSync(false);
                        setModalSincronizar(true);
                      }}
                      disabled={
                        sincronizandoSheets || totalOperacoesPrevia === 0
                      }
                    >
                      {totalOperacoesPrevia === 0
                        ? "Sem alterações"
                        : "Sincronizar agora"}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </section>

      {erro && <div className="period-error">{erro}</div>}

      <section className="period-section">
        <div className="period-section-header">
          <div>
            <span>OPERAÇÃO</span>
            <h2>Períodos ativos</h2>
          </div>
          <strong>{ativos.length}</strong>
        </div>
        <div className="period-list">{ativos.map(renderPeriodo)}</div>
      </section>

      <section
        className={`period-section archived ${arquivados.length === 0 ? "empty" : ""}`}
      >
        <div className="period-section-header">
          <div>
            <span>HISTÓRICO</span>
            <h2>Períodos arquivados</h2>
          </div>
          <strong>{arquivados.length}</strong>
        </div>
        {arquivados.length ? (
          <div className="period-list">{arquivados.map(renderPeriodo)}</div>
        ) : (
          <div className="period-empty">
            <div className="period-empty-icon" aria-hidden="true">
              ◷
            </div>
            <strong>Nenhum período arquivado</strong>
            <p>
              Quando um período for arquivado, ele continuará disponível aqui
              para consulta, edição ou reativação.
            </p>
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
            {resultadoSync.novos} novo(s) ·{" "}
            {resultadoSync.alteracoes_cadastrais} cadastro(s) ·{" "}
            {resultadoSync.documentos_alterados} documento(s) ·{" "}
            {resultadoSync.cancelamentos} cancelamento(s) ·{" "}
            {resultadoSync.reativacoes} reativação(ões)
          </p>
          <button type="button" onClick={() => setResultadoSync(null)}>
            ×
          </button>
        </div>
      )}

      {modalSucessoSync && resultadoSync && (
        <div className="modal-overlay">
          <div
            className="modal-importacao-sucesso sheets-sync-success-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sheets-sync-success-title"
          >
            <div className="importacao-sucesso-conteudo">
              <div className="importacao-sucesso-icone">✓</div>

              <span className="modal-eyebrow">SINCRONIZAÇÃO CONCLUÍDA</span>
              <h2 id="sheets-sync-success-title">
                Google Planilhas sincronizado com sucesso
              </h2>

              <p>
                A sincronização do período{" "}
                <strong>{periodoAtual?.codigo ?? "—"}</strong> foi concluída.
              </p>

              <div className="importacao-sucesso-resumo sheets-sync-success-resumo">
                <div>
                  <strong>{resultadoSync.novos}</strong>
                  <span>novos</span>
                </div>

                <div>
                  <strong>{resultadoSync.alteracoes_cadastrais}</strong>
                  <span>cadastros</span>
                </div>

                <div>
                  <strong>{resultadoSync.documentos_alterados}</strong>
                  <span>documentos</span>
                </div>

                <div>
                  <strong>{resultadoSync.cancelamentos}</strong>
                  <span>cancelamentos</span>
                </div>

                <div>
                  <strong>{resultadoSync.reativacoes}</strong>
                  <span>reativações</span>
                </div>

                <div>
                  <strong>{resultadoSync.remocoes}</strong>
                  <span>remoções</span>
                </div>
              </div>

              <small className="sheets-sync-success-total">
                {resultadoSync.total_operacoes} operação(ões) aplicada(s) ao
                sistema
              </small>
            </div>

            <div className="modal-acoes importacao-sucesso-acoes">
              <button
                type="button"
                className="botao-cadastrar"
                onClick={() => setModalSucessoSync(false)}
                autoFocus
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {modalSincronizar && sheetsPrevia && (
        <div className="modal-overlay">
          <section
            className="period-sync-confirm-modal"
            role="dialog"
            aria-modal="true"
          >
            <header>
              <span>SINCRONIZAÇÃO</span>
              <h2>Aplicar Google Sheets?</h2>
              <p>
                As diferenças da prévia serão gravadas no período{" "}
                <strong>{periodoAtual?.codigo}</strong>. Antes de escrever, o
                servidor lerá a planilha novamente.
              </p>
            </header>

            <div className="period-sync-confirm-grid">
              <div className="period-sync-confirm-metric">
                <strong>{sheetsPrevia.novos}</strong>
                <span>Novos</span>
              </div>

              <div className="period-sync-confirm-metric">
                <strong>{sheetsPrevia.alteracoes_cadastrais}</strong>
                <span>Cadastros</span>
              </div>

              <div className="period-sync-confirm-metric">
                <strong>{sheetsPrevia.documentos_alterados}</strong>
                <span>Documentos</span>
              </div>

              <div className="period-sync-confirm-metric">
                <strong>{sheetsPrevia.prontos_para_cancelar}</strong>
                <span>Cancelamentos</span>
              </div>

              <div className="period-sync-confirm-metric">
                <strong>{sheetsPrevia.prontos_para_reativar}</strong>
                <span>Reativações</span>
              </div>

              <div className="period-sync-confirm-metric">
                <strong>{sheetsPrevia.prontos_para_remover}</strong>
                <span>Remoções</span>
              </div>
            </div>

            <div className="period-sync-confirm-details">
              <button
                type="button"
                className="period-sync-confirm-details-toggle"
                onClick={() => setMostrarAlteracoesSync((atual) => !atual)}
              >
                {mostrarAlteracoesSync
                  ? "Ocultar alterações"
                  : "Ver alterações"}
              </button>

              {mostrarAlteracoesSync && (
                <div className="period-sync-confirm-details-content">
                  {sheetsPrevia.detalhes.novos.map((item) => (
                    <article key={`novo-${item.ra}`}>
                      <div>
                        <strong>{item.nome}</strong>
                        <span>RA {item.ra}</span>
                      </div>

                      <div className="period-preview-change">
                        <div>
                          <strong>Novo aluno</strong>
                          <span>
                            {item.curso} · {item.unidade || "Unidade pendente"}
                          </span>
                        </div>
                      </div>
                    </article>
                  ))}
                  {sheetsPrevia.detalhes.cadastros.map((item) => (
                    <article key={`cadastro-${item.ra}`}>
                      <div>
                        <strong>{item.nome}</strong>
                        <small>RA {item.ra}</small>
                      </div>

                      <div className="period-preview-change">
                        {item.detalhe.split("\n").map((linha) => {
                          const [campo, alteracao] = linha.split(": ");

                          return (
                            <div key={linha}>
                              <strong>{campo}</strong>
                              <span>{alteracao}</span>
                            </div>
                          );
                        })}
                      </div>
                    </article>
                  ))}

                  {sheetsPrevia.detalhes.documentos.map((item) => (
                    <article key={`documento-${item.ra}`}>
                      <div>
                        <strong>{item.nome}</strong>
                        <small>RA {item.ra}</small>
                      </div>

                      <div className="period-preview-change period-preview-documents">
                        {item.detalhe.split("\n").map((linha) => {
                          const [campo, alteracao = ""] = linha.split(": ");

                          const [origem = "", destino = ""] = alteracao
                            .split("→")
                            .map((valor) => valor.trim());

                          const statusClass = (valor: string) =>
                            valor.toLowerCase() === "entregue"
                              ? "is-delivered"
                              : "is-pending";

                          const statusSymbol = (valor: string) =>
                            valor.toLowerCase() === "entregue" ? "✓" : "✕";

                          return (
                            <div
                              className="period-preview-document-change"
                              key={linha}
                            >
                              <strong>{campo}</strong>

                              <span className="period-preview-document-status">
                                <span
                                  className={`period-preview-status-icon ${statusClass(origem)}`}
                                  title={origem}
                                  aria-label={origem}
                                >
                                  {statusSymbol(origem)}
                                </span>

                                <span className="period-preview-status-arrow">
                                  →
                                </span>

                                <span
                                  className={`period-preview-status-icon ${statusClass(destino)}`}
                                  title={destino}
                                  aria-label={destino}
                                >
                                  {statusSymbol(destino)}
                                </span>
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </article>
                  ))}
                  {sheetsPrevia.detalhes.cancelamentos.map((item) => (
                    <article key={`cancelamento-${item.ra}`}>
                      <div>
                        <strong>{item.nome}</strong>
                        <span>RA {item.ra}</span>
                      </div>

                      <div className="period-preview-change">
                        <div>
                          <strong>Cancelamento</strong>
                          <span>
                            Ativo → Cancelado · Unidade {item.unidade}
                          </span>
                        </div>
                      </div>
                    </article>
                  ))}

                  {sheetsPrevia.detalhes.reativacoes.map((item) => (
                    <article key={`reativacao-${item.ra}`}>
                      <div>
                        <strong>{item.nome}</strong>
                        <small>RA {item.ra}</small>
                      </div>

                      <div className="period-preview-change">
                        <div>
                          <strong>Reativação</strong>
                          <span>
                            Cancelado → Ativo · Unidade {item.unidade}
                          </span>
                        </div>
                      </div>
                    </article>
                  ))}
                  {sheetsPrevia.detalhes.remocoes.map((item) => (
                    <article key={`remocao-${item.ra}`}>
                      <div>
                        <strong>{item.nome}</strong>
                        <small>RA {item.ra}</small>
                      </div>

                      <div className="period-preview-change">
                        <div>
                          <strong>Remoção</strong>
                          <span>
                            Ausente da planilha · Unidade {item.unidade}
                          </span>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>

            <footer>
              <div className="period-sync-confirm-note">
                <strong>Importante:</strong> esta operação altera o banco do
                sistema e será registrada no LOG.
              </div>

              <div className="period-sync-confirm-buttons">
                <button
                  type="button"
                  className="period-sync-back-button"
                  onClick={() => setModalSincronizar(false)}
                  disabled={sincronizandoSheets}
                >
                  Voltar
                </button>

                <button
                  type="button"
                  onClick={sincronizarSheets}
                  disabled={sincronizandoSheets}
                >
                  {sincronizandoSheets
                    ? "Sincronizando..."
                    : "Confirmar sincronização"}
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}

      {confirmacao && (
        <div
          className="modal-overlay"
          onMouseDown={() => !processando && setConfirmacao(null)}
        >
          <div
            className="period-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="period-confirm-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="modal-cabecalho">
              <div>
                <span className="modal-eyebrow">PERÍODOS LETIVOS</span>
                <h2 id="period-confirm-title">
                  {confirmacao.status === "ARQUIVADO"
                    ? "Arquivar período?"
                    : "Reativar período?"}
                </h2>
                <p>
                  {confirmacao.status === "ARQUIVADO" ? (
                    <>
                      O período <strong>{confirmacao.codigo}</strong> sairá da
                      operação diária, mas continuará acessível e poderá ser
                      editado quando necessário.
                    </>
                  ) : (
                    <>
                      O período <strong>{confirmacao.codigo}</strong> voltará
                      para a lista de períodos ativos e poderá ser usado
                      normalmente.
                    </>
                  )}
                </p>
              </div>
              <button
                type="button"
                className="modal-fechar"
                onClick={() => setConfirmacao(null)}
                disabled={processando}
              >
                ×
              </button>
            </div>
            <div className="modal-acoes">
              <button
                type="button"
                className="botao-cancelar"
                onClick={() => setConfirmacao(null)}
                disabled={processando}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={
                  confirmacao.status === "ARQUIVADO"
                    ? "period-confirm-danger"
                    : "botao-cadastrar"
                }
                onClick={() =>
                  alterarStatus(confirmacao.id, confirmacao.status)
                }
                disabled={processando}
              >
                {processando
                  ? "Processando..."
                  : confirmacao.status === "ARQUIVADO"
                    ? "Arquivar período"
                    : "Reativar período"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default Periodos;
