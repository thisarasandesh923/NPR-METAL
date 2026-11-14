<#
.SYNOPSIS
  Performs an offline compressed PostgreSQL backup (pg_dump -Fc) of the NPR Metal Crusher database.
.DESCRIPTION
  Safely extracts database schema and data into a timestamped, encrypted or compressed custom format (.dump).
  Requires MIGRATION_DATABASE_URL or pg_dump connection string.
#>

param(
  [string]$DatabaseUrl = $env:MIGRATION_DATABASE_URL,
  [string]$OutputDir = "./backups"
)

if (-not $DatabaseUrl) {
  Write-Error "DatabaseUrl parameter or MIGRATION_DATABASE_URL environment variable is required."
  exit 1
}

if (-not (Test-Path $OutputDir)) {
  New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

$timestamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
$dumpFile = Join-Path $OutputDir "npr_crusher_backup_$timestamp.dump"

Write-Host "Starting NPR Metal Crusher database backup..." -ForegroundColor Cyan
Write-Host "Target output file: $dumpFile" -ForegroundColor Yellow

# Execute pg_dump with custom format, blobs, and schema
# -Fc : Custom compressed archive format (required for pg_restore)
# -v  : Verbose
# --no-owner --no-privileges : Facilitates migration/restore across distinct role environments
$dumpCmd = "pg_dump `"$DatabaseUrl`" -Fc -v --no-owner --no-privileges -f `"$dumpFile`""
Invoke-Expression $dumpCmd

if ($LASTEXITCODE -eq 0 -and (Test-Path $dumpFile)) {
  $fileSize = (Get-Item $dumpFile).Length / 1KB
  Write-Host "Backup completed successfully ($([Math]::Round($fileSize, 2)) KB): $dumpFile" -ForegroundColor Green
} else {
  Write-Error "pg_dump failed with exit code $LASTEXITCODE."
  exit $LASTEXITCODE
}
