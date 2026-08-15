import AppIcon from "../../../components/AppIcon";
import type { BackupGerado } from "../hooks/useBackup";

type Props = {
  backupConfigurado: boolean | null;
  gerandoBackup: boolean;
  erroBackup: string;
  backupGerado: BackupGerado | null;
  gerarBackup: () => void | Promise<void>;
};

export function BackupSection({
  backupConfigurado,
  gerandoBackup,
  erroBackup,
  backupGerado,
  gerarBackup,
}: Props) {
  return (
    <section className="settings-backup">
      <div className="settings-backup-head">
        <div className="settings-backup-title">
          <span className="settings-backup-icon">
            <AppIcon name="document" size={22} />
          </span>

          <div>
            <span>PROTEÇÃO DOS DADOS</span>
            <h2>Backup do banco</h2>
            <p>
              Gere uma cópia SQL completa do D1 para guardar fora do
              repositório. O arquivo contém dados pessoais e hashes de senha.
            </p>
          </div>
        </div>

        <strong className={backupConfigurado ? "ready" : "pending"}>
          <i aria-hidden="true" />
          {backupConfigurado === null
            ? "VERIFICANDO"
            : backupConfigurado
              ? "CONFIGURADO"
              : "PENDENTE"}
        </strong>
      </div>

      <div className="settings-backup-action">
        <div className="settings-backup-action-copy">
          <span className="settings-backup-action-icon">
            <AppIcon name="audit" size={18} />
          </span>

          <div>
            <strong>Exportação manual segura</strong>
            <span>
              A Cloudflare pode deixar o banco indisponível por alguns instantes
              durante a exportação.
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void gerarBackup()}
          disabled={!backupConfigurado || gerandoBackup}
        >
          {gerandoBackup ? "Gerando backup..." : "Gerar backup agora"}
        </button>
      </div>

      {backupConfigurado === false && (
        <div className="settings-backup-message warning">
          <AppIcon name="info" size={16} />
          <span>
            <strong>Configuração necessária</strong>
            Adicione as três credenciais protegidas no Worker para habilitar o
            botão.
          </span>
        </div>
      )}

      {erroBackup && (
        <div className="settings-backup-message error">{erroBackup}</div>
      )}

      {backupGerado && (
        <div className="settings-backup-result">
          <div>
            <strong>✓ Backup pronto</strong>
            <span>
              {backupGerado.arquivo} · link válido por 1 hora · use Ctrl+S para
              salvar
            </span>
          </div>

          <a href={backupGerado.download_url} target="_blank" rel="noreferrer">
            Abrir arquivo SQL
          </a>
        </div>
      )}
    </section>
  );
}
