$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$linuxDir = (& wsl.exe wslpath -a $PSScriptRoot | Out-String).Trim()
if (-not $linuxDir) { throw 'Could not resolve the checkout in WSL.' }
& wsl.exe --cd $linuxDir docker compose up -d --no-deps junior-de-saram
if ($LASTEXITCODE -ne 0) { throw 'Junior De Saram container did not start.' }
if (Select-String -LiteralPath (Join-Path $PSScriptRoot '.env') -Pattern '^DESARAM_TYPESENSE_URL=http://127\.0\.0\.1:18108\s*$' -Quiet) {
  $sshUser = (& wsl.exe id -un | Out-String).Trim()
  & wsl.exe -u root --cd $linuxDir sh ./Connect-DeSaramSources.sh $sshUser
  if ($LASTEXITCODE -ne 0) { throw 'Could not connect De Saram indexed sources.' }
}
& wsl.exe docker exec -it junior-de-saram node junior-de-saram/cli.mjs @args
