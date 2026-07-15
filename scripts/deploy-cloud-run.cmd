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
set "LANGFUSE_PUBLIC_KEY=%LANGFUSE_PUBLIC_KEY%"
set "LANGFUSE_SECRET_KEY=%LANGFUSE_SECRET_KEY%"
set "LANGFUSE_BASE_URL=%LANGFUSE_BASE_URL%"
set "LANGFUSE_TRACING_ENVIRONMENT=%LANGFUSE_TRACING_ENVIRONMENT%"

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

call gcloud.cmd run services describe "%SERVICE_NAME%" --project "%PROJECT_ID%" --region "%REGION%" >nul 2>nul
if not errorlevel 1 (
  echo Verificando variaveis Langfuse atuais no servico...
  if "%LANGFUSE_PUBLIC_KEY%"=="" call :loadExistingServiceEnvVar LANGFUSE_PUBLIC_KEY
  if "%LANGFUSE_SECRET_KEY%"=="" call :loadExistingServiceEnvVar LANGFUSE_SECRET_KEY
  if "%LANGFUSE_BASE_URL%"=="" call :loadExistingServiceEnvVar LANGFUSE_BASE_URL
  if "%LANGFUSE_TRACING_ENVIRONMENT%"=="" call :loadExistingServiceEnvVar LANGFUSE_TRACING_ENVIRONMENT
)

set "DEPLOY_ENV_FILE=%TEMP%\%SERVICE_NAME%-env-%RANDOM%-%RANDOM%.json"
echo Preparando variaveis do Cloud Run a partir do .env...
call node "%~dp0build-cloud-run-env.mjs" --output "%DEPLOY_ENV_FILE%" --env-file ".env" --app-version "%APP_VERSION%" --allowed-origin "*" --ibge-timeout-ms "30000" --api-key "%API_KEY%"
if errorlevel 1 goto :fail

echo Iniciando deploy no Cloud Run...
call gcloud.cmd run deploy "%SERVICE_NAME%" --source . --project "%PROJECT_ID%" --region "%REGION%" --platform managed --port 8080 --cpu 1 --memory 512Mi --min-instances 0 --max-instances 3 --service-account "%SERVICE_ACCOUNT_EMAIL%" --env-vars-file "%DEPLOY_ENV_FILE%" --allow-unauthenticated --quiet
if errorlevel 1 goto :fail

call :cleanupDeployEnvFile

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
call :cleanupDeployEnvFile
endlocal
exit /b 0

:loadExistingServiceEnvVar
set "TARGET_ENV_NAME=%~1"
set "RESOLVED_ENV_VALUE="
for /f "usebackq delims=" %%A in (`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'SilentlyContinue'; $service = gcloud.cmd run services describe '%SERVICE_NAME%' --project '%PROJECT_ID%' --region '%REGION%' --format json 2>$null | ConvertFrom-Json; if ($service.spec.template.spec.containers) { $containers = $service.spec.template.spec.containers } elseif ($service.template.containers) { $containers = $service.template.containers }; if ($containers.Count -gt 0) { $item = $containers[0].env | Where-Object { $_.name -eq '%TARGET_ENV_NAME%' } | Select-Object -First 1; if ($item) { [Console]::Write($item.value) } }"`) do (
  set "RESOLVED_ENV_VALUE=%%A"
)
if defined RESOLVED_ENV_VALUE (
  set "%TARGET_ENV_NAME%=%RESOLVED_ENV_VALUE%"
  echo Variavel %TARGET_ENV_NAME% preservada a partir do servico atual.
)
goto :eof

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
call :cleanupDeployEnvFile
endlocal
exit /b 1

:cleanupDeployEnvFile
if defined DEPLOY_ENV_FILE if exist "%DEPLOY_ENV_FILE%" del /q "%DEPLOY_ENV_FILE%" >nul 2>nul
goto :eof
