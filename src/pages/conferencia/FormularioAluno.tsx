import type { Dispatch, SetStateAction } from "react";
import AppSelect from "../../components/AppSelect";
import type { FormAluno } from "./model";

type FormularioAlunoProps = {
  dados: FormAluno;
  setDados: Dispatch<SetStateAction<FormAluno>>;
  mostrarDocumentos?: boolean;
};

export function FormularioAluno({
  dados,
  setDados,
  mostrarDocumentos = false,
}: FormularioAlunoProps) {
  return (
    <div className="modal-formulario">
      <label>
        RA *
        <input
          value={dados.ra}
          onChange={(event) => {
            const raAnterior = dados.ra.trim();
            const novoRa = event.target.value;
            const emailAutomaticoAnterior = raAnterior
              ? `a${raAnterior}@fumec.edu.br`
              : "";
            const deveAtualizarEmail =
              mostrarDocumentos &&
              (!dados.email.trim() || dados.email === emailAutomaticoAnterior);

            setDados({
              ...dados,
              ra: novoRa,
              ...(deveAtualizarEmail
                ? {
                    email: novoRa.trim()
                      ? `a${novoRa.trim()}@fumec.edu.br`
                      : "",
                  }
                : {}),
            });
          }}
          placeholder="Ex.: 2910136038"
        />
      </label>

      <label>
        Nome *
        <input
          value={dados.nome}
          onChange={(event) =>
            setDados({
              ...dados,
              nome: event.target.value.toLocaleUpperCase("pt-BR"),
            })
          }
          placeholder="Nome completo"
        />
      </label>

      <label>
        Curso *
        <input
          value={dados.curso}
          onChange={(event) =>
            setDados({
              ...dados,
              curso: event.target.value.toLocaleUpperCase("pt-BR"),
            })
          }
          placeholder="Ex.: PSICOLOGIA"
        />
      </label>

      <label>
        Unidade *
        <AppSelect
          value={dados.unidade}
          onChange={(valor) => setDados({ ...dados, unidade: valor })}
          ariaLabel="Unidade do aluno"
          options={[
            { value: "FACE", label: "FACE" },
            { value: "FEA", label: "FEA" },
            { value: "FCH", label: "FCH" },
            { value: "EAD", label: "EAD" },
          ]}
        />
      </label>

      <label>
        E-mail institucional
        <input
          type="email"
          value={dados.email}
          onChange={(event) => setDados({ ...dados, email: event.target.value })}
          placeholder="a0000000000@fumec.edu.br"
        />
      </label>

      <label>
        E-mail alternativo
        <input
          type="email"
          value={dados.email_outro}
          onChange={(event) =>
            setDados({ ...dados, email_outro: event.target.value })
          }
          placeholder="aluno@email.com"
        />
      </label>

      {mostrarDocumentos && (
        <fieldset className="cadastro-documentos">
          <legend>Documentos já entregues</legend>
          <p>Marque somente o que já estiver conferido no cadastro inicial.</p>
          <div className="cadastro-documentos-grid">
            {[
              ["identidade", "Identidade"],
              ["cpf", "CPF"],
              ["certidao", "Certidão de Registro Civil"],
              ["residencia", "Comprovante de Residência"],
              ["titulo", "Título de Eleitor"],
              ["ensino_medio", "Histórico do Ensino Médio"],
              ["contrato", "Contrato"],
            ].map(([campo, nome]) => {
              const chave = campo as keyof FormAluno["documentos"];

              return (
                <label className="cadastro-documento-check" key={campo}>
                  <input
                    type="checkbox"
                    checked={dados.documentos[chave]}
                    onChange={(event) =>
                      setDados({
                        ...dados,
                        documentos: {
                          ...dados.documentos,
                          [chave]: event.target.checked,
                        },
                      })
                    }
                  />
                  <span>{nome}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}
    </div>
  );
}
