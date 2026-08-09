import AppIcon from "../components/AppIcon";
// src/pages/Auditoria.tsx
function Auditoria() {
  return (
    <section>
      <span>INTEGRIDADE DAS BASES</span>
      <div className="page-title-row">
          <span className="page-title-icon"><AppIcon name="audit" size={22} /></span>
          <h1>Auditoria</h1>
        </div>
      <p>Verificação de inconsistências e duplicidades.</p>
    </section>
  )
}

export default Auditoria