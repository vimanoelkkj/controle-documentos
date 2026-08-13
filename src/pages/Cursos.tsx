import { useEffect, useMemo, useState } from "react";
import AppIcon from "../components/AppIcon";
import AppSelect from "../components/AppSelect";
import { useAuth } from "../contexts/AuthContext";
import { usePeriodo } from "../contexts/PeriodoContext";
import { api } from "../lib/api";

type Unidade = "FACE" | "FEA" | "FCH" | "EAD";
type Curso = {
  curso: string;
  total_alunos: number;
  unidades: Array<{ unidade: string; total: number }>;
};

const unidades: Unidade[] = ["FACE", "FEA", "FCH", "EAD"];

export default function Cursos() {
  const { periodoAtual } = usePeriodo();
  const { podeEditar } = useAuth();
  const [cursos, setCursos] = useState<Curso[]>([]);
  const [destinos, setDestinos] = useState<Record<string, Unidade>>({});
  const [busca, setBusca] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [confirmando, setConfirmando] = useState<Curso | null>(null);
  const [confirmacao, setConfirmacao] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState<{
    total: number;
    unidade: string;
  } | null>(null);

  async function carregar() {
    setCarregando(true);
    setErro("");
    try {
      const dados = await api.get<Curso[]>("/api/cursos", {
        cache: "no-store",
      });
      setCursos(dados);
      setDestinos(
        Object.fromEntries(
          dados.map((curso) => [
            curso.curso,
            (curso.unidades.length === 1 &&
            unidades.includes(curso.unidades[0].unidade as Unidade)
              ? curso.unidades[0].unidade
              : "FACE") as Unidade,
          ]),
        ),
      );
    } catch (e) {
      setErro(
        e instanceof Error ? e.message : "Não foi possível carregar os cursos.",
      );
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    void carregar();
  }, [periodoAtual?.id]);

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase("pt-BR");
    return termo
      ? cursos.filter((item) =>
          item.curso.toLocaleLowerCase("pt-BR").includes(termo),
        )
      : cursos;
  }, [busca, cursos]);

  const totalAlunos = cursos.reduce(
    (total, curso) => total + curso.total_alunos,
    0,
  );
  const inconsistentes = cursos.filter(
    (curso) => curso.unidades.length > 1,
  ).length;

  async function alterar() {
    if (!confirmando) return;
    setSalvando(true);
    setErro("");
    try {
      const dados = await api.put<{
        alunos_alterados?: number;
        unidade?: string;
      }>("/api/cursos/unidade", {
        curso: confirmando.curso,
        unidade: destinos[confirmando.curso],
        confirmacao,
      });
      setMensagem({
        total: dados.alunos_alterados ?? 0,
        unidade: dados.unidade ?? destinos[confirmando.curso],
      });
      setConfirmando(null);
      setConfirmacao("");
      await carregar();
    } catch (e) {
      setErro(
        e instanceof Error ? e.message : "Não foi possível alterar a unidade.",
      );
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section className="courses-page">
      <header className="courses-header">
        <div>
          <span>ORGANIZAÇÃO ACADÊMICA</span>
          <div className="page-title-row">
            <span className="page-title-icon">
              <AppIcon name="courses" size={22} />
            </span>
            <h1>Cursos e unidades</h1>
          </div>
          <p>
            Corrija a unidade de um curso e atualize todos os alunos vinculados
            no período {periodoAtual?.codigo}.
          </p>
        </div>
      </header>

      <div className="courses-summary">
        <article>
          <span>Cursos cadastrados</span>
          <strong>{cursos.length}</strong>
        </article>
        <article>
          <span>Alunos vinculados</span>
          <strong>{totalAlunos}</strong>
        </article>
        <article className={inconsistentes ? "warning" : ""}>
          <span>Com unidades divergentes</span>
          <strong>{inconsistentes}</strong>
        </article>
      </div>

      <section className="courses-panel">
        <div className="courses-toolbar">
          <div>
            <strong>Mapeamento por curso</strong>
            <span>{filtrados.length} resultado(s)</span>
          </div>
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar curso..."
          />
        </div>
        {mensagem && (
          <div className="courses-feedback-wrap">
            <div className="courses-success-card" role="status">
              <span className="courses-success-icon" aria-hidden="true">
                ✓
              </span>
              <div>
                <strong>Unidade atualizada</strong>
                <span>
                  {mensagem.total} aluno(s) movido(s) para {mensagem.unidade}.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMensagem(null)}
                aria-label="Fechar confirmação"
              >
                ×
              </button>
            </div>
          </div>
        )}
        {erro && <div className="courses-message error">{erro}</div>}
        {carregando ? (
          <div className="courses-empty">Carregando cursos...</div>
        ) : filtrados.length === 0 ? (
          <div className="courses-empty">Nenhum curso encontrado.</div>
        ) : (
          <div className="courses-list">
            {filtrados.map((curso) => {
              const atual =
                curso.unidades.length === 1
                  ? curso.unidades[0].unidade
                  : "DIVERGENTE";
              const destino = destinos[curso.curso] || "FACE";
              const semAlteracao = atual === destino;
              return (
                <article className="course-row" key={curso.curso}>
                  <div className="course-copy">
                    <strong>{curso.curso}</strong>
                    <span>{curso.total_alunos} aluno(s)</span>
                  </div>
                  <div
                    className={`course-current ${atual === "DIVERGENTE" ? "warning" : ""}`}
                  >
                    <small>Unidade atual</small>
                    <strong>{atual}</strong>
                    {curso.unidades.length > 1 && (
                      <span>
                        {curso.unidades
                          .map((u) => `${u.unidade}: ${u.total}`)
                          .join(" · ")}
                      </span>
                    )}
                  </div>
                  <label>
                    <span>Nova unidade</span>
                    <AppSelect
                      value={destino}
                      onChange={(valor) =>
                        setDestinos((estado) => ({
                          ...estado,
                          [curso.curso]: valor as Unidade,
                        }))
                      }
                      disabled={!podeEditar}
                      options={unidades.map((unidade) => ({
                        value: unidade,
                        label: unidade,
                      }))}
                      ariaLabel={`Nova unidade de ${curso.curso}`}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={!podeEditar || semAlteracao}
                    onClick={() => {
                      setMensagem(null);
                      setErro("");
                      setConfirmacao("");
                      setConfirmando(curso);
                    }}
                  >
                    Aplicar aos alunos
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {confirmando && (
        <div
          className="modal-overlay courses-modal-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !salvando) setConfirmando(null);
          }}
        >
          <section
            className="courses-confirm-modal"
            role="dialog"
            aria-modal="true"
          >
            <header>
              <span>ALTERAÇÃO EM MASSA</span>
              <h2>Confirmar nova unidade</h2>
              <p>
                <strong>{confirmando.curso}</strong>
              </p>
            </header>
            <div className="courses-confirm-body">
              <div>
                <span>Alunos afetados</span>
                <strong>{confirmando.total_alunos}</strong>
              </div>
              <div>
                <span>Nova unidade</span>
                <strong>{destinos[confirmando.curso]}</strong>
              </div>
              <p>
                Todos os alunos desse curso no período{" "}
                <strong>{periodoAtual?.codigo}</strong> serão vinculados à nova
                unidade. O mapeamento também será usado nas próximas
                sincronizações.
              </p>
              <label>
                <span className="courses-confirm-label">
                  Digite <strong>ALTERAR</strong> para confirmar
                </span>
                <input
                  autoFocus
                  value={confirmacao}
                  onChange={(e) =>
                    setConfirmacao(e.target.value.toLocaleUpperCase("pt-BR"))
                  }
                />
              </label>
            </div>
            <footer>
              <button
                type="button"
                onClick={() => setConfirmando(null)}
                disabled={salvando}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="confirm"
                onClick={() => void alterar()}
                disabled={salvando || confirmacao !== "ALTERAR"}
              >
                {salvando ? "Alterando..." : "Confirmar alteração"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
