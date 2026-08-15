import AppSelect from "../../../components/AppSelect";

type RegistroAuditoria = {
  id: number;
  criado_em: string;
  acao: string;
  entidade: string;
  descricao: string;
  ra: string | null;
  unidade: string | null;
  usuario_id: number | null;
  usuario_nome: string | null;
  usuario_username: string | null;
  periodo_codigo?: string | null;
};

type Props = {
  registros: RegistroAuditoria[];
  filtrados: RegistroAuditoria[];
  usuarios: number;
  semAutoria: number;
  busca: string;
  setBusca: (valor: string) => void;
  acao: string;
  setAcao: (valor: string) => void;
  acoes: string[];
  carregando: boolean;
  erro: string;
};

function formatarData(valor: string) {
  const normalizado = valor.includes("T")
    ? valor
    : `${valor.replace(" ", "T")}Z`;

  const data = new Date(normalizado);

  return Number.isNaN(data.getTime())
    ? valor
    : data.toLocaleString("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      });
}

export function ListaAuditoria({
  registros,
  filtrados,
  usuarios,
  semAutoria,
  busca,
  setBusca,
  acao,
  setAcao,
  acoes,
  carregando,
  erro,
}: Props) {
  return (
    <>
      <div className="audit-summary">
        <article>
          <span>Eventos</span>
          <strong>{registros.length}</strong>
        </article>

        <article>
          <span>Usuários identificados</span>
          <strong>{usuarios}</strong>
        </article>

        <article className={semAutoria ? "audit-warning" : ""}>
          <span>Sem autoria</span>
          <strong>{semAutoria}</strong>
        </article>
      </div>

      <div className="audit-toolbar">
        <input
          type="search"
          value={busca}
          onChange={(event) => setBusca(event.target.value)}
          placeholder="Buscar usuário, ação, RA ou unidade..."
        />

        <AppSelect
          value={acao}
          onChange={setAcao}
          ariaLabel="Filtrar auditoria por ação"
          options={[
            { value: "TODAS", label: "Todas as ações" },
            ...acoes.map((item) => ({
              value: item,
              label: item,
            })),
          ]}
        />

        <span>{filtrados.length} resultado(s)</span>
      </div>

      {carregando ? (
        <div className="log-state">Carregando auditoria...</div>
      ) : erro ? (
        <div className="log-state error">{erro}</div>
      ) : filtrados.length === 0 ? (
        <div className="log-state">Nenhum evento encontrado.</div>
      ) : (
        <div className="audit-table-wrap">
          <table className="audit-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Responsável</th>
                <th>Período</th>
                <th>Ação</th>
                <th>Registro</th>
                <th>Descrição</th>
              </tr>
            </thead>

            <tbody>
              {filtrados.map((registro) => (
                <tr key={registro.id}>
                  <td>
                    <time>{formatarData(registro.criado_em)}</time>
                  </td>

                  <td>
                    <strong>{registro.usuario_nome || "Sistema/legado"}</strong>

                    {registro.usuario_username && (
                      <small>@{registro.usuario_username}</small>
                    )}
                  </td>

                  <td>
                    <span className="audit-period">
                      {registro.periodo_codigo || "Global"}
                    </span>
                  </td>

                  <td>
                    <span className="audit-action">{registro.acao}</span>
                  </td>

                  <td>
                    <strong>
                      {registro.ra ? `RA ${registro.ra}` : registro.entidade}
                    </strong>

                    {registro.unidade && <small>{registro.unidade}</small>}
                  </td>

                  <td>{registro.descricao}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
