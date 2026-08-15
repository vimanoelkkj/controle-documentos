type TipoEmails = "institucional" | "alternativo" | "ambos";

type Props = {
  modoApresentacao: boolean;
  quantidadeSelecionados: number;
  selecionadosComInstitucional: number;
  selecionadosSemInstitucional: number;
  quantidadeAlternativos: number;
  emailsInstitucionaisInvalidos: number;
  emailsInstitucionaisDuplicados: number;
  validacaoOk: boolean;
  feedback: string;
  registrandoHistorico: boolean;
  copiarEmails: (tipo: TipoEmails) => void | Promise<void>;
  copiarPacoteOutlook: () => void | Promise<void>;
  registrarCobranca: () => void | Promise<void>;
};

export function PainelAcoesComunicacao({
  modoApresentacao,
  quantidadeSelecionados,
  selecionadosComInstitucional,
  selecionadosSemInstitucional,
  quantidadeAlternativos,
  emailsInstitucionaisInvalidos,
  emailsInstitucionaisDuplicados,
  validacaoOk,
  feedback,
  registrandoHistorico,
  copiarEmails,
  copiarPacoteOutlook,
  registrarCobranca,
}: Props) {
  return (
    <>
      <div className="communication-actions">
        {modoApresentacao ? (
          <div>
            <span>MODO APRESENTAÇÃO</span>
            <strong>Dados pessoais e ações de comunicação ocultos</strong>
            <small>
              A estrutura da combinação continua disponível apenas para
              demonstração.
            </small>
          </div>
        ) : (
          <>
            <div>
              <span>DESTINATÁRIOS</span>
              <strong>{quantidadeSelecionados} alunos selecionados</strong>
              <small>
                {selecionadosComInstitucional} com e-mail institucional
                {" • "}
                {selecionadosSemInstitucional} sem institucional
                {" • "}
                {quantidadeAlternativos} alternativos
              </small>
            </div>

            <div className="communication-action-buttons">
              <button
                type="button"
                onClick={() => void copiarEmails("institucional")}
              >
                Copiar institucionais
              </button>

              <button
                type="button"
                onClick={() => void copiarEmails("alternativo")}
              >
                Copiar alternativos
              </button>

              <button type="button" onClick={() => void copiarEmails("ambos")}>
                Copiar ambos
              </button>

              <button
                type="button"
                className="communication-outlook-button"
                onClick={() => void copiarPacoteOutlook()}
                title="Copia CCO, assunto e mensagem para a área de transferência"
              >
                Copiar pacote
              </button>

              <button
                type="button"
                className="communication-register-button"
                onClick={() => void registrarCobranca()}
                disabled={registrandoHistorico || quantidadeSelecionados === 0}
                title="Use depois de concluir o envio para registrar a cobrança no histórico"
              >
                {registrandoHistorico ? "Registrando..." : "Registrar cobrança"}
              </button>
            </div>
          </>
        )}
      </div>

      {feedback && <div className="communication-feedback">{feedback}</div>}

      {!modoApresentacao && (
        <div
          className={`communication-validation ${
            validacaoOk ? "ok" : "warning"
          }`}
        >
          <div>
            <span>VALIDAÇÃO DOS DESTINATÁRIOS</span>
            <strong>
              {validacaoOk
                ? "Lista pronta para comunicação"
                : "Revise a lista antes de copiar"}
            </strong>
          </div>

          <div className="communication-validation-items">
            <span
              className={selecionadosSemInstitucional === 0 ? "ok" : "warning"}
            >
              {selecionadosSemInstitucional === 0 ? "✓" : "!"}{" "}
              {selecionadosSemInstitucional} sem e-mail institucional
            </span>

            <span
              className={emailsInstitucionaisInvalidos === 0 ? "ok" : "warning"}
            >
              {emailsInstitucionaisInvalidos === 0 ? "✓" : "!"}{" "}
              {emailsInstitucionaisInvalidos} e-mail(is) inválido(s)
            </span>

            <span
              className={
                emailsInstitucionaisDuplicados === 0 ? "ok" : "attention"
              }
            >
              {emailsInstitucionaisDuplicados === 0 ? "✓" : "!"}{" "}
              {emailsInstitucionaisDuplicados} duplicado(s)
            </span>
          </div>
        </div>
      )}
    </>
  );
}
