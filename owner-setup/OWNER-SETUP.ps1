param(
    [Parameter(Mandatory = $true)] [string] $Project,
    [switch] $Replace,
    [switch] $EnableMakeSync,
    [switch] $EnableAi
)
$ErrorActionPreference = 'Stop'
$taskNode = Get-Command node -ErrorAction SilentlyContinue
if ($taskNode) {
    $taskNodePath = $taskNode.Source
} else {
    $taskNodePath = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
}
if (-not (Test-Path -LiteralPath $taskNodePath -PathType Leaf)) {
    throw 'Node.js 22 or newer is required. No configuration was written.'
}
$taskArguments = @((Join-Path $PSScriptRoot 'configure-owner.mjs'), '--project', $Project)
if ($Replace) { $taskArguments += '--replace' }
if ($EnableMakeSync) { $taskArguments += '--enable-make-sync' }
if ($EnableAi) { $taskArguments += '--enable-ai' }
& $taskNodePath @taskArguments
exit $LASTEXITCODE
