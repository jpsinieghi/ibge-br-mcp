param(
  [string]$ProjectId = "fundacao-clube-ai",

  [string]$Region = "us-central1",
  [string]$ServiceName = "ibge-br-mcp",
  [string]$ServiceAccountEmail,
  [string]$Memory = "512Mi",
  [string]$Cpu = "1",
  [int]$MinInstances = 0,
  [int]$MaxInstances = 3,
  [string]$AppVersion = "manual",
  [string]$AllowedOrigin = "*",
  [string]$ApiKey,
  [int]$IbgeTimeoutMs = 30000,
  [switch]$PrivateService,
  [string]$EnvVarsFile,
  [string[]]$SetEnvVars = @(),
  [string[]]$SetSecrets = @()
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Assert-CommandExists {
  param([string]$CommandName)

  if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
    throw "Comando '$CommandName' não encontrado. Instale e autentique o Google Cloud SDK antes de continuar."
  }
}

function Add-Argument {
  param(
    [System.Collections.Generic.List[string]]$ArgsList,
    [string]$Flag,
    [string]$Value
  )

  if (-not [string]::IsNullOrWhiteSpace($Value)) {
    $ArgsList.Add($Flag)
    $ArgsList.Add($Value)
  }
}

function Read-DotEnv {
  param([string]$Path)

  $values = @{}
  if (-not (Test-Path -LiteralPath $Path)) {
    return $values
  }

  foreach ($rawLine in Get-Content -LiteralPath $Path) {
    $line = $rawLine.Trim()
    if (-not $line -or $line.StartsWith("#")) { continue }
    if ($line -notmatch '^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') { continue }
    $name = $Matches[1]
    $value = $Matches[2].Trim()
    if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
      $value = $value.Substring(1, $value.Length - 2)
    } else {
      $value = ($value -replace '\s+#.*$', '').Trim()
    }
    $values[$name] = $value
  }
  return $values
}

Assert-CommandExists "gcloud"

$root = Split-Path -Parent $PSScriptRoot
Push-Location $root

try {
  if ([string]::IsNullOrWhiteSpace($ServiceAccountEmail)) {
    $ServiceAccountEmail = "analise-clube@$ProjectId.iam.gserviceaccount.com"
  }

  Write-Host "Configurando projeto ativo no gcloud..."
  & gcloud config set project $ProjectId | Out-Host

  Write-Host "Alinhando quota project das credenciais locais..."
  & gcloud auth application-default set-quota-project $ProjectId | Out-Host

  Write-Host "Habilitando APIs necessarias..."
  & gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com | Out-Host

  $deployArgs = [System.Collections.Generic.List[string]]::new()
  $envVars = [System.Collections.Generic.List[string]]::new()
  $envVars.Add("APP_VERSION=$AppVersion")
  $envVars.Add("ALLOWED_ORIGIN=$AllowedOrigin")
  $envVars.Add("IBGE_MCP_TIMEOUT_MS=$IbgeTimeoutMs")
  if (-not [string]::IsNullOrWhiteSpace($ApiKey)) {
    $envVars.Add("API_KEY=$ApiKey")
  }

  $dotEnv = Read-DotEnv (Join-Path $root ".env")
  $langfuseDefaults = @{
    LANGFUSE_BASE_URL = "https://cloud.langfuse.com"
    LANGFUSE_TRACING_ENVIRONMENT = $AppVersion
  }
  $secretNames = @($SetSecrets | ForEach-Object { ($_ -split '=', 2)[0] })
  foreach ($name in @("LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "LANGFUSE_BASE_URL", "LANGFUSE_TRACING_ENVIRONMENT")) {
    if ($secretNames -contains $name) { continue }
    $value = [Environment]::GetEnvironmentVariable($name)
    if ([string]::IsNullOrWhiteSpace($value) -and $dotEnv.ContainsKey($name)) {
      $value = [string]$dotEnv[$name]
    }
    if ([string]::IsNullOrWhiteSpace($value) -and $langfuseDefaults.ContainsKey($name)) {
      $value = [string]$langfuseDefaults[$name]
    }
    if (-not [string]::IsNullOrWhiteSpace($value)) {
      $envVars.Add("$name=$value")
    }
  }
  foreach ($item in $SetEnvVars) {
    if (-not [string]::IsNullOrWhiteSpace($item)) {
      $envVars.Add($item)
    }
  }

  foreach ($arg in @(
    "run", "deploy", $ServiceName,
    "--source", ".",
    "--project", $ProjectId,
    "--region", $Region,
    "--platform", "managed",
    "--port", "8080",
    "--cpu", $Cpu,
    "--memory", $Memory,
    "--min-instances", "$MinInstances",
    "--max-instances", "$MaxInstances",
    "--service-account", $ServiceAccountEmail,
    "--quiet"
  )) {
    $deployArgs.Add([string]$arg)
  }

  Add-Argument -ArgsList $deployArgs -Flag "--set-env-vars" -Value ($envVars -join ",")

  if ($PrivateService) {
    $deployArgs.Add("--no-allow-unauthenticated")
  } else {
    $deployArgs.Add("--allow-unauthenticated")
  }

  if ($EnvVarsFile) {
    Add-Argument -ArgsList $deployArgs -Flag "--env-vars-file" -Value $EnvVarsFile
  }

  if ($SetSecrets.Count -gt 0) {
    Add-Argument -ArgsList $deployArgs -Flag "--set-secrets" -Value ($SetSecrets -join ",")
  }

  Write-Host "Iniciando deploy no Cloud Run..."
  & gcloud @deployArgs | Out-Host
  if ($LASTEXITCODE -ne 0) {
    throw "O deploy no Cloud Run falhou."
  }

  $serviceUrl = & gcloud run services describe $ServiceName `
    --project $ProjectId `
    --region $Region `
    --format "value(status.url)"
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($serviceUrl)) {
    throw "Nao foi possivel obter a URL do servico apos o deploy."
  }
  $serviceUrl = $serviceUrl.Trim()

  Write-Host ""
  Write-Host "Deploy concluído."
  Write-Host "URL base : $serviceUrl"
  Write-Host "MCP endpoint: $serviceUrl/mcp"
  Write-Host "Health check: $serviceUrl/health"
}
finally {
  Pop-Location
}
