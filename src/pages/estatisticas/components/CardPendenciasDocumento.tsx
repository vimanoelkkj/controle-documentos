type DocumentoCampo =
  | "identidade"
  | "cpf"
  | "certidao"
  | "residencia"
  | "titulo"
  | "ensino_medio"
  | "contrato";

type DocumentoStat = {
  campo: DocumentoCampo;
  nome: string;
  taxaEntrega: number;
  taxaPendencia: number;
  pendentes: number;
};

type Props = {
  documentos: DocumentoStat[];
};

export function CardPendenciasDocumento({ documentos }: Props) {
  return (
    <article className="statistics-card">
      <div className="statistics-card-header">
        <div>
          <span>GARGALOS</span>
          <h2>Pendência por documento</h2>
        </div>

        <small>maior primeiro</small>
      </div>

      <div className="statistics-document-list">
        {documentos.map((documento, indice) => {
          const prioritario =
            documento.campo === "contrato" ||
            documento.campo === "ensino_medio";

          return (
            <div
              className={`statistics-document-row ${
                prioritario ? "critical" : ""
              }`}
              key={documento.campo}
            >
              <div className="statistics-document-title">
                <span className={prioritario ? "critical" : ""}>
                  {indice + 1}
                </span>

                <div>
                  <strong>
                    {documento.nome}
                    {prioritario && (
                      <em className="statistics-critical-tag">
                        documento crítico
                      </em>
                    )}
                  </strong>
                  <small>{documento.taxaEntrega}% já entregue</small>
                </div>
              </div>

              <div className="statistics-document-meter">
                <div>
                  <span
                    className={prioritario ? "critical" : ""}
                    style={{
                      width: `${documento.taxaPendencia}%`,
                    }}
                  />
                </div>

                <strong>{documento.pendentes}</strong>
                <small>pendentes</small>
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );
}
