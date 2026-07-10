param(
  [string]$ProjectId = "fundacao-clube-ai",
  [string]$Region = "us-central1",
  [Parameter(Mandatory = $true)]
  [string]$ServiceName
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Assert-CommandExists {
  param([string]$CommandName)

  if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
    throw "Comando '$CommandName' não encontrado. Instale e autentique o Google Cloud SDK antes de continuar."
  }
}

Assert-CommandExists "gcloud"

Write-Host "Configurando projeto ativo no gcloud..."
& gcloud config set project $ProjectId | Out-Host

Write-Host "Verificando se o servico existe..."
& gcloud run services describe $ServiceName --region $Region > $null 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host "Servico nao encontrado: $ServiceName"
  exit 0
}

Write-Host "Removendo servico do Cloud Run..."
& gcloud run services delete $ServiceName --region $Region --quiet | Out-Host

Write-Host ""
Write-Host "Remocao concluida."
Write-Host "Servico removido: $ServiceName"

