# Publicar un release del launcher (doble clic o desde terminal).
# Te pide versión y mensaje, compila el instalador y lo sube a GitHub solo.
# Corre en SU propia ventana: no le afecta que el `tauri dev` se reinicie.
# El token lo lee de la config del launcher (Panel admin > Token de GitHub).

$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$Host.UI.RawUI.WindowTitle = "LTC Launcher - Publicar release"

function Read-Answer([string]$prompt, [string]$def) {
  if ([string]::IsNullOrWhiteSpace($def)) {
    $ans = Read-Host $prompt
  } else {
    $ans = Read-Host "$prompt [$def]"
    if ([string]::IsNullOrWhiteSpace($ans)) { $ans = $def }
  }
  return $ans.Trim()
}

# Token guardado por el Panel admin
$token = ""
$cfg = Join-Path $env:APPDATA "LTC Launcher\config.json"
if (Test-Path $cfg) {
  try { $token = (Get-Content $cfg -Raw | ConvertFrom-Json).githubToken } catch {}
}
if ([string]::IsNullOrWhiteSpace($token)) {
  Write-Host ""
  Write-Host "Falta el token de GitHub."
  Write-Host "Ábrelo en el launcher: Panel admin > Info de update > Token de GitHub,"
  Write-Host "guárdalo y vuelve a ejecutar este script."
  Write-Host ""
  Write-Host "Pulsa una tecla para cerrar..."
  [void][System.Console]::ReadKey($true)
  exit 1
}
$env:GITHUB_TOKEN = $token.Trim()

# Versión actual + sugerencia (parche + 1)
$current = (Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json).version
$suggest = $current
if ($current -match '^(\d+)\.(\d+)\.(\d+)$') {
  $suggest = "$($Matches[1]).$($Matches[2]).$([int]$Matches[3] + 1)"
}
Write-Host ""
Write-Host "Versión actual: $current"
$version = Read-Answer "Versión a publicar" $suggest
if ($version -notmatch '^\d+\.\d+\.\d+$') {
  Write-Host "Versión inválida: usa formato X.Y.Z (ej. 1.0.2)."
  Write-Host "Pulsa una tecla para cerrar..."
  [void][System.Console]::ReadKey($true)
  exit 1
}
$notes = Read-Answer "Mensaje del release (notas para los usuarios)" ""
Write-Host ""

if ([string]::IsNullOrWhiteSpace($notes)) {
  node scripts/publish-update.mjs "--version=$version"
} else {
  node scripts/publish-update.mjs "--version=$version" "$notes"
}

Write-Host ""
if ($LASTEXITCODE -eq 0) {
  Write-Host "Listo. Ya puedes cerrar esta ventana."
} else {
  Write-Host "Falló (código $LASTEXITCODE). Revisa el mensaje de arriba."
}
Write-Host "Pulsa una tecla para cerrar..."
try { [void][System.Console]::ReadKey($true) } catch { Start-Sleep -Seconds 180 }
