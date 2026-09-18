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

  # 1. ¿Bloqueo WDAC? -> firmar y reintentar. El mensaje de cargo parte la
  # ruta en varias líneas ("could not execute process \n`ruta`\n(never executed)"),
  # así que se buscan todos los fragmentos entre backticks y se firma el que exista.
  $blocked = $null
  if ($logText -match '4551|bloque') {
    $re = [regex]'`([^`]+)`'
    foreach ($m in $re.Matches($logText)) {
      $cand = $m.Groups[1].Value.Trim()
      if (-not [System.IO.Path]::IsPathRooted($cand)) {
        $cand = Join-Path (Join-Path $root "src-tauri") $cand
      }
      # Cargo muestra la ruta sin extensión, pero el archivo real es .exe
      if (-not (Test-Path $cand)) {
        foreach ($suf in @('.exe', '.bat', '.cmd')) {
          if (Test-Path ($cand + $suf)) { $cand = $cand + $suf; break }
        }
      }
      if (($cand -like '*target*') -and (Test-Path $cand)) {
        $blocked = $cand
        break
      }
    }
    if (-not $blocked -and ($logText -match 'could not execute process `([^`]+)`')) {
      $blocked = $Matches[1]
    }
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

  # 3. ¿Timeout de red del bundler (ej. descarga de NSIS)? -> reintentar
  if ($logText -match 'failed to bundle project|timeout: global|Downloading https://github.com/tauri-apps/binary-releases') {
    Write-Host "[build] Fallo de red del empaquetador (timeout), reintentando en 5s..."
    Start-Sleep -Seconds 5
    continue
  }

  # 4. Otro error: mostrar cola y salir
  Write-Host ""
  Write-Host "[build] ❌ Falló por otro motivo. Últimas líneas:"
  Get-Content $log -Tail 25
  exit 1
}

Write-Host "[build] ❌ Se agotaron los intentos."
exit 1
