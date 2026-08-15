import { useCallback, useState } from "react";
import { api } from "../../../lib/api";

export type BackupGerado = {
  arquivo: string;
  download_url: string;
  expira_em_segundos: number;
};

type Params = {
  admin: boolean;
};

export function useBackup({ admin }: Params) {
  const [backupConfigurado, setBackupConfigurado] = useState<boolean | null>(
    null,
  );
  const [gerandoBackup, setGerandoBackup] = useState(false);
  const [erroBackup, setErroBackup] = useState("");
  const [backupGerado, setBackupGerado] = useState<BackupGerado | null>(null);

  const verificarBackup = useCallback(async () => {
    if (!admin) {
      setBackupConfigurado(null);
      return;
    }

    try {
      const dados = await api.get<{ configurado?: boolean }>(
        "/api/admin/backup/status",
      );

      setBackupConfigurado(Boolean(dados.configurado));
    } catch {
      setBackupConfigurado(false);
    }
  }, [admin]);

  async function gerarBackup() {
    setGerandoBackup(true);
    setErroBackup("");
    setBackupGerado(null);

    try {
      const dados = await api.post<BackupGerado>("/api/admin/backup");
      setBackupGerado(dados);
    } catch (erro) {
      setErroBackup(
        erro instanceof Error
          ? erro.message
          : "Não foi possível acessar o serviço de backup.",
      );
    } finally {
      setGerandoBackup(false);
    }
  }

  return {
    backupConfigurado,
    gerandoBackup,
    erroBackup,
    backupGerado,
    verificarBackup,
    gerarBackup,
  };
}
