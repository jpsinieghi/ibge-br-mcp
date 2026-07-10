@echo off
setlocal

if "%~1"=="" goto :usage
if "%~2"=="" goto :usage

set "ENV_NAME=%~1"
set "PROJECT_ID=%~2"
set "REGION=%~3"

if "%REGION%"=="" set "REGION=us-central1"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0remove-env.ps1" ^
  -Environment "%ENV_NAME%" ^
  -ProjectId "%PROJECT_ID%" ^
  -Region "%REGION%"

exit /b %errorlevel%

:usage
echo Uso:
echo   remove-env.cmd ENV_NAME PROJECT_ID [REGION]
echo.
echo Exemplos:
echo   remove-env.cmd dev fundacao-clube-ai us-central1
echo   remove-env.cmd homolog fundacao-clube-ai us-central1
echo   remove-env.cmd prod fundacao-clube-ai us-central1
exit /b 1
