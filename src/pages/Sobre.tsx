import AppIcon from "../components/AppIcon";
import { APP_VERSION, CHANGELOG } from "../data/changelog";

const recursos = [
  { icon: "document", eyebrow: "PROPÓSITO", title: "Centralizar a conferência documental", text: "O sistema organiza alunos, documentos, pendências, cancelamentos e períodos letivos em um único fluxo, reduzindo tarefas manuais e facilitando a conferência diária." },
  { icon: "check", eyebrow: "CONFERÊNCIA", title: "Controle por aluno", text: "Acompanhe documentos entregues, pendências, status da matrícula e alterações cadastrais sem depender de múltiplas planilhas." },
  { icon: "stats", eyebrow: "ANÁLISE", title: "Visão consolidada", text: "Dashboard e estatísticas ajudam a identificar documentos mais devidos, unidades com maior criticidade e evolução documental." },
  { icon: "calendar", eyebrow: "PERÍODOS", title: "Histórico preservado", text: "Cada período letivo mantém seus próprios alunos, documentos e registros, permitindo alternar entre ciclos sem perder histórico." },
  { icon: "document", eyebrow: "GOOGLE PLANILHAS", title: "Integração segura", text: "Integração para ler, comparar e sincronizar alunos, documentos e cancelamentos com segurança antes de aplicar alterações.", google: true },
  { icon: "log", eyebrow: "RASTREABILIDADE", title: "LOG de operações", text: "As principais ações ficam registradas para facilitar auditoria, conferência e acompanhamento do que foi alterado em cada período." },
] as const;

function Sobre() {
  return (
    <section className="about-page about-page-flat">
      <div className="about-flat-version">
        <strong>Versão atual: {APP_VERSION}</strong>
        <span>Lançada em agosto de 2026</span>
      </div>

      <section className="about-flat-section">
        <h2 className="about-flat-section-title">RECURSOS DO SISTEMA</h2>
        <div className="about-flat-resources">
          {recursos.map((recurso) => (
            <article className="about-flat-resource" key={recurso.eyebrow}>
              <div className={`about-flat-icon${"google" in recurso && recurso.google ? " google" : ""}`}>
                <AppIcon name={recurso.icon} size={27} />
              </div>
              <div>
                <span>{recurso.eyebrow}</span>
                <h3>{recurso.title}</h3>
                <p>{recurso.text}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="about-flat-section about-flat-history">
        <h2 className="about-flat-section-title">HISTÓRICO DE ATUALIZAÇÕES</h2>
        <div className="about-flat-releases">
          {CHANGELOG.map((release, index) => (
            <article className="about-flat-release" key={release.version}>
              <div className="about-flat-release-version">
                {index === 0 && <span>ATUAL</span>}
                <strong>v{release.version}</strong>
                <small>{release.date}</small>
              </div>
              <div className="about-flat-release-content">
                <h3>{release.title}</h3>
                <p>{release.description}</p>
                <ul>
                  {release.items.map((item) => (
                    <li key={item.title}>
                      <span className="about-flat-check">✓</span>
                      <div><strong>{item.title}</strong><span>{item.description}</span></div>
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>
      </section>

      <footer className="about-flat-footer">
        <span>♡</span>
        Desenvolvido para simplificar a rotina da Secretaria Acadêmica e garantir mais controle, segurança e agilidade no dia a dia.
      </footer>
    </section>
  );
}

export default Sobre;
