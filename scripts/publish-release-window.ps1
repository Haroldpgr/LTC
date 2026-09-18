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

# Todo queda en este log aunque la ventana se cerrara:
# %TEMP%\ltc-release-vX.log
$logFile = Join-Path $env:TEMP ("ltc-release-v$Version.log")
try { Start-Transcript -Path $logFile -Force | Out-Null } catch {}

function End-Pause([int]$code) {
  Write-Host ""
  if ($code -eq 0) {
    Write-Host "[release] Listo. Ya puedes cerrar esta ventana."
  } else {
    Write-Host "[release] Falló (código $code). Revisa el mensaje de arriba o el log:"
    Write-Host "[release] $logFile"
  }
  Write-Host "Pulsa una tecla para cerrar (o espera 3 minutos)..."
  try {
    [void][System.Console]::ReadKey($true)
  } catch {
    Start-Sleep -Seconds 180
  }
  try { Stop-Transcript | Out-Null } catch {}
  exit $code
}

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
  Write-Host "[release] Pégalo en el Panel admin > Info de update > Token de GitHub,"
  Write-Host "[release] y vuelve a pulsar Subir release."
  End-Pause 1
}

$env:GITHUB_TOKEN = $token.Trim()
Write-Host "[release] Publicando v$Version ..."
if ([string]::IsNullOrWhiteSpace($Notes)) {
  node scripts/publish-update.mjs "--version=$Version"
} else {
  node scripts/publish-update.mjs "--version=$Version" "$Notes"
}
End-Pause $LASTEXITCODE
