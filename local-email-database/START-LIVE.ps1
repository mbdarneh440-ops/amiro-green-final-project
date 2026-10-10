param(
    [Parameter(Mandatory = $true)] [string] $Project,
    [string] $Out,
    [switch] $Once
)
$ErrorActionPreference = 'Stop'
$taskNode = Get-Command node -ErrorAction SilentlyContinue
if ($taskNode) {
    $taskNodePath = $taskNode.Source
} else {
    $taskNodePath = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
}
if (-not (Test-Path -LiteralPath $taskNodePath -PathType Leaf)) {
    throw 'Node.js 22 or newer is required. No inbox connection was started.'
}
$taskArguments = @((Join-Path $PSScriptRoot 'start-live.mjs'), '--project', $Project)
if ($Out) { $taskArguments += @('--out', $Out) }
if ($Once) { $taskArguments += '--once' }
& $taskNodePath @taskArguments
exit $LASTEXITCODE
