@echo off
setlocal enabledelayedexpansion

if "%~1"=="" goto :usage
if "%~2"=="" goto :usage

set "ENV_NAME=%~1"
set "PROJECT_ID=%~2"
set "THIRD_ARG=%~3"
set "FOURTH_ARG=%~4"
set "FIFTH_ARG=%~5"
set "PYTHON_PATH=%~6"
set "API_KEY=%~7"

set "REGION="
if not "%FOURTH_ARG%"=="" (
  set "REGION=%FOURTH_ARG%"
) else if not "%THIRD_ARG%"=="" (
  set "REGION=%THIRD_ARG%"
)
if "%REGION%"=="" set "REGION=us-central1"

if not "%PYTHON_PATH%"=="" (
  set "CLOUDSDK_PYTHON=%PYTHON_PATH%"
)

if /I "%ENV_NAME%"=="dev" (
  set "SERVICE_NAME=ibge-br-mcp-dev"
  set "APP_VERSION=dev"
  set "FINAL_API_KEY="
) else if /I "%ENV_NAME%"=="homolog" (
  set "SERVICE_NAME=ibge-br-mcp-homolog"
  set "APP_VERSION=homolog"
  set "FINAL_API_KEY=%API_KEY%"
) else if /I "%ENV_NAME%"=="prod" (
  set "SERVICE_NAME=ibge-br-mcp-prod"
  set "APP_VERSION=prod"
  set "FINAL_API_KEY=%API_KEY%"
) else (
  echo Ambiente invalido: %ENV_NAME%
  echo Use: dev, homolog ou prod.
  exit /b 1
)

echo.
echo Ambiente: %ENV_NAME%
echo Service: %SERVICE_NAME%
echo Projeto: %PROJECT_ID%
echo Regiao: %REGION%
echo.

call "%~dp0deploy-cloud-run.cmd" "%PROJECT_ID%" "%REGION%" "%FINAL_API_KEY%" "%PYTHON_PATH%" "%SERVICE_NAME%" "%APP_VERSION%"
if errorlevel 1 exit /b 1

echo.
echo Deploy de %ENV_NAME% concluido.
endlocal
exit /b 0

:usage
echo Uso recomendado:
echo   deploy-env.cmd ENV_NAME PROJECT_ID [REGION]
echo.
echo Exemplos:
echo   deploy-env.cmd dev fundacao-clube-ai
echo   deploy-env.cmd dev fundacao-clube-ai us-central1
echo   deploy-env.cmd homolog fundacao-clube-ai us-central1 "" MINHA_CHAVE
echo.
echo Formato antigo ainda aceito:
echo   deploy-env.cmd dev fundacao-clube-ai raw_doacoes us-central1 us-central1 python.exe "" donations
exit /b 1
