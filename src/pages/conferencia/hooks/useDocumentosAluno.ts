import {
    useState,
    type Dispatch,
    type SetStateAction,
  } from "react";
  
  import type { Aluno } from "../model";
  
  import {
    registrarLogAluno,
    salvarDocumentosAluno,
  } from "../operacoes";
  
  type UseDocumentosAlunoParams = {
    alunosSalvos: Aluno[];
    setAlunosSalvos: Dispatch<SetStateAction<Aluno[]>>;
    alunosEmEdicao: Aluno[];
    setAlunosEmEdicao: Dispatch<SetStateAction<Aluno[]>>;
    raSelecionado: string;
  };
  
  const alunoVazio: Aluno = {
    ra: "",
    nome: "",
    unidade: "",
    curso: "",
    email: null,
    email_outro: null,
    status: "ATIVO",
    documentos: [
      { nome: "ID", entregue: false },
      { nome: "CPF", entregue: false },
      { nome: "CERTIDÃO", entregue: false },
      { nome: "RESIDÊNCIA", entregue: false },
      { nome: "TÍTULO", entregue: false },
      { nome: "ENSINO MÉDIO", entregue: false },
      { nome: "CONTRATO", entregue: false },
    ],
  };
  
  export function useDocumentosAluno({
    alunosSalvos,
    setAlunosSalvos,
    alunosEmEdicao,
    setAlunosEmEdicao,
    raSelecionado,
  }: UseDocumentosAlunoParams) {
    const [status, setStatus] = useState<"salvo" | "pendente">("salvo");
    const [salvando, setSalvando] = useState(false);
    const [erroSalvamento, setErroSalvamento] = useState("");
  
    const alunoSelecionado =
      alunosEmEdicao.find((aluno) => aluno.ra === raSelecionado) ??
      alunosEmEdicao[0] ??
      alunoVazio;
  
    const alunoSalvo =
      alunosSalvos.find((aluno) => aluno.ra === raSelecionado) ??
      alunosSalvos[0] ??
      alunoVazio;
  
    const temAlteracoes = alunoSelecionado.documentos.some(
      (documento, index) =>
        documento.entregue !== alunoSalvo.documentos[index]?.entregue,
    );
  
    function alternarDocumento(nomeDocumento: string) {
      setAlunosEmEdicao((estadoAtual) => {
        const indiceAluno = estadoAtual.findIndex(
          (aluno) => aluno.ra === raSelecionado,
        );

        if (indiceAluno < 0) return estadoAtual;

        const alunoAtual = estadoAtual[indiceAluno];
        const indiceDocumento = alunoAtual.documentos.findIndex(
          (documento) => documento.nome === nomeDocumento,
        );

        if (indiceDocumento < 0) return estadoAtual;

        const documentos = alunoAtual.documentos.slice();
        const documentoAtual = documentos[indiceDocumento];

        documentos[indiceDocumento] = {
          ...documentoAtual,
          entregue: !documentoAtual.entregue,
        };

        const proximoEstado = estadoAtual.slice();
        proximoEstado[indiceAluno] = {
          ...alunoAtual,
          documentos,
        };

        return proximoEstado;
      });
  
      setStatus("pendente");
      setErroSalvamento("");
    }
  
    function restaurarAlteracoes() {
      setAlunosEmEdicao((estadoAtual) =>
        estadoAtual.map((aluno) =>
          aluno.ra === raSelecionado
            ? {
                ...alunoSalvo,
                documentos: alunoSalvo.documentos.map((documento) => ({
                  ...documento,
                })),
              }
            : aluno,
        ),
      );
  
      setStatus("salvo");
      setErroSalvamento("");
    }
  
    async function salvarAlteracoes() {
      if (salvando || !temAlteracoes) return;
  
      setSalvando(true);
      setErroSalvamento("");
  
      try {
        const mapaDocumentos = Object.fromEntries(
          alunoSelecionado.documentos.map((documento) => [
            documento.nome,
            documento.entregue,
          ]),
        );
  
        await salvarDocumentosAluno(alunoSelecionado.ra, {
          identidade: mapaDocumentos["ID"],
          cpf: mapaDocumentos["CPF"],
          certidao: mapaDocumentos["CERTIDÃO"],
          residencia: mapaDocumentos["RESIDÊNCIA"],
          titulo: mapaDocumentos["TÍTULO"],
          ensino_medio: mapaDocumentos["ENSINO MÉDIO"],
          contrato: mapaDocumentos["CONTRATO"],
        });
  
        setAlunosSalvos((estadoAtual) =>
          estadoAtual.map((aluno) =>
            aluno.ra === raSelecionado
              ? {
                  ...alunoSelecionado,
                  documentos: alunoSelecionado.documentos.map((documento) => ({
                    ...documento,
                  })),
                }
              : aluno,
          ),
        );
  
        setStatus("salvo");
  
        const alteracoesDocumentais = alunoSelecionado.documentos
          .map((documento, index) => {
            const anterior = alunoSalvo.documentos[index];
  
            if (!anterior || anterior.entregue === documento.entregue) {
              return null;
            }
  
            return `${documento.nome} → ${
              documento.entregue ? "entregue" : "pendente"
            }`;
          })
          .filter(Boolean)
          .join("; ");
  
        await registrarLogAluno(
          "DOCUMENTOS",
          alteracoesDocumentais
            ? `Documentos atualizados: ${alteracoesDocumentais}.`
            : `Documentação de ${alunoSelecionado.nome} atualizada.`,
          alunoSelecionado.ra,
          alunoSelecionado.unidade,
        );
      } catch (erro) {
        console.error(erro);
  
        setErroSalvamento(
          "Não foi possível salvar. Suas alterações continuam nesta tela.",
        );
      } finally {
        setSalvando(false);
      }
    }
  
    return {
      alunoSelecionado,
      alunoSalvo,
      status,
      setStatus,
      salvando,
      erroSalvamento,
      temAlteracoes,
      alternarDocumento,
      restaurarAlteracoes,
      salvarAlteracoes,
    };
  }