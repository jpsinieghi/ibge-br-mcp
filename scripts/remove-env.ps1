param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("dev", "homolog", "prod")]
  [string]$Environment,

  [string]$ProjectId = "fundacao-clube-ai",
  [string]$Region = "us-central1"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

switch ($Environment.ToLowerInvariant()) {
  "dev" { $serviceName = "ibge-br-mcp-dev" }
  "homolog" { $serviceName = "ibge-br-mcp-homolog" }
  "prod" { $serviceName = "ibge-br-mcp-prod" }
  default { throw "Ambiente invalido: $Environment" }
}

$removeScript = Join-Path $PSScriptRoot "remove-cloud-run.ps1"

& $removeScript `
  -ProjectId $ProjectId `
  -Region $Region `
  -ServiceName $serviceName

