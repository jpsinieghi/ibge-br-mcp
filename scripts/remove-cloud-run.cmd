@echo off
setlocal

if "%~1"=="" goto :usage

set "PROJECT_ID=%~1"
set "REGION=%~2"
set "SERVICE_NAME=%~3"

if "%REGION%"=="" set "REGION=us-central1"
if "%SERVICE_NAME%"=="" (
  echo Informe o nome do servico no parametro 3.
  goto :usage
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0remove-cloud-run.ps1" ^
  -ProjectId "%PROJECT_ID%" ^
  -Region "%REGION%" ^
  -ServiceName "%SERVICE_NAME%"

exit /b %errorlevel%

:usage
echo Uso:
echo   remove-cloud-run.cmd PROJECT_ID [REGION] SERVICE_NAME
echo.
echo Exemplo:
echo   remove-cloud-run.cmd fundacao-clube-ai us-central1 ibge-br-mcp-dev
exit /b 1

