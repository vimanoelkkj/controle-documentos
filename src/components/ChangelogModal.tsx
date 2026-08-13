import { useEffect, useState } from "react";
import { CURRENT_RELEASE } from "../data/changelog";

const storageKey = `changelog-visto-${CURRENT_RELEASE.version}`;

export default function ChangelogModal() {
  const [aberto, setAberto] = useState(() => localStorage.getItem(storageKey) !== "1");

  useEffect(() => {
    if (!aberto) return;
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflowAnterior; };
  }, [aberto]);

  if (!aberto) return null;

  function confirmar() {
    localStorage.setItem(storageKey, "1");
    setAberto(false);
  }

  return <div className="modal-overlay changelog-overlay">
    <section className="changelog-modal" role="dialog" aria-modal="true" aria-labelledby="changelog-title">
      <header className="changelog-modal-header">
        <div className="changelog-release-mark" aria-hidden="true">✦</div>
        <div><span>NOVIDADES DA VERSÃO</span><h2 id="changelog-title">O que há de novo</h2><p>v{CURRENT_RELEASE.version} · {CURRENT_RELEASE.date}</p></div>
      </header>
      <div className="changelog-modal-body">
        <div className="changelog-intro"><strong>{CURRENT_RELEASE.title}</strong><p>{CURRENT_RELEASE.description}</p></div>
        <div className="changelog-items">{CURRENT_RELEASE.items.map((item) => <article key={item.title}><span aria-hidden="true">✓</span><div><strong>{item.title}</strong><p>{item.description}</p></div></article>)}</div>
      </div>
      <footer className="changelog-modal-footer">
        <button type="button" className="secondary" onClick={() => setAberto(false)}>Ver depois</button>
        <button type="button" className="primary" onClick={confirmar}>Entendi</button>
      </footer>
    </section>
  </div>;
}
