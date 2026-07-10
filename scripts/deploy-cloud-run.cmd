@echo off
setlocal enabledelayedexpansion

if "%~1"=="" goto :usage

set "PROJECT_ID=%~1"
set "SECOND_ARG=%~2"
set "THIRD_ARG=%~3"
set "FOURTH_ARG=%~4"
set "FIFTH_ARG=%~5"
set "SIXTH_ARG=%~6"
set "SEVENTH_ARG=%~7"
set "EIGHTH_ARG=%~8"
set "NINTH_ARG=%~9"

set "REGION="
set "API_KEY="
set "PYTHON_PATH="
set "SERVICE_NAME="
set "APP_VERSION="

if /I "%SECOND_ARG%"=="us-central1" (
  set "REGION=%SECOND_ARG%"
  set "API_KEY=%THIRD_ARG%"
  set "PYTHON_PATH=%FOURTH_ARG%"
  set "SERVICE_NAME=%FIFTH_ARG%"
  set "APP_VERSION=%SIXTH_ARG%"
) else (
  set "REGION=%THIRD_ARG%"
  set "API_KEY=%FIFTH_ARG%"
  set "PYTHON_PATH=%SIXTH_ARG%"
  set "SERVICE_NAME=%SEVENTH_ARG%"
  set "APP_VERSION=%NINTH_ARG%"
)

if "%REGION%"=="" set "REGION=us-central1"
if "%SERVICE_NAME%"=="" set "SERVICE_NAME=ibge-br-mcp"
if "%APP_VERSION%"=="" set "APP_VERSION=manual"

if not "%PYTHON_PATH%"=="" (
  set "CLOUDSDK_PYTHON=%PYTHON_PATH%"
)

set "SERVICE_ACCOUNT_EMAIL=analise-clube@%PROJECT_ID%.iam.gserviceaccount.com"
set "ENV_VARS=APP_VERSION=%APP_VERSION%,ALLOWED_ORIGIN=*,IBGE_MCP_TIMEOUT_MS=30000"
if not "%API_KEY%"=="" set "ENV_VARS=%ENV_VARS%,API_KEY=%API_KEY%"

echo Configurando projeto ativo no gcloud...
call gcloud.cmd config set project "%PROJECT_ID%"
if errorlevel 1 goto :fail

echo Alinhando quota project das credenciais locais...
call gcloud.cmd auth application-default set-quota-project "%PROJECT_ID%"
if errorlevel 1 (
  echo Aviso: nao foi possivel alinhar o quota project do Application Default Credentials.
)

echo Habilitando APIs necessarias...
call gcloud.cmd services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
if errorlevel 1 goto :fail

echo Iniciando deploy no Cloud Run...
call gcloud.cmd run deploy "%SERVICE_NAME%" --source . --project "%PROJECT_ID%" --region "%REGION%" --platform managed --port 8080 --cpu 1 --memory 512Mi --min-instances 0 --max-instances 3 --service-account "%SERVICE_ACCOUNT_EMAIL%" --set-env-vars "%ENV_VARS%" --allow-unauthenticated --quiet
if errorlevel 1 goto :fail

echo Obtendo URL publicada...
for /f "usebackq delims=" %%A in (`gcloud.cmd run services describe "%SERVICE_NAME%" --project "%PROJECT_ID%" --region "%REGION%" --format "value(status.url)"`) do (
  set "SERVICE_URL=%%A"
)

if not defined SERVICE_URL (
  echo Nao foi possivel obter a URL do servico apos o deploy.
  goto :fail
)

echo.
echo Deploy concluido.
echo URL base : !SERVICE_URL!
echo MCP endpoint: !SERVICE_URL!/mcp
echo Health check: !SERVICE_URL!/health
endlocal
exit /b 0

:usage
echo Uso recomendado:
echo   deploy-cloud-run.cmd PROJECT_ID [REGION] [API_KEY] [PYTHON_PATH] [SERVICE_NAME] [APP_VERSION]
echo.
echo Exemplos:
echo   deploy-cloud-run.cmd fundacao-clube-ai us-central1 "" python.exe ibge-br-mcp-dev dev
echo.
echo Formato antigo ainda aceito:
echo   deploy-cloud-run.cmd fundacao-clube-ai raw_doacoes us-central1 us-central1 "" python.exe ibge-br-mcp-dev donations dev
exit /b 1

:fail
echo.
echo O deploy falhou. Veja a mensagem acima para identificar a etapa.
endlocal
exit /b 1
