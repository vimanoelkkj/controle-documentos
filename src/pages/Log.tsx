import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import PageLoading from "../components/PageLoading";

type RegistroLog = {
  id: number;
  criado_em: string;
  acao: string;
  entidade: string;
  descricao: string;
  ra: string | null;
  unidade: string | null;
};

function formatarData(valor: string) {
  const normalizado = valor.includes("T") ? valor : `${valor.replace(" ", "T")}Z`;
  const data = new Date(normalizado);
  return Number.isNaN(data.getTime())
    ? valor
    : data.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function Log() {
  const [registros, setRegistros] = useState<RegistroLog[]>([]);
  const [busca, setBusca] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  async function carregarLog() {
    try {
      setCarregando(true);
      setErro("");
      const dados = await api.get<RegistroLog[]>("/api/log?limit=300", {
        cache: "no-store",
      });
      setRegistros(dados);
    } catch (erro) {
      setErro(erro instanceof Error ? erro.message : "Não foi possível carregar o LOG.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregarLog();
  }, []);

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase("pt-BR");
    if (!termo) return registros;
    return registros.filter((registro) =>
      [registro.acao, registro.descricao, registro.ra, registro.unidade]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("pt-BR")
        .includes(termo),
    );
  }, [busca, registros]);

  if (carregando) {
    return (
      <section className="log-page">
        <PageLoading label="Carregando histórico..." />
      </section>
    );
  }

  return (
    <section className="log-page">
      <div className="page-local-actions log-header"><button type="button" className="log-refresh" onClick={carregarLog}>Atualizar</button></div>
<div className="log-toolbar">
        <input
          type="search"
          value={busca}
          onChange={(event) => setBusca(event.target.value)}
          placeholder="Pesquisar por ação, aluno, RA ou unidade..."
        />
        <div className="log-results-count" aria-label={`${filtrados.length} registros`}>
          {filtrados.length.toLocaleString("pt-BR")} {filtrados.length === 1 ? "registro" : "registros"}
        </div>
      </div>

      {erro ? (
        <div className="log-state error">{erro}</div>
      ) : filtrados.length === 0 ? (
        <div className="log-state">Nenhum registro encontrado.</div>
      ) : (
        <div className="log-list">
          {filtrados.map((registro) => (
            <article className="log-item" key={registro.id}>
              <div className="log-item-main">
                <div className="log-item-head">
                  <strong>{registro.acao}</strong>
                  <time>{formatarData(registro.criado_em)}</time>
                </div>
                <p>{registro.descricao}</p>
                <div className="log-meta">
                  {registro.ra && <span>RA {registro.ra}</span>}
                  {registro.unidade && <span>{registro.unidade}</span>}
                  <span>{registro.entidade}</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export default Log;
