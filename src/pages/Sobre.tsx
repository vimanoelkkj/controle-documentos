import AppIcon from "../components/AppIcon";
import { APP_VERSION, CHANGELOG } from "../data/changelog";

function Sobre() {
  return (
    <section className="about-page">
      <header className="about-hero">
        <div>
          <span className="about-eyebrow">CONTROLE DE DOCUMENTOS</span>

          <div className="page-title-row">
            <span className="page-title-icon">
              <AppIcon name="info" size={22} />
            </span>
            <h1>Sobre</h1>
          </div>

          <p>
            Uma visão geral do sistema, sua proposta e os recursos que fazem parte
            da operação acadêmica.
          </p>
        </div>

        <div className="about-version-card">
          <span>VERSÃO ATUAL</span>
          <strong>v{APP_VERSION}</strong>
          <small>Controle de Documentos</small>
        </div>
      </header>

      <div className="about-grid">
        <article className="about-card about-card-featured">
          <div className="about-card-icon">
            <AppIcon name="document" size={24} />
          </div>

          <div>
            <span>PROPÓSITO</span>
            <h2>Centralizar a conferência documental</h2>
            <p>
              O sistema organiza alunos, documentos, pendências, cancelamentos e
              períodos letivos em um único fluxo, reduzindo tarefas manuais e
              facilitando a conferência diária.
            </p>
          </div>
        </article>

        <article className="about-card">
          <div className="about-card-icon">
            <AppIcon name="check" size={22} />
          </div>

          <div>
            <span>CONFERÊNCIA</span>
            <h2>Controle por aluno</h2>
            <p>
              Acompanhe documentos entregues, pendências, status da matrícula e
              alterações cadastrais sem depender de múltiplas planilhas.
            </p>
          </div>
        </article>

        <article className="about-card">
          <div className="about-card-icon">
            <AppIcon name="stats" size={22} />
          </div>

          <div>
            <span>ANÁLISE</span>
            <h2>Visão consolidada</h2>
            <p>
              Dashboard e estatísticas ajudam a identificar documentos mais
              devidos, unidades com maior criticidade e evolução documental.
            </p>
          </div>
        </article>

        <article className="about-card">
          <div className="about-card-icon">
            <AppIcon name="calendar" size={22} />
          </div>

          <div>
            <span>PERÍODOS</span>
            <h2>Histórico preservado</h2>
            <p>
              Cada período letivo mantém seus próprios alunos, documentos e
              registros, permitindo alternar entre ciclos sem perder histórico.
            </p>
          </div>
        </article>

        <article className="about-card">
          <div className="about-card-icon google">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M6.5 2h7.2L19 7.3V21a1 1 0 0 1-1 1H6.5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm6.4 1.8V8h4.2l-4.2-4.2ZM8 10v8.5h8V10H8Zm1.4 1.4h2.1v1.7H9.4v-1.7Zm3.5 0h1.7v1.7h-1.7v-1.7Zm-3.5 3.1h2.1v2.6H9.4v-2.6Zm3.5 0h1.7v2.6h-1.7v-2.6Z"
              />
            </svg>
          </div>

          <div>
            <span>INTEGRAÇÃO</span>
            <h2>Google Planilhas</h2>
            <p>
              A integração permite ler, comparar e sincronizar alunos, documentos
              e cancelamentos com segurança antes de aplicar alterações no sistema.
            </p>
          </div>
        </article>

        <article className="about-card about-card-log">
          <div className="about-card-icon">
            <AppIcon name="log" size={22} />
          </div>

          <div>
            <span>RASTREABILIDADE</span>
            <h2>LOG de operações</h2>
            <p>
              As principais ações ficam registradas para facilitar auditoria,
              conferência e acompanhamento do que foi alterado em cada período.
            </p>
          </div>
        </article>
      </div>

      <section className="about-changelog">
        <header><div><span>HISTÓRICO DE ATUALIZAÇÕES</span><h2>Changelog</h2></div><small>{CHANGELOG.length} versão(ões)</small></header>
        <div className="about-changelog-list">{CHANGELOG.map((release, index) => <article key={release.version}>
          <div className="about-changelog-version"><span>{index === 0 ? "ATUAL" : "VERSÃO"}</span><strong>v{release.version}</strong><small>{release.date}</small></div>
          <div className="about-changelog-content"><h3>{release.title}</h3><p>{release.description}</p><ul>{release.items.map((item) => <li key={item.title}><strong>{item.title}</strong><span>{item.description}</span></li>)}</ul></div>
        </article>)}</div>
      </section>

      <section className="about-footer-card">
        <div>
          <span>ESTADO DO PROJETO</span>
          <strong>Sistema em evolução contínua</strong>
          <p>
            Novos recursos e melhorias são incorporados conforme as necessidades
            da operação acadêmica.
          </p>
        </div>

        <div className="about-footer-badge">
          <span className="about-footer-dot" />
          <strong>Operacional</strong>
        </div>
      </section>
    </section>
  );
}

export default Sobre;
