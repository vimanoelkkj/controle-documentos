const alunosTeste = [
  {
    ra: '2910136038',
    nome: 'ALÉSSIA CAROLINE LINHARES DE QUEIROZ',
    unidade: 'FCH EAD',
    curso: 'BIOMEDICINA',
    pendencias: 2,
  },
  {
    ra: '2910135313',
    nome: 'EDUARDA RAYANNE GUIMARAES TAVARES',
    unidade: 'FCH EAD',
    curso: 'PSICOLOGIA',
    pendencias: 7,
  },
  {
    ra: '2910132505',
    nome: 'YASMIN RAUSCH',
    unidade: 'FCH EAD',
    curso: 'PSICOLOGIA',
    pendencias: 3,
  },
]

function Conferencia() {
  return (
    <section className="conference-page">
      <header className="page-header">
        <span>FLUXO DE TRABALHO</span>
        <h1>Conferência de documentos</h1>
        <p>Confira e atualize a documentação dos alunos.</p>
      </header>

      <div className="conference-grid">
        <aside className="student-panel">
          <div className="student-panel-header">
            <div>
              <span>ALUNOS POR UNIDADE</span>
              <h2>Lista de conferência</h2>
            </div>

            <button type="button" className="icon-button">
              ↻
            </button>
          </div>

          <div className="unit-tabs">
            <button type="button">
              FACE FEA
              <strong>425</strong>
            </button>

            <button type="button" className="active">
              FCH EAD
              <strong>657</strong>
            </button>
          </div>

          <input
            className="student-search"
            type="search"
            placeholder="Pesquisar aluno..."
          />

          <div className="student-list">
            {alunosTeste.map((aluno, index) => (
              <button
                key={aluno.ra}
                type="button"
                className={`student-card ${index === 0 ? 'active' : ''}`}
              >
                <div className="student-card-main">
                  <strong>{aluno.nome}</strong>

                  <span>
                    RA {aluno.ra} · {aluno.curso}
                  </span>
                </div>

                <div className="student-card-footer">
                  <span>{aluno.unidade}</span>

                  <strong>
                    {aluno.pendencias}/7
                  </strong>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <article className="student-details">
          <header className="student-details-header">
            <div className="student-avatar">
              AQ
            </div>

            <div className="student-identity">
              <h2>ALÉSSIA CAROLINE LINHARES DE QUEIROZ</h2>

              <div className="student-tags">
                <span>RA 2910136038</span>
                <span>FCH EAD</span>
                <span>BIOMEDICINA</span>
              </div>
            </div>

            <div className="student-progress">
              <strong>71%</strong>
              <span>CRÍTICO</span>
            </div>
          </header>

          <div className="document-progress">
            <div className="document-progress-label">
              <span>Progresso documental</span>
              <span>5/7 documentos</span>
            </div>

            <div className="progress-track">
              <div
                className="progress-value"
                style={{ width: '71%' }}
              />
            </div>
          </div>

          <div className="documents-area">
            <div>
              <h3>Documentos</h3>

              <div className="documents-grid">
                {[
                  ['ID', true],
                  ['CPF', true],
                  ['CERTIDÃO', true],
                  ['RESIDÊNCIA', true],
                  ['TÍTULO', false],
                  ['ENSINO MÉDIO', true],
                  ['CONTRATO', false],
                ].map(([documento, entregue]) => (
                  <label
                    key={String(documento)}
                    className={`document-card ${
                      entregue ? 'delivered' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      defaultChecked={Boolean(entregue)}
                    />

                    <div>
                      <strong>{documento}</strong>

                      <span>
                        {entregue
                          ? 'Documento entregue'
                          : 'Documento pendente'}
                      </span>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <aside className="summary-card">
              <span>RESUMO</span>

              <div className="summary-number">
                <strong>2</strong>
                <span>Pendências</span>
              </div>

              <ul>
                <li>TÍTULO</li>
                <li>CONTRATO</li>
              </ul>
            </aside>
          </div>
        </article>
      </div>
    </section>
  )
}

export default Conferencia