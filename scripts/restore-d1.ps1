[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$BackupFile,
  [Parameter(Mandatory = $true)]
  [string]$TargetDatabase,
  [Parameter(Mandatory = $true)]
  [string]$ConfirmTargetDatabase,
  [switch]$Execute
)

$ErrorActionPreference = "Stop"
$productionDatabases = @("controle-documentos-db", "controle-documentos-dev-db")
$resolvedBackup = (Resolve-Path -LiteralPath $BackupFile).Path

if ($TargetDatabase -ne $ConfirmTargetDatabase) {
  throw "A confirmação não corresponde exatamente ao banco de destino."
}
if ($productionDatabases -contains $TargetDatabase) {
  throw "Restauração direta sobre produção/dev é bloqueada. Crie um banco D1 de recuperação separado."
}
if ([System.IO.Path]::GetExtension($resolvedBackup) -ne ".sql") {
  throw "O backup deve ser um arquivo .sql exportado pelo Wrangler."
}
if ((Get-Item -LiteralPath $resolvedBackup).Length -eq 0) {
  throw "O arquivo de backup está vazio."
}

$checksumFile = "$resolvedBackup.sha256"
if (Test-Path -LiteralPath $checksumFile) {
  $expected = ((Get-Content -LiteralPath $checksumFile -Raw).Trim() -split "\s+")[0].ToLowerInvariant()
  $actual = (Get-FileHash -LiteralPath $resolvedBackup -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($expected -ne $actual) { throw "Checksum inválido: o backup pode estar corrompido ou alterado." }
  Write-Host "Checksum SHA-256 confirmado."
} else {
  Write-Warning "Checksum não encontrado; a integridade do arquivo não pôde ser confirmada."
}

if (!$Execute) {
  Write-Host "Simulação concluída. Nenhum dado foi alterado."
  Write-Host "Destino: $TargetDatabase"
  Write-Host "Arquivo: $resolvedBackup"
  Write-Host "Repita com -Execute somente após confirmar que o destino é um banco D1 novo e vazio."
  exit 0
}

Write-Host "Importando em banco de recuperação separado: $TargetDatabase"
& npx.cmd wrangler d1 execute $TargetDatabase --remote --file $resolvedBackup
if ($LASTEXITCODE -ne 0) { throw "A importação falhou (código $LASTEXITCODE)." }

& (Join-Path $PSScriptRoot "validate-d1.ps1") -Database $TargetDatabase
if ($LASTEXITCODE -ne 0) { throw "A validação pós-restauração falhou." }
Write-Host "Restauração concluída e esquema validado. Não altere o binding de produção antes da conferência funcional."
