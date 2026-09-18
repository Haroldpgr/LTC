# Ventana aparte para publicar un release del launcher.
# La abre el botón "Compilar y subir release" del Panel admin.
# Corre aquí (no dentro del launcher) porque al subir la versión
# `tauri dev` reinicia la app y mataría el proceso a mitad del build.
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$Notes = ""
)

$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$Host.UI.RawUI.WindowTitle = "LTC Launcher - Publicando release v$Version"

# El token vive en la config del launcher (lo guarda el Panel admin).
$token = ""
$cfg = Join-Path $env:APPDATA "LTC Launcher\config.json"
if (Test-Path $cfg) {
  try {
    $token = (Get-Content $cfg -Raw | ConvertFrom-Json).githubToken
  } catch {
    Write-Host "[release] No se pudo leer la config: $_"
  }
}
if ([string]::IsNullOrWhiteSpace($token)) {
  Write-Host ""
  Write-Host "[release] Falta el token de GitHub."
  Write-Host "[release] Pégalo en el Panel admin > Info de update > Pack oficial de mods,"
  Write-Host "[release] y vuelve a pulsar Subir release."
  Write-Host ""
  Write-Host "Pulsa una tecla para cerrar..."
  [void][System.Console]::ReadKey($true)
  exit 1
}

$env:GITHUB_TOKEN = $token.Trim()
if ([string]::IsNullOrWhiteSpace($Notes)) {
  node scripts/publish-update.mjs "--version=$Version"
} else {
  node scripts/publish-update.mjs "--version=$Version" "$Notes"
}

Write-Host ""
if ($LASTEXITCODE -eq 0) {
  Write-Host "[release] Listo. Ya puedes cerrar esta ventana."
} else {
  Write-Host "[release] Falló (código $LASTEXITCODE). Revisa el mensaje de arriba."
}
Write-Host "Pulsa una tecla para cerrar..."
[void][System.Console]::ReadKey($true)
