@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set "WARDIYA_NODE="
for /f "delims=" %%N in ('where node.exe 2^>nul') do if not defined WARDIYA_NODE set "WARDIYA_NODE=%%N"
if not defined WARDIYA_NODE if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "WARDIYA_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not defined WARDIYA_NODE (
  echo לא נמצא Node.js. יש להתקין גרסה 22.13 ומעלה ולפתוח שוב.
  pause
  exit /b 1
)
"%WARDIYA_NODE%" "%~dp0scripts\start-local.mjs" %*
if errorlevel 1 (
  echo.
  echo ההפעלה לא הושלמה. יש לצלם את ההודעה שמעל ולבקש עזרה.
  pause
  exit /b 1
)
endlocal
