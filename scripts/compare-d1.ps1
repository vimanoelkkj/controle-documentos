[CmdletBinding()]
param(
  [string]$SourceDatabase = "controle-documentos-db",
  [string]$RestoredDatabase = "controle-documentos-restore-teste"
)

$ErrorActionPreference = "Stop"
$tables = @(
  "alunos",
  "documentos",
  "comunicacoes",
  "logs",
  "periodos",
  "google_sheets_periodos",
  "google_sheets_mapeamentos",
  "usuarios",
  "sessoes",
  "d1_migrations"
)

function Get-TableCount([string]$Database, [string]$Table) {
  $query = "SELECT COUNT(*) AS total FROM $Table;"
  $raw = @(& npx.cmd wrangler d1 execute $Database --remote --command $query --json 2>&1)
  if ($LASTEXITCODE -ne 0) {
    Write-Host ($raw -join [Environment]::NewLine)
    throw "Falha ao contar a tabela '$Table' em '$Database'."
  }
  $result = (($raw -join [Environment]::NewLine) | ConvertFrom-Json)
  return [long]@($result | ForEach-Object { $_.results } | Where-Object { $_ })[0].total
}

$comparison = foreach ($table in $tables) {
  Write-Host "Comparando $table..."
  $source = Get-TableCount -Database $SourceDatabase -Table $table
  $restored = Get-TableCount -Database $RestoredDatabase -Table $table
  [pscustomobject]@{
    tabela = $table
    producao = $source
    restaurado = $restored
    resultado = if ($table -eq "sessoes") {
      "VOLATIL"
    } elseif ($table -eq "d1_migrations" -and $restored -eq ($source + 1)) {
      "MIGRATION 007"
    } elseif ($source -eq $restored) {
      "OK"
    } else {
      "DIVERGENTE"
    }
  }
}

$comparison | Format-Table tabela, producao, restaurado, resultado -AutoSize
$differences = @($comparison | Where-Object { $_.resultado -eq "DIVERGENTE" })
if ($differences.Count -gt 0) {
  throw "A restauracao possui contagens divergentes. Nao prossiga para a troca de binding."
}

Write-Host "Todas as contagens permanentes conferem. Sessoes sao volateis e a migration 007 existe somente no banco de teste."
