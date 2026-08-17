import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../contexts/auth";
import { usePeriodo } from "../contexts/periodo";
import { ModalConfirmarAlteracaoCurso } from "./cursos/ModalConfirmarAlteracaoCurso";
import { ListaCursos } from "./cursos/ListaCursos";
import { api } from "../lib/api";
import PageLoading from "../components/PageLoading";

import type { Unidade } from "../types/domain";
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

  if (carregando) {
    return (
      <section className="courses-page">
        <PageLoading label="Carregando cursos..." />
      </section>
    );
  }

  return (
    <section className="courses-page">
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

      <ListaCursos
        cursos={cursos}
        filtrados={filtrados}
        destinos={destinos}
        busca={busca}
        setBusca={setBusca}
        podeEditar={podeEditar}
        carregando={carregando}
        erro={erro}
        mensagem={mensagem}
        setMensagem={setMensagem}
        setErro={setErro}
        setDestinos={setDestinos}
        aoConfirmarCurso={(curso) => {
          setConfirmacao("");
          setConfirmando(curso);
        }}
      />
      {confirmando && (
        <ModalConfirmarAlteracaoCurso
          curso={confirmando}
          unidadeDestino={destinos[confirmando.curso]}
          periodoCodigo={periodoAtual?.codigo}
          confirmacao={confirmacao}
          setConfirmacao={setConfirmacao}
          salvando={salvando}
          aoFechar={() => setConfirmando(null)}
          aoConfirmar={alterar}
        />
      )}
    </section>
  );
}
