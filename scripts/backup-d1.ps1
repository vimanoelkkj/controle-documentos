[CmdletBinding()]
param(
  [ValidateSet("production", "dev")]
  [string]$Environment = "production",
  [string]$OutputDirectory = "backups"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$resolvedOutput = [System.IO.Path]::GetFullPath((Join-Path $projectRoot $OutputDirectory))
$database = if ($Environment -eq "dev") { "controle-documentos-dev-db" } else { "controle-documentos-db" }
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupPath = Join-Path $resolvedOutput "$database-$timestamp.sql"
$checksumPath = "$backupPath.sha256"

New-Item -ItemType Directory -Path $resolvedOutput -Force | Out-Null

$arguments = @("wrangler", "d1", "export", $database, "--remote", "--output", $backupPath)
if ($Environment -eq "dev") {
  $arguments += @("--env", "dev")
}

Write-Host "Exportando $database para $backupPath"
& npx.cmd @arguments
if ($LASTEXITCODE -ne 0) {
  throw "A exportação do D1 falhou (código $LASTEXITCODE)."
}
if (!(Test-Path -LiteralPath $backupPath) -or (Get-Item -LiteralPath $backupPath).Length -eq 0) {
  throw "O arquivo de backup não foi criado ou está vazio."
}

$hash = (Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath $checksumPath -Value "$hash  $([System.IO.Path]::GetFileName($backupPath))" -Encoding ascii

Write-Host "Backup concluído."
Write-Host "SQL: $backupPath"
Write-Host "SHA-256: $hash"
Write-Warning "Este arquivo contém dados pessoais e hashes de senha. Armazene-o criptografado e fora do repositório."
