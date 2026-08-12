[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Database,
  [switch]$DevEnvironment
)

$ErrorActionPreference = "Stop"
$required = @{
  alunos = @("id", "periodo_id", "ra", "nome", "email", "email_outro", "curso", "unidade", "status", "criado_em", "atualizado_em")
  documentos = @("id", "aluno_id", "identidade", "cpf", "certidao", "residencia", "titulo", "ensino_medio", "contrato", "atualizado_em")
  periodos = @("id", "codigo", "status", "criado_em", "atualizado_em")
  comunicacoes = @("id", "periodo_id", "grupo_chave", "documentos_json", "ras_json")
  logs = @("id", "periodo_id", "acao", "entidade", "descricao", "usuario_id", "usuario_nome", "usuario_username")
  google_sheets_periodos = @("periodo_id", "spreadsheet_id")
  google_sheets_mapeamentos = @("id", "periodo_id", "curso_chave", "curso", "unidade")
  usuarios = @("id", "nome", "email", "username", "senha_hash", "senha_salt", "perfil", "ativo")
  sessoes = @("id", "usuario_id", "token_hash", "expira_em")
}

$columns = @(
  foreach ($table in $required.Keys) {
    $query = "PRAGMA table_info('$table');"
    $arguments = @("wrangler", "d1", "execute", $Database, "--remote", "--command", $query, "--json")
    if ($DevEnvironment) { $arguments += @("--env", "dev") }

    $raw = @(& npx.cmd @arguments 2>&1)
    if ($LASTEXITCODE -ne 0) {
      Write-Host ($raw -join [Environment]::NewLine)
      throw "O Wrangler falhou ao consultar a tabela '$table'. Veja a mensagem acima."
    }

    $result = (($raw -join [Environment]::NewLine) | ConvertFrom-Json)
    foreach ($row in @($result | ForEach-Object { $_.results } | Where-Object { $_ })) {
      [pscustomobject]@{ tabela = $table; coluna = $row.name }
    }
  }
)
$missing = @(
  foreach ($table in $required.Keys) {
    foreach ($column in $required[$table]) {
      if (!($columns | Where-Object { $_.tabela -eq $table -and $_.coluna -eq $column })) {
        [pscustomobject]@{ tabela = $table; coluna = $column }
      }
    }
  }
)

if ($missing.Count -gt 0) {
  $missing | Format-Table tabela, coluna -AutoSize
  throw "Esquema incompativel: ha tabelas ou colunas obrigatorias ausentes."
}

Write-Host "Esquema compativel com a versao atual do Worker."
