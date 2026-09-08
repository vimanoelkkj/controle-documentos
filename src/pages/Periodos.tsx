import { useEffect, useMemo, useState } from "react";
import MockupStyle from "../components/MockupStyle";
import css from "../mockups/periodos.css?raw";
import previewAccordionCss from "../mockups/periodos-preview-accordion.css?raw";
import { usePeriodo } from "../contexts/periodo";
import { useAuth } from "../contexts/auth";
import { useGoogleSheetsPeriodo } from "./periodos/hooks/useGoogleSheetsPeriodo";
import { useGerenciamentoPeriodos } from "./periodos/hooks/useGerenciamentoPeriodos";

function separarAlteracao(linha: string) {
  const separador = linha.indexOf(": ");
  const campo = separador >= 0 ? linha.slice(0, separador) : "Documento";
  const valor = separador >= 0 ? linha.slice(separador + 2) : linha;
  const seta = valor.indexOf(" → ");
  return {
    campo,
    antes: seta >= 0 ? valor.slice(0, seta) : valor,
    depois: seta >= 0 ? valor.slice(seta + 3) : "",
  };
}

function tomStatus(valor: string) {
  const normalizado = valor.trim().toLocaleLowerCase("pt-BR");
  if (["entregue", "ativo", "regular"].includes(normalizado)) return "is-good";
  if (
    ["pendente", "não entregue", "nao entregue", "parcial"].includes(
      normalizado,
    )
  )
    return "is-pending";
  if (
    [
      "cancelado",
      "cancelada",
      "removido",
      "removida",
      "crítico",
      "critico",
    ].includes(normalizado)
  )
    return "is-danger";
  return "is-neutral";
}

