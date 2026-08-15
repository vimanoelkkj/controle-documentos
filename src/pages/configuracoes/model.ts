import type { Perfil } from "../../contexts/auth";

export type UsuarioLista = {
  id: number;
  nome: string;
  email: string;
  username: string;
  perfil: Perfil;
  ativo: number;
  modo_apresentacao: number;
  criado_em: string;
};
