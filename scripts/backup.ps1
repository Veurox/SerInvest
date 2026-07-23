# SerInvest Backup Script (Windows PowerShell)
# ────────────────────────────────────────────────
# Yedekler:
#   - oracle-data/  (model + kalibratör + meta + eğitim verisi)  → proje klasöründe
#     bind-mount olduğu için zaten taşınabilir; burada point-in-time kopyası alınır.
#   - postgres      (haberler, sinyaller, analiz geçmişi)        → named volume, dump şart.
#
# Kullanım:  ./scripts/backup.ps1
#
# Haftalık otomatik (Task Scheduler):
#   schtasks /create /tn "SerInvest Weekly Backup" /tr "powershell -File C:\path\to\backup.ps1" /sc weekly /d SUN /st 03:00

$ErrorActionPreference = "Stop"

$ProjectRoot = Join-Path $PSScriptRoot ".."
$BackupRoot  = Join-Path $ProjectRoot "backups"
if (-not (Test-Path $BackupRoot)) { New-Item -ItemType Directory -Path $BackupRoot | Out-Null }

$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupDir = Join-Path $BackupRoot $Timestamp
New-Item -ItemType Directory -Path $BackupDir | Out-Null

Write-Host "📦 SerInvest Backup → $BackupDir" -ForegroundColor Cyan

# ── 1. oracle-data/ (model) — düz klasör kopyası ─────────────────────────────
Write-Host "  [1/2] oracle-data (model) yedekleniyor..." -ForegroundColor Yellow
$OracleSrc = Join-Path $ProjectRoot "oracle-data"
if (Test-Path $OracleSrc) {
    $OracleDst = Join-Path $BackupDir "oracle-data"
    Copy-Item -Recurse -Path $OracleSrc -Destination $OracleDst
    $size = (Get-ChildItem $OracleDst -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB
    Write-Host "    ✓ oracle-data → kopyalandı ($([math]::Round($size,2)) MB)" -ForegroundColor Green
} else {
    Write-Host "    ⚠ oracle-data/ bulunamadı — atlandı" -ForegroundColor Yellow
}

# ── 2. Postgres — konteyner içinde gzip'lenip docker cp ile alınır ────────────
# (PowerShell'in binary pipe bozması bu yolla tamamen atlanır — eski yöntemden sağlam.)
Write-Host "  [2/2] PostgreSQL yedekleniyor..." -ForegroundColor Yellow
$PgUser = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { "admin" }
$PgDb   = if ($env:POSTGRES_DB)   { $env:POSTGRES_DB }   else { "marketsentinel" }
$PgOut  = Join-Path $BackupDir "postgres_dump.sql.gz"

docker exec serinvest-postgres sh -c "pg_dump -U $PgUser $PgDb | gzip -9 -c > /tmp/si_dump.sql.gz"
if ($LASTEXITCODE -eq 0) {
    docker cp serinvest-postgres:/tmp/si_dump.sql.gz $PgOut | Out-Null
    docker exec serinvest-postgres rm -f /tmp/si_dump.sql.gz
    $size = (Get-Item $PgOut).Length / 1MB
    Write-Host "    ✓ postgres → postgres_dump.sql.gz ($([math]::Round($size,2)) MB)" -ForegroundColor Green
} else {
    Write-Host "    ✗ postgres yedeklenemedi (konteyner çalışıyor mu?)" -ForegroundColor Red
}

# ── Eski yedekleri temizle (4 haftadan eski) ─────────────────────────────────
$Cutoff = (Get-Date).AddDays(-28)
$Old = Get-ChildItem $BackupRoot -Directory | Where-Object { $_.LastWriteTime -lt $Cutoff }
if ($Old) {
    Write-Host "  🗑️  $($Old.Count) eski yedek temizleniyor..." -ForegroundColor Gray
    $Old | Remove-Item -Recurse -Force
}

Write-Host "✅ Backup tamamlandı: $BackupDir" -ForegroundColor Green