export default function Periodos() {
  const { modoApresentacao } = useAuth();
  const { periodos, periodoAtual, selecionarPeriodo, recarregarPeriodos } =
    usePeriodo();
  const gp = useGerenciamentoPeriodos({
    recarregarPeriodos,
    selecionarPeriodo,
  });
  const gs = useGoogleSheetsPeriodo({ periodoAtual, recarregarPeriodos });
  const [detalhes, setDetalhes] = useState(false);
  const [detalhesAbertos, setDetalhesAbertos] = useState<Set<string>>(
    () => new Set(),
  );
  const ativos = useMemo(
    () => periodos.filter((p) => p.status === "ATIVO"),
    [periodos],
  );
  const arquivados = useMemo(
    () => periodos.filter((p) => p.status === "ARQUIVADO"),
    [periodos],
  );
  const previa = gs.sheetsPrevia;
  useEffect(() => {
    if (!detalhes || !previa) {
      if (!detalhes) setDetalhesAbertos(new Set());
      return;
    }
    const documentos = previa.detalhes.documentos.slice(0, 20);
    setDetalhesAbertos(
      documentos.length ? new Set([`${documentos[0].ra}-0`]) : new Set(),
    );
  }, [detalhes, previa]);
  function alternarAlunoDetalhe(chave: string) {
    setDetalhesAbertos((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(chave)) proximo.delete(chave);
      else proximo.add(chave);
      return proximo;
    });
  }
  function configField(key: keyof typeof gs.sheetsConfig, label: string) {
    return (
      <div className="cfg-field">
        <div className="cfg-label">{label}</div>
        <div
          className="cfg-value"
          contentEditable={!modoApresentacao}
          suppressContentEditableWarning
          onBlur={(e) =>
            gs.setSheetsConfig((c) => ({
              ...c,
              [key]: e.currentTarget.textContent || "",
            }))
          }
        >
          {gs.sheetsConfig[key]}
        </div>
      </div>
    );
  }
  function statusModal() {
    const c = gp.confirmacao;
    if (!c) return null;
    const arquivar = c.status === "ATIVO";
    return (
      <div className="modal-overlay open">
        <div className="modal-card modal-card-sm">
          <button
            className="modal-close"
            onClick={() => gp.setConfirmacao(null)}
          >
            ✕
          </button>
          <div className="modal-eyebrow">Períodos letivos</div>
          <h2 className="modal-title compact">
            {arquivar ? "Arquivar período?" : "Restaurar período?"}
          </h2>
          <p className="modal-sub">
            O período <b>{c.codigo}</b>{" "}
            {arquivar
              ? "sairá da operação diária, mas continuará acessível e poderá ser editado quando necessário."
              : "voltará para a lista de períodos ativos e poderá ser usado normalmente."}
          </p>
          <div className="modal-footer">
            <a onClick={() => gp.setConfirmacao(null)}>Cancelar</a>
            <a
              className="modal-save"
              onClick={() =>
                void gp.alterarStatus(c.id, arquivar ? "ARQUIVADO" : "ATIVO")
              }
            >
              {gp.processando
                ? "Processando..."
                : arquivar
                  ? "Arquivar período"
                  : "Restaurar período"}
            </a>
          </div>
        </div>
      </div>
    );
  }
  return (
    <>
      <MockupStyle css={css} />
      <MockupStyle css={previewAccordionCss} />
      <div className="page-head">
        <h1>Períodos letivos</h1>
        <p>
          Crie novos ciclos, alterne o contexto do sistema e arquive períodos
          antigos sem perder o acesso aos dados.
        </p>
      </div>
      {!modoApresentacao && (
        <div
          className="period-section"
          style={{ borderTop: "none", paddingTop: 0 }}
        >
          <div className="col-head">Novo período</div>
          <div className="new-period-row">
            <div className="np-info">
              <h3>Criar período letivo</h3>
              <p>
                Use o padrão <b>AAAA-1</b> ou <b>AAAA-2</b>.
              </p>
            </div>
            <div className="np-action">
              <div className="np-field">
                <input
                  className={gp.erroCriacao ? "error" : ""}
                  value={gp.novoCodigo}
                  onChange={(e) => {
                    gp.setNovoCodigo(e.target.value);
                    gp.limparErroCriacao();
                  }}
                  placeholder="2027-1"
                />
                <span className={`np-error${gp.erroCriacao ? " show" : ""}`}>
                  ⚠{" "}
                  {gp.erroCriacao ||
                    "Use o formato AAAA-1 ou AAAA-2. Ex.: 2027-1."}
                </span>
              </div>
              <a className="btn-create" onClick={() => void gp.criarPeriodo()}>
                {gp.processando ? "Criando..." : "+ Criar período"}
              </a>
            </div>
          </div>
        </div>
      )}
      <div className="period-section">
        <div className="col-head">Integração</div>
        <div className="int-config-head">
          <div>
            <h3>Google Sheets</h3>
            <p>
              Leitura segura da planilha vinculada ao período{" "}
              <b>{periodoAtual?.codigo}</b>. A prévia não altera o sistema nem a
              planilha.
            </p>
          </div>
          <div className="int-badge-group">
            <span className="int-badge">
              {gs.sheetsSalvo
                ? "Configurado"
                : gs.sheetsStatus === "carregando"
                  ? "Verificando"
                  : "Não configurado"}
            </span>
            {gs.sheetsTitulo && (
              <div className="int-badge-sub show">
                <div className="int-badge-label">Planilha vinculada</div>
                <div className="int-badge-value">{gs.sheetsTitulo}</div>
              </div>
            )}
          </div>
        </div>
        {configField("spreadsheet_id", "Link ou ID da planilha")}
        <div className="cfg-grid">
          {configField("aba_base_face_fea", "Base FACE / FEA")}
          {configField("aba_base_fch_ead", "Base FCH / EAD")}
          {configField("aba_docs_face_fea", "Documentos FACE / FEA")}
          {configField("aba_docs_fch_ead", "Documentos FCH / EAD")}
          {configField("aba_cancelados_face_fea", "Cancelados FACE / FEA")}
          {configField("aba_cancelados_fch_ead", "Cancelados FCH / EAD")}
        </div>
        {!modoApresentacao && (
          <div className="int-actions">
            <a onClick={() => void gs.salvarSheets()}>
              {gs.sheetsCarregando ? "Salvando..." : "Salvar configuração"}
            </a>
            <a className="primary" onClick={() => void gs.gerarPreviaSheets()}>
              {gs.sheetsCarregando
                ? "Lendo planilha..."
                : "Ler planilha e gerar prévia"}
            </a>
          </div>
        )}
        {gs.sheetsErro && (
          <p style={{ color: "var(--terracotta)", fontSize: ".8rem" }}>
            {gs.sheetsErro}
          </p>
        )}
        {previa && (
          <div className="preview-block show">
            <div className="preview-head">
              <h3>
                {previa.encontrados.toLocaleString("pt-BR")} alunos encontrados
              </h3>
              <span className="preview-badge">✓ Nada alterado</span>
            </div>
            <div className="preview-stats">
              <div className="pstat">
                <strong>{previa.novos}</strong>
                <span>Novos alunos</span>
              </div>
              <div className="pstat">
                <strong>{previa.alteracoes_cadastrais}</strong>
                <span>Cadastros diferentes</span>
              </div>
              <div className={`pstat${detalhes ? " active" : ""}`}>
                <strong>{previa.documentos_alterados}</strong>
                <span>Documentos diferentes</span>
                {previa.documentos_alterados > 0 && (
                  <a onClick={() => setDetalhes((v) => !v)}>
                    {detalhes ? "Ocultar detalhes" : "Ver detalhes"}
                  </a>
                )}
              </div>
              <div className="pstat">
                <strong>{previa.prontos_para_cancelar}</strong>
                <span>Cancelamentos</span>
              </div>
              <div className="pstat">
                <strong>{previa.prontos_para_reativar}</strong>
                <span>Reativações</span>
              </div>
              <div className="pstat">
                <strong>{previa.prontos_para_remover}</strong>
                <span>Remoções</span>
              </div>
              <div className="pstat">
                <strong>{previa.cursos_nao_mapeados}</strong>
                <span>Cursos a mapear</span>
              </div>
            </div>
            {detalhes && (
              <div className="details-panel show">
                <button
                  className="details-panel-close"
                  onClick={() => setDetalhes(false)}
                >
                  ✕
                </button>
                <div className="col-head" style={{ marginBottom: "0.3rem" }}>
                  Conferência
                </div>
                <h4>Detalhes da prévia</h4>
                {previa.detalhes.documentos.slice(0, 20).map((d, i) => {
                  const chave = `${d.ra}-${i}`;
                  const alteracoes = d.detalhe
                    .split("\n")
                    .map((linha) => linha.trim())
                    .filter(Boolean)
                    .map(separarAlteracao);
                  const aberto = detalhesAbertos.has(chave);
                  return (
                    <div
                      className={`details-row${aberto ? " open" : ""}`}
                      key={chave}
                    >
                      <button
                        type="button"
                        className="details-row-toggle"
                        aria-expanded={aberto}
                        onClick={() => alternarAlunoDetalhe(chave)}
                      >
                        <span className="details-chevron" aria-hidden="true" />
                        <span className="dr-student">
                          <strong>{d.nome}</strong>
                          <span>RA {d.ra}</span>
                        </span>
                        <span className="details-change-count">
                          {alteracoes.length}{" "}
                          {alteracoes.length === 1 ? "alteração" : "alterações"}
                        </span>
                      </button>
                      {aberto && (
                        <div className="details-row-body">
                          <div className="dr-changes">
                            {alteracoes.map((alteracao, j) => (
                              <div
                                className="dr-change"
                                key={`${chave}-${alteracao.campo}-${j}`}
                              >
                                <div className="dc-label">
                                  {alteracao.campo}
                                </div>
                                <div className="dc-value">
                                  <span
                                    className={`dc-status ${tomStatus(alteracao.antes)}`}
                                  >
                                    {alteracao.antes}
                                  </span>
                                  {alteracao.depois && (
                                    <>
                                      <span
                                        className="arrow"
                                        aria-hidden="true"
                                      >
                                        →
                                      </span>
                                      <span
                                        className={`dc-status ${tomStatus(alteracao.depois)}`}
                                      >
                                        {alteracao.depois}
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <div className="preview-banner">
              {previa.unidades_nao_resolvidas === 0
                ? "✓ Unidades resolvidas. A prévia está pronta para sincronização."
                : `⚠ ${previa.unidades_nao_resolvidas} unidade(s) ainda precisam ser resolvidas.`}
            </div>
            <div className="apply-row">
              <div className="apply-info">
                <div className="al-label">Aplicar alterações</div>
                <strong>
                  {gs.totalOperacoesPrevia} operação(ões) pronta(s)
                </strong>
                <p>
                  A planilha será lida novamente no momento da sincronização.
                </p>
              </div>
              <button
                className="btn-sync"
                disabled={
                  previa.unidades_nao_resolvidas > 0 || gs.sincronizandoSheets
                }
                onClick={() => gs.setModalSincronizar(true)}
              >
                Sincronizar agora
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="period-section">
        <div className="section-head-row">
          <div className="col-head" style={{ marginBottom: 0 }}>
            Operação
          </div>
        </div>
        <div className="section-head-row">
          <h3 style={{ margin: 0, fontSize: "1.02rem", fontWeight: 700 }}>
            Períodos ativos
          </h3>
          <span className="section-count">{ativos.length}</span>
        </div>
        <ul className="period-row-list">
          {ativos.map((p) => (
            <li className="period-row" key={p.id}>
              <span className="pr-badge active">Ativo</span>
              <span className="pr-name">{p.codigo}</span>
              <span className="pr-meta">
                {p.total_alunos?.toLocaleString?.("pt-BR") || 0} alunos
                vinculados
              </span>
              <div className="pr-actions">
                <a
                  className={
                    p.codigo === periodoAtual?.codigo ? "disabled" : ""
                  }
                  onClick={() => selecionarPeriodo(p.codigo)}
                >
                  Abrir período
                </a>
                {!modoApresentacao && (
                  <a
                    className="danger"
                    onClick={() =>
                      gp.setConfirmacao({
                        id: p.id,
                        codigo: p.codigo,
                        status: "ATIVO",
                      })
                    }
                  >
                    Arquivar
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div className="period-section">
        <div className="section-head-row">
          <h3 style={{ margin: 0, fontSize: "1.02rem", fontWeight: 700 }}>
            Períodos arquivados
          </h3>
          <span className="section-count">{arquivados.length}</span>
        </div>
        <div className="col-head" style={{ margin: "-0.9rem 0 0.9rem" }}>
          Histórico
        </div>
        <ul className="period-row-list">
          {arquivados.map((p) => (
            <li className="period-row" key={p.id}>
              <span className="pr-badge archived">Arquivado</span>
              <span className="pr-name">{p.codigo}</span>
              <span className="pr-meta">
                {p.total_alunos?.toLocaleString?.("pt-BR") || 0} alunos
                vinculados
              </span>
              <div className="pr-actions">
                <a onClick={() => selecionarPeriodo(p.codigo)}>Abrir período</a>
                {!modoApresentacao && (
                  <a
                    className="restore"
                    onClick={() =>
                      gp.setConfirmacao({
                        id: p.id,
                        codigo: p.codigo,
                        status: "ARQUIVADO",
                      })
                    }
                  >
                    Restaurar
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
      {statusModal()}
      {gs.modalSincronizar && previa && (
        <div className="modal-overlay open">
          <div className="modal-card modal-card-wide">
            <button
              className="modal-close"
              onClick={() => gs.setModalSincronizar(false)}
            >
              ✕
            </button>
            <div className="modal-eyebrow">Sincronização</div>
            <h2 className="modal-title compact">Sincronizar agora?</h2>
            <p className="modal-sub">
              Isso vai aplicar as alterações no período{" "}
              <b>{periodoAtual?.codigo}</b>. Antes de escrever, o servidor lerá
              a planilha novamente.
            </p>
            <div className="modal-stats">
              <div className="mstat">
                <strong>{previa.novos}</strong>
                <span>Novos</span>
              </div>
              <div className="mstat">
                <strong>{previa.alteracoes_cadastrais}</strong>
                <span>Cadastros</span>
              </div>
              <div className="mstat">
                <strong>{previa.documentos_alterados}</strong>
                <span>Documentos</span>
              </div>
              <div className="mstat">
                <strong>{previa.prontos_para_cancelar}</strong>
                <span>Cancelamentos</span>
              </div>
              <div className="mstat">
                <strong>{previa.prontos_para_reativar}</strong>
                <span>Reativações</span>
              </div>
              <div className="mstat">
                <strong>{previa.prontos_para_remover}</strong>
                <span>Remoções</span>
              </div>
            </div>
            <div className="modal-warn-banner">
              ⚠ Essa ação vai alterar o banco do sistema e será registrada no
              LOG.
            </div>
            <div className="modal-footer">
              <a onClick={() => gs.setModalSincronizar(false)}>Voltar</a>
              <a
                className="modal-save teal"
                onClick={() => void gs.sincronizarSheets()}
              >
                {gs.sincronizandoSheets
                  ? "Sincronizando..."
                  : "Confirmar sincronização"}
              </a>
            </div>
          </div>
        </div>
      )}
      {gs.modalSucessoSync && gs.resultadoSync && (
        <div className="modal-overlay open">
          <div className="modal-card modal-card-wide modal-centered">
            <button
              className="modal-close"
              onClick={() => gs.setModalSucessoSync(false)}
            >
              ✕
            </button>
            <div className="modal-icon-teal">✓</div>
            <div className="modal-eyebrow teal">Sincronização concluída</div>
            <h2 className="modal-title compact">
              Google Planilhas sincronizado com sucesso
            </h2>
            <p className="modal-sub">
              A sincronização do período <b>{periodoAtual?.codigo}</b> foi
              concluída.
            </p>
            <div className="modal-stats">
              <div className="mstat">
                <strong>{gs.resultadoSync.novos}</strong>
                <span>Novos</span>
              </div>
              <div className="mstat">
                <strong>{gs.resultadoSync.alteracoes_cadastrais}</strong>
                <span>Cadastros</span>
              </div>
              <div className="mstat">
                <strong>{gs.resultadoSync.documentos_alterados}</strong>
                <span>Documentos</span>
              </div>
              <div className="mstat">
                <strong>{gs.resultadoSync.cancelamentos}</strong>
                <span>Cancelamentos</span>
              </div>
              <div className="mstat">
                <strong>{gs.resultadoSync.reativacoes}</strong>
                <span>Reativações</span>
              </div>
              <div className="mstat">
                <strong>{gs.resultadoSync.remocoes}</strong>
                <span>Remoções</span>
              </div>
            </div>
            <p className="modal-op-caption">
              {gs.resultadoSync.total_operacoes} operação(ões) aplicada(s) ao
              sistema.
            </p>
            <div className="modal-footer centered">
              <a
                className="modal-save teal"
                onClick={() => gs.setModalSucessoSync(false)}
              >
                Fechar
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
