param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("dev", "homolog", "prod")]
  [string]$Environment,

  [string]$ProjectId = "fundacao-clube-ai",
  [string]$Region = "us-central1",
  [string]$ApiKey,
  [string]$AllowedOrigin = "*",
  [string]$ServiceAccountEmail,
  [int]$IbgeTimeoutMs = 30000
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

switch ($Environment.ToLowerInvariant()) {
  "dev" {
    $serviceName = "ibge-br-mcp-dev"
    $appVersion = "dev"
    $finalApiKey = $null
  }
  "homolog" {
    $serviceName = "ibge-br-mcp-homolog"
    $appVersion = "homolog"
    $finalApiKey = $ApiKey
  }
  "prod" {
    $serviceName = "ibge-br-mcp-prod"
    $appVersion = "prod"
    $finalApiKey = $ApiKey
  }
  default {
    throw "Ambiente invalido: $Environment"
  }
}

$deployScript = Join-Path $PSScriptRoot "deploy-cloud-run.ps1"

& $deployScript `
  -ProjectId $ProjectId `
  -Region $Region `
  -ServiceName $serviceName `
  -ServiceAccountEmail $ServiceAccountEmail `
  -AppVersion $appVersion `
  -AllowedOrigin $AllowedOrigin `
  -ApiKey $finalApiKey `
  -IbgeTimeoutMs $IbgeTimeoutMs
