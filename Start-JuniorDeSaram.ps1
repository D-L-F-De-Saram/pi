$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$linuxDir = (& wsl.exe wslpath -a $PSScriptRoot | Out-String).Trim()
if (-not $linuxDir) { throw 'Could not resolve the checkout in WSL.' }
& wsl.exe --cd $linuxDir docker compose up -d --no-deps junior-de-saram
if ($LASTEXITCODE -ne 0) { throw 'Junior De Saram container did not start.' }
& wsl.exe docker exec -it junior-de-saram node packages/coding-agent/dist/bundle/cli.js --approve --provider google --model gemini-3.7-flash --thinking low --no-builtin-tools --no-context-files --no-skills --skill .agents/skills/de-saram-legal-final-answer/SKILL.md --no-extensions --extension builtin:mcp --extension .pi/extensions/junior-de-saram-context.ts --extension .pi/extensions/de-saram-delivery.ts @args
