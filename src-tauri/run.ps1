param(
    [Parameter(Mandatory=$true)]
    [string]$ExePath,
    [Parameter(ValueFromRemainingArguments=$true)]
    [string[]]$AppArgs
)

Start-Sleep -Milliseconds 300

$cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -like '*LTC-Launcher-Dev*' } | Select-Object -First 1
if ($null -ne $cert) {
    Set-AuthenticodeSignature -FilePath $ExePath -Certificate $cert -ErrorAction SilentlyContinue | Out-Null
}

& $ExePath @AppArgs
exit $LASTEXITCODE
