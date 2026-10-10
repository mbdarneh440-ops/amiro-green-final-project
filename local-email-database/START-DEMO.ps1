$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$taskNode = Get-Command node -ErrorAction SilentlyContinue
if ($taskNode) {
    $taskNodePath = $taskNode.Source
} else {
    $taskNodePath = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
}
if (-not (Test-Path -LiteralPath $taskNodePath -PathType Leaf)) {
    Write-Host 'Node.js 20 or newer is required. No inbox connection was started.'
    Read-Host 'Press Enter to close'
    exit 1
}
& $taskNodePath (Join-Path $PSScriptRoot 'mirror.mjs') --demo --input (Join-Path $PSScriptRoot 'demo-records.json') --out (Join-Path $PSScriptRoot 'data-demo')
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Review the message above. Existing JSON/CSV files were kept.'
    Read-Host 'Press Enter to close'
    exit $LASTEXITCODE
}
Write-Host 'Demo files are ready in data-demo. No real email was read or sent.'
Read-Host 'Press Enter to close'
