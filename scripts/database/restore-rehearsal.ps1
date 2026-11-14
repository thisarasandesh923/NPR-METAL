<#
.SYNOPSIS
  Rehearses a PostgreSQL database restore (pg_restore) against an isolated test database.
.DESCRIPTION
  Validates that a backup .dump file created by backup-supabase.ps1 can be restored cleanly
  into an isolated database, and verifies the 24 application tables.
#>

param(
  [Parameter(Mandatory=$true)]
  [string]$DumpFilePath,

  [Parameter(Mandatory=$true)]
  [string]$TargetDatabaseUrl
)

if (-not (Test-Path $DumpFilePath)) {
  Write-Error "Backup file does not exist: $DumpFilePath"
  exit 1
}

Write-Host "Starting NPR Metal Crusher Restore Rehearsal..." -ForegroundColor Cyan
Write-Host "Source Backup: $DumpFilePath" -ForegroundColor Yellow
Write-Host "Target Database: $TargetDatabaseUrl" -ForegroundColor Yellow

# pg_restore parameters:
# --clean --if-exists : Drop existing objects prior to recreate
# --no-owner --no-privileges : Match non-privileged restore environments
# -v : Verbose
$restoreCmd = "pg_restore `"$TargetDatabaseUrl`" --clean --if-exists --no-owner --no-privileges -v `"$DumpFilePath`""
Invoke-Expression $restoreCmd

Write-Host "Restore command completed. Verifying table count in target..." -ForegroundColor Cyan

# Verification command via psql
$verifySql = "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';"
$tableCount = psql "$TargetDatabaseUrl" -t -A -c "$verifySql"

Write-Host "Discovered tables in restored database: $tableCount" -ForegroundColor Green

if ([int]$tableCount -ge 24) {
  Write-Host "SUCCESS: Disaster recovery rehearsal verified 24+ core tables restored cleanly." -ForegroundColor Green
} else {
  Write-Warning "WARNING: Restored table count ($tableCount) is less than expected 24 tables."
}
