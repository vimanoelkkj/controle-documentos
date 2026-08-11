-- =========================================================
-- DADOS DE TESTE
-- =========================================================

-- ALÉSSIA
INSERT INTO alunos (ra, nome, curso, unidade)
VALUES (
    '2910136038',
    'ALÉSSIA CAROLINE LINHARES DE QUEIROZ',
    'BIOMEDICINA',
    'FCH EAD'
);

INSERT INTO documentos (
    aluno_id,
    identidade,
    cpf,
    certidao,
    residencia,
    titulo,
    ensino_medio,
    contrato
)
SELECT
    id,
    1,
    1,
    1,
    1,
    0,
    1,
    0
FROM alunos
WHERE ra = '2910136038';


-- EDUARDA
INSERT INTO alunos (ra, nome, curso, unidade)
VALUES (
    '2910135313',
    'EDUARDA RAYANNE GUIMARAES TAVARES',
    'PSICOLOGIA',
    'FCH EAD'
);

INSERT INTO documentos (
    aluno_id,
    identidade,
    cpf,
    certidao,
    residencia,
    titulo,
    ensino_medio,
    contrato
)
SELECT
    id,
    1,
    1,
    1,
    1,
    1,
    1,
    1
FROM alunos
WHERE ra = '2910135313';


-- YASMIN
INSERT INTO alunos (ra, nome, curso, unidade)
VALUES (
    '2910132505',
    'YASMIN RAUSCH',
    'PSICOLOGIA',
    'FCH EAD'
);

INSERT INTO documentos (
    aluno_id,
    identidade,
    cpf,
    certidao,
    residencia,
    titulo,
    ensino_medio,
    contrato
)
SELECT
    id,
    1,
    1,
    0,
    0,
    0,
    0,
    0
FROM alunos
WHERE ra = '2910132505';