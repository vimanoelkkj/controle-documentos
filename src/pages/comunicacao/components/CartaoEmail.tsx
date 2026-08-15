import type { RefObject } from "react";
import type { Grupo } from "../model";
import { formatarPrazo, prazoValido } from "../utils";

type Props = {
  emailCardRef: RefObject<HTMLElement | null>;
  grupo: Grupo;
  prazo: string;
  setPrazo: (valor: string) => void;
  assunto: string;
  setAssunto: (valor: string) => void;
  quantidadeDestinatarios: number;
  temContrato: boolean;
  copiarAssunto: () => void | Promise<void>;
  copiarComunicado: () => void | Promise<void>;
};

export function CartaoEmail({
  emailCardRef,
  grupo,
  prazo,
  setPrazo,
  assunto,
  setAssunto,
  quantidadeDestinatarios,
  temContrato,
  copiarAssunto,
  copiarComunicado,
}: Props) {
  const prazoEstaValido = prazoValido(prazo);
  return (
    <section ref={emailCardRef} className="communication-email-card">
      <div className="communication-email-settings">
        <label className="communication-deadline-field">
          <span>
            Data limite <small>DD/MM</small>
          </span>

          <input
            value={prazo}
            onChange={(e) => setPrazo(formatarPrazo(e.target.value))}
            onKeyDown={(e) => {
              const input = e.currentTarget;
              const cursorNoFim =
                input.selectionStart === prazo.length &&
                input.selectionEnd === prazo.length;

              if (e.key === "Backspace" && prazo.endsWith("/") && cursorNoFim) {
                e.preventDefault();
                setPrazo(prazo.slice(0, -2));
              }
            }}
            placeholder="__/__"
            inputMode="numeric"
            maxLength={5}
            aria-label="Data limite no formato dia e mês"
          />
          {prazo.length === 5 && !prazoEstaValido && (
            <small className="communication-field-error">
              Informe uma data válida no formato DD/MM.
            </small>
          )}
        </label>

        <label className="communication-subject-field">
          <span>
            Assunto <small>do e-mail</small>
          </span>

          <input
            value={assunto}
            onChange={(e) => setAssunto(e.target.value)}
            placeholder="Ex.: Documentação pendente — Matrícula"
          />
        </label>

        <div className="communication-copy-stack">
          <button
            type="button"
            onClick={() => void copiarAssunto()}
            disabled={!prazoEstaValido}
          >
            Copiar assunto
          </button>

          <button
            type="button"
            onClick={() => void copiarComunicado()}
            disabled={!prazoEstaValido}
          >
            Copiar texto
          </button>
        </div>
      </div>

      <div className="communication-preview">
        <div className="communication-preview-top">
          <div className="communication-preview-heading">
            <div className="communication-preview-icon">✉</div>

            <div>
              <span>PRÉVIA DA MENSAGEM</span>
              <strong>{assunto || "Sem assunto"}</strong>
              <small>Para: {quantidadeDestinatarios} destinatário(s)</small>
            </div>
          </div>

          <span className="communication-preview-count">
            {grupo.documentos.length} pendência(s)
          </span>
        </div>

        <div className="communication-email-body">
          <p className="communication-warning">
            ⚠️ <b>ATENÇÃO! NÃO RESPONDER A ESTE E-MAIL.</b> MANDE A SUA RESPOSTA
            PARA O E-MAIL ABAIXO⬇️:
          </p>

          <p className="communication-address">matriculadecalouro@fumec.br</p>

          <p>Prezado(a), boa tarde.</p>

          <p>
            Informo que em verificação ao nosso sistema a sua matrícula está
            pendente alguns documentos importantes. Peço que realize o envio dos
            mesmos o mais rápido possível via e-mail para{" "}
            <b>matriculadecalouro@fumec.br</b> ou, se preferir, pode comparecer
            pessoalmente na secretaria acadêmica até o dia{" "}
            <b>{prazo || "___/___"}</b>. Informo que a não apresentação destes
            documentos poderá resultar no bloqueio da sua matrícula. Segue lista
            abaixo:
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
              assinado, você irá receber no seu e-mail o link para o portal de
              visualização e assinatura do contrato. Caso contrário,
              desconsidere as orientações.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
