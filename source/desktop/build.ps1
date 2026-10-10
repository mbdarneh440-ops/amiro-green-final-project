$ErrorActionPreference='Stop'
$project=Split-Path -Parent $PSScriptRoot
$compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
Push-Location $project
try {
 & $compiler /nologo /target:winexe /platform:x64 /optimize+ /codepage:65001 /out:ורדיה.exe /win32icon:desktop\wardiya.ico /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll /reference:Microsoft.Web.WebView2.Core.dll /reference:Microsoft.Web.WebView2.WinForms.dll (Join-Path $PSScriptRoot 'Wardiya.cs')
 if($LASTEXITCODE -ne 0){throw 'בניית היישום נכשלה'}
} finally {Pop-Location}
