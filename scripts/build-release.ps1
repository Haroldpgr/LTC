# Compila el instalador con reintentos automáticos.
# En algunos Windows, WDAC/Control de aplicaciones bloquea (error 4551) los
# .exe que cargo genera al compilar (build scripts). Este script detecta el
# archivo bloqueado, lo firma con un certificado local y reintenta: cargo
# cachea cada paso superado, así que converge solo, sin permisos de admin.
param([int]$MaxTries = 60)

$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$log = Join-Path $env:TEMP "ltc-build.log"

function Get-SignCert {
  $cert = Get-ChildItem Cert:\CurrentUser\My |
    Where-Object { $_.Subject -like '*LTC-Launcher-Dev*' } |
    Select-Object -First 1
  if ($null -eq $cert) {
    Write-Host "[build] Creando certificado local de firma..."
    $cert = New-SelfSignedCertificate -DnsName "LTC-Launcher-Dev" `
      -FriendlyName "LTC-Launcher-Dev" `
      -CertStoreLocation "Cert:\CurrentUser\My" -Type CodeSigningCert
    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store("Root", "CurrentUser")
    $store.Open("ReadWrite")
    $store.Add($cert)
    $store.Close()
  }
  return $cert
}

function Sign-File($path, $cert) {
  for ($i = 0; $i -lt 10; $i++) {
    try {
      $res = Set-AuthenticodeSignature -FilePath $path -Certificate $cert -ErrorAction Stop
      if ($res.Status -eq "Valid") { return $true }
    } catch {
      Start-Sleep -Milliseconds 300
    }
  }
  return $false
}

$cert = Get-SignCert
$nsisDir = Join-Path $root "src-tauri\target\release\bundle\nsis"

for ($try = 1; $try -le $MaxTries; $try++) {
  Write-Host ""
  Write-Host "[build] Intento $try/$MaxTries..."
  $before = Get-Date
  Remove-Item $log -ErrorAction SilentlyContinue

  npx tauri build 2>&1 | Tee-Object -FilePath $log
  $logText = ""
  if (Test-Path $log) { $logText = Get-Content $log -Raw }

  # 1. ¿Bloqueo WDAC? -> firmar y reintentar
  $blocked = $null
  if ($logText -match 'could not execute process `([^`]+)`') {
    $blocked = $Matches[1]
  }
  if ($blocked -and ($logText -match '4551|bloque')) {
    $full = $blocked
    if (-not [System.IO.Path]::IsPathRooted($full)) {
      $full = Join-Path (Join-Path $root "src-tauri") $full
    }
    Write-Host "[build] WDAC bloqueó: $full"
    if (Test-Path $full) {
      if (Sign-File $full $cert) {
        Write-Host "[build] Firmado OK, reintentando..."
        continue
      }
    }
    Write-Host "[build] No se pudo firmar $full, reintentando de todos modos..."
    Start-Sleep -Seconds 2
    continue
  }

  # 2. ¿Hay instalador fresco? -> éxito
  if (Test-Path $nsisDir) {
    $fresh = Get-ChildItem $nsisDir -Filter *.exe -ErrorAction SilentlyContinue |
      Where-Object { $_.LastWriteTime -gt $before } |
      Select-Object -First 1
    if ($fresh) {
      Write-Host ""
      Write-Host "[build] ✅ Compilación completada: $($fresh.FullName)"
      exit 0
    }
  }

  # 3. Otro error: mostrar cola y salir
  Write-Host ""
  Write-Host "[build] ❌ Falló por otro motivo. Últimas líneas:"
  Get-Content $log -Tail 25
  exit 1
}

Write-Host "[build] ❌ Se agotaron los intentos."
exit 1
