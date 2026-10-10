@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set "TASK_NODE="
for /f "delims=" %%N in ('where node.exe 2^>nul') do if not defined TASK_NODE set "TASK_NODE=%%N"
if not defined TASK_NODE if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "TASK_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not defined TASK_NODE (
  echo נדרשת גרסת Node.js 22.13 ומעלה.
  pause
  exit /b 1
)
if /I "%~1"=="--check" (
  "%TASK_NODE%" --check "%~dp0source\scripts\start-local.mjs"
  exit /b
)
"%TASK_NODE%" "%~dp0source\scripts\start-local.mjs"  %*
set "TASK_EXIT=%ERRORLEVEL%"
if not "%TASK_EXIT%"=="0" (
  echo יש לקרוא את הודעת השגיאה ואת מדריך ההפעלה המצורף.
  pause
)
exit /b %TASK_EXIT%
