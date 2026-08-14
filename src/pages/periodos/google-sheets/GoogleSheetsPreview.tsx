import type { RefObject } from "react";
import type { AbaPrevia, SheetsPrevia } from "../hooks/useGoogleSheetsPeriodo";
import { GoogleSheetsCourseMap } from "./GoogleSheetsCourseMap";

type Props = {
  previa: SheetsPrevia;
  abaPrevia: AbaPrevia | null;
  setAbaPrevia: (aba: AbaPrevia | null) => void;
  listaPreviaRef: RefObject<HTMLDivElement | null>;
  mapeamentos: Record<string, string>;
  setMapeamentos: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  mapeamentosAlterados: Array<[string, string]>;
  salvandoMapeamentos: boolean;
  modoApresentacao: boolean;
  salvarMapeamentos: () => Promise<void>;
  totalOperacoesPrevia: number;
  sincronizandoSheets: boolean;
  abrirSincronizacao: () => void;
};

export function GoogleSheetsPreview({
  previa,
  abaPrevia,
  setAbaPrevia,
  listaPreviaRef,
  mapeamentos,
  setMapeamentos,
  mapeamentosAlterados,
  salvandoMapeamentos,
  modoApresentacao,
  salvarMapeamentos,
  totalOperacoesPrevia,
  sincronizandoSheets,
  abrirSincronizacao,
}: Props) {
  const metricas: Array<[AbaPrevia, number, string]> = [
    ["novos", previa.novos, "Novos alunos"],
    ["cadastros", previa.alteracoes_cadastrais, "Cadastros diferentes"],
    ["documentos", previa.documentos_alterados, "Documentos diferentes"],
    ["cancelamentos", previa.prontos_para_cancelar, "Cancelamentos"],
    ["reativacoes", previa.prontos_para_reativar, "Reativações"],
    ["remocoes", previa.prontos_para_remover, "Remoções"],
    [
      "unidades",
      previa.cursos_nao_mapeados ?? previa.cursos_pendentes.length,
      "Cursos a mapear",
    ],
  ];

  const itens =
    abaPrevia === "novos"
      ? previa.detalhes.novos
      : abaPrevia === "cadastros"
        ? previa.detalhes.cadastros
        : abaPrevia === "documentos"
          ? previa.detalhes.documentos
          : abaPrevia === "reativacoes"
            ? previa.detalhes.reativacoes
            : abaPrevia === "remocoes"
              ? previa.detalhes.remocoes
              : previa.detalhes.cancelamentos;

  return (
    <div className="period-sheets-preview">
      <div className="period-sheets-preview-title">
        <div>
          <span>PRÉVIA · SOMENTE LEITURA</span>
          <h3>{previa.encontrados} alunos encontrados</h3>
        </div>
        <strong>✓ NADA ALTERADO</strong>
      </div>

      <div className="period-sheets-metrics">
        {metricas.map(([aba, valor, rotulo]) => {
          const temDetalhes =
            aba === "documentos" ? previa.documentos_alterados > 0 : valor > 0;
          return (
            <button
              type="button"
              key={aba}
              className={[
                aba === "unidades" && valor ? "warning" : "",
                abaPrevia === aba ? "active" : "",
                temDetalhes ? "has-details" : "no-details",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => temDetalhes && setAbaPrevia(aba)}
            >
              <strong>{valor}</strong>
              <span>{rotulo}</span>
              {temDetalhes && <small>Ver detalhes</small>}
            </button>
          );
        })}
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
            <GoogleSheetsCourseMap
              cursosPendentes={previa.cursos_pendentes}
              mapeamentos={mapeamentos}
              setMapeamentos={setMapeamentos}
              mapeamentosAlterados={mapeamentosAlterados}
              salvandoMapeamentos={salvandoMapeamentos}
              modoApresentacao={modoApresentacao}
              salvarMapeamentos={salvarMapeamentos}
            />
          ) : (
            <div className="period-preview-list" ref={listaPreviaRef}>
              {itens.map((item) => (
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
                        <span>Cancelado → Ativo · Unidade {item.unidade}</span>
                      </div>
                    </div>
                  ) : (
                    <p>{`Unidade ${item.unidade}`}</p>
                  )}
                </article>
              ))}
              {!itens.length && (
                <div className="period-sheets-resolved">
                  Nenhuma divergência nesta categoria.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {previa.unidades_nao_resolvidas > 0 && (
        <div className="period-sheets-warning">
          <strong>Atenção:</strong>{" "}
          {previa.cursos_nao_mapeados ?? previa.cursos_pendentes.length}{" "}
          curso(s) precisam ser mapeados, afetando{" "}
          {previa.alunos_sem_unidade ?? previa.unidades_nao_resolvidas}{" "}
          aluno(s). Clique em <strong>Cursos a mapear</strong> antes da
          sincronização.
        </div>
      )}

      {previa.unidades_nao_resolvidas === 0 && (
        <>
          <div
            className={`period-sheets-ready ${totalOperacoesPrevia === 0 ? "is-synced" : ""}`}
          >
            {totalOperacoesPrevia === 0 ? (
              <>
                <strong>✓ Tudo sincronizado.</strong> Nenhuma divergência
                encontrada.
              </>
            ) : (
              <>
                <strong>✓ Unidades resolvidas.</strong> A prévia está pronta
                para sincronização.
              </>
            )}
          </div>
          <div
            className={`period-sheets-sync-bar ${modoApresentacao ? "is-presentation" : totalOperacoesPrevia === 0 ? "is-synced" : ""}`}
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
                onClick={abrirSincronizacao}
                disabled={sincronizandoSheets || totalOperacoesPrevia === 0}
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
  );
}
