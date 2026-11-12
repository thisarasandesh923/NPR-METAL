#!/usr/bin/env pwsh
<#
.SYNOPSIS
Starts an isolated local PostgreSQL 17 Docker database, runs all migrations 001-008,
provisions npr_app_user, seeds clearly fictional LOCAL DEMO accounts/data, and launches
backend + Vite dev servers against localhost ONLY (never touches backend/.env or Supabase).
#>
$ErrorActionPreference = "Stop"

$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Push-Location $RootDir

try {
  Write-Host "1. Starting isolated local Docker PostgreSQL 17 on 127.0.0.1:55432..."
  docker rm -f npr-local-demo-pg 2>$null | Out-Null
  docker run -d `
    --name npr-local-demo-pg `
    -e POSTGRES_USER=postgres `
    -e POSTGRES_PASSWORD=postgres `
    -e POSTGRES_DB=npr_test_db `
    -p 127.0.0.1:55432:5432 `
    postgres:17-alpine | Out-Null

  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    docker exec npr-local-demo-pg psql -U postgres -d npr_test_db -c "SELECT 1" *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) {
    throw "Local PostgreSQL 17 failed to initialize within 30 seconds."
  }

  Write-Host "2. Creating Supabase compatibility roles (anon/authenticated) locally..."
  docker exec npr-local-demo-pg psql -U postgres -d npr_test_db -c "DO `$`$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; END `$`$;" | Out-Null

  $LocalAdminUrl = "postgres://postgres:postgres@127.0.0.1:55432/npr_test_db"
  $LocalAppUrl = "postgres://npr_app_user:test_only_app_password_2b2@127.0.0.1:55432/npr_test_db"

  Write-Host "3. Applying forward-only SQL migrations 001-008..."
  $env:MIGRATION_DATABASE_URL = $LocalAdminUrl
  $env:DATABASE_URL = $LocalAdminUrl
  npm --prefix backend run migrate:up
  if ($LASTEXITCODE -ne 0) { throw "Migrations failed." }

  Write-Host "4. Provisioning restricted npr_app_user & applying RLS policies..."
  $env:TEST_DATABASE_URL = $LocalAdminUrl
  npx --prefix backend tsx backend/src/scripts/provision-test-role.ts
  if ($LASTEXITCODE -ne 0) { throw "Role provisioning failed." }

  Write-Host "5. Seeding clearly fictional Local Demo workshop data..."
  $env:LOCAL_DEMO_DATABASE_URL = $LocalAdminUrl
  npx --prefix backend tsx backend/src/scripts/seed-local-demo.ts
  if ($LASTEXITCODE -ne 0) { throw "Demo seed failed." }

  Write-Host ""
  Write-Host "============================================================"
  Write-Host "LOCAL DEMO ENVIRONMENT READY (ISOLATED DOCKER POSTGRESQL 17)"
  Write-Host "Backend API will run at:  http://localhost:4000"
  Write-Host "Frontend UI will run at:  http://localhost:5173"
  Write-Host "Demo Owner Login:         demo_owner    / LocalDemoPass!2026"
  Write-Host "Demo Cashier Login:       demo_cashier  / LocalDemoPass!2026"
  Write-Host "============================================================"
  Write-Host ""

  $env:DATABASE_URL = $LocalAppUrl
  $env:NODE_ENV = "development"
  $env:PORT = "4000"
  $env:ALLOWED_ORIGINS = "http://localhost:5173"

  Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$RootDir\backend'; `$env:DATABASE_URL='$LocalAppUrl'; `$env:NODE_ENV='development'; `$env:PORT='4000'; npm run dev"
  Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$RootDir\frontend'; npm run dev"
} finally {
  Pop-Location
}

