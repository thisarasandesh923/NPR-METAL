#!/usr/bin/env pwsh
<#
.SYNOPSIS
Stops the isolated local demo PostgreSQL container (npr-local-demo-pg).
Preserves demo data for the next run unless -Remove is explicitly specified.
#>
[CmdletBinding()]
param(
  [switch]$Remove
)

$ErrorActionPreference = "SilentlyContinue"
$ContainerName = "npr-local-demo-pg"

if ($Remove) {
  Write-Host "Stopping & removing isolated local demo container ($ContainerName)..."
  docker rm -f $ContainerName | Out-Null
  Write-Host "Local demo database container removed. Demo data has been cleaned up."
} else {
  Write-Host "Stopping isolated local demo container ($ContainerName)..."
  docker stop $ContainerName | Out-Null
  Write-Host "Local demo database stopped. Demo data preserved for next run."
  Write-Host "To completely remove the container and start fresh, run: .\stop-local-demo.ps1 -Remove"
}
