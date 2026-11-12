#!/usr/bin/env pwsh
$ErrorActionPreference = "SilentlyContinue"
Write-Host "Stopping & removing isolated local demo PostgreSQL container (npr-local-demo-pg)..."
docker rm -f npr-local-demo-pg | Out-Null
Write-Host "Local demo database cleaned up. Close the dev server terminal windows if still open."

