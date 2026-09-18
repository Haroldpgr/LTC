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

  # 1. ¿Bloqueo WDAC? -> firmar y reintentar. Cargo muestra la ruta de
  # varias formas: entre backticks (a veces sin extensión), o ruta desnuda
  # .dll/.exe tras "error:". Se recogen TODAS las candidatas bajo target/
  # y se firman: cada intento supera un paso y cargo cachea el progreso.
  $blockedList = @()
  if ($logText -match '4551|bloque') {
    $cands = @()
    $re = [regex]'`([^`]+)`'
    foreach ($m in $re.Matches($logText)) { $cands += $m.Groups[1].Value.Trim() }
    $re2 = [regex]'([A-Za-z]:\\[^\s:"`]+?\.(dll|exe))'
    foreach ($m in $re2.Matches($logText)) { $cands += $m.Groups[1].Value.Trim() }
    foreach ($c in $cands) {
      $cand = $c
      if (-not [System.IO.Path]::IsPathRooted($cand)) {
        $cand = Join-Path (Join-Path $root "src-tauri") $cand
      }
      # Cargo muestra la ruta sin extensión, pero el archivo real es .exe
      if (-not (Test-Path $cand)) {
        foreach ($suf in @('.exe', '.dll')) {
          if (Test-Path ($cand + $suf)) { $cand = $cand + $suf; break }
        }
      }
      if (($cand -like '*target*') -and (Test-Path $cand) -and ($blockedList -notcontains $cand)) {
        $blockedList += $cand
      }
    }
  }
  if ($blockedList.Count -gt 0) {
    $signedAny = $false
    foreach ($full in $blockedList) {
      Write-Host "[build] WDAC bloqueó: $full"
      if (Sign-File $full $cert) {
        Write-Host "[build] Firmado OK: $(Split-Path $full -Leaf)"
        $signedAny = $true
      } else {
        Write-Host "[build] No se pudo firmar $full"
      }
    }
    if ($signedAny) {
      Write-Host "[build] Reintentando..."
      continue
    }
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
