# SerInvest Restore Script (Windows PowerShell)
# ──────────────────────────────────────────────
# Bir backup dizininden geri yükler (backup.ps1'in yeni formatı).
#
# Kullanım:  ./scripts/restore.ps1 -BackupDir ..\backups\20260719_030000
#
# DİKKAT: oracle-data/ üzerine yazar ve postgres verisini geri yükler.

param(
    [Parameter(Mandatory=$true)]
    [string]$BackupDir
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Join-Path $PSScriptRoot ".."

if (-not (Test-Path $BackupDir)) {
    Write-Host "❌ Backup dizini bulunamadı: $BackupDir" -ForegroundColor Red
    exit 1
}

Write-Host "⚠️  RESTORE mevcut model ve DB verisini değiştirir. Devam? [y/N]" -ForegroundColor Yellow
if ((Read-Host) -ne "y") { Write-Host "İptal."; exit 0 }

# ── 1. oracle-data/ (model) geri yükle ───────────────────────────────────────
$OracleBak = Join-Path $BackupDir "oracle-data"
if (Test-Path $OracleBak) {
    Write-Host "📥 oracle-data (model) geri yükleniyor..." -ForegroundColor Cyan
    docker compose stop ai-oracle-service core-api | Out-Null
    $OracleDst = Join-Path $ProjectRoot "oracle-data"
    if (Test-Path $OracleDst) { Remove-Item -Recurse -Force $OracleDst }
    Copy-Item -Recurse -Path $OracleBak -Destination $OracleDst
    Write-Host "  ✓ oracle-data" -ForegroundColor Green
    docker compose start ai-oracle-service core-api | Out-Null
}

# ── 2. Postgres geri yükle (gzip dump → psql) ────────────────────────────────
$PgGz = Join-Path $BackupDir "postgres_dump.sql.gz"
if (Test-Path $PgGz) {
    Write-Host "📥 PostgreSQL geri yükleniyor..." -ForegroundColor Cyan
    $PgUser = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { "admin" }
    $PgDb   = if ($env:POSTGRES_DB)   { $env:POSTGRES_DB }   else { "marketsentinel" }
    # gzip'i konteyner içinde aç → psql'e ver (binary pipe host'a hiç uğramaz)
    docker cp $PgGz serinvest-postgres:/tmp/si_restore.sql.gz | Out-Null
    docker exec serinvest-postgres sh -c "gunzip -c /tmp/si_restore.sql.gz | psql -U $PgUser -d $PgDb"
    docker exec serinvest-postgres rm -f /tmp/si_restore.sql.gz
    Write-Host "  ✓ postgres" -ForegroundColor Green
}

Write-Host "✅ Restore tamamlandı." -ForegroundColor Green
