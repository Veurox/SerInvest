# SerInvest — yedekten geri yükleme (Windows PowerShell)
# ──────────────────────────────────────────────────────────
# İki yedek biçimini de tanır:
#   • otomatik (yedek servisi, 18.10.2026+): backups\otomatik\YYYYMMDD\
#       oracle-data.tar.gz, tefas-data.tar.gz, postgres.sql.gz, TAMAM
#   • elle (backup.ps1):                    backups\YYYYMMDD_HHMMSS\
#       oracle-data\ klasörü, postgres_dump.sql.gz
#
# Kullanım:
#   .\scripts\restore.ps1 -BackupDir backups\otomatik\20261018 -Deneme   # hiçbir şeye dokunmaz, yedeği sınar
#   .\scripts\restore.ps1 -BackupDir backups\otomatik\20261018           # geri yükler (onay ister)
#
# NEDEN YENİDEN YAZILDI (18.10.2026): eski betik yalnız elle yedek biçimini
# arıyordu; otomatik yedekte hiçbir dosya bulamayıp yine de "tamamlandı"
# diyordu. Ayrıca dökümü DOLU veritabanının üstüne yüklüyordu (tablo
# çakışması / çift kayıt). Artık: bulunamayan parça HATA, veritabanı önce
# boşaltılır, yazan servisler geri yükleme süresince durdurulur.

param(
    [Parameter(Mandatory=$true)]
    [string]$BackupDir,
    [switch]$Deneme
)

$ErrorActionPreference = "Stop"
$Kok = Resolve-Path (Join-Path $PSScriptRoot "..")
# Windows'un kendi tar.exe'si (bsdtar) — PATH'te Git'in GNU tar'ı önce gelirse
# "C:\..." yolunu uzak sunucu sanıp arşivi "bozuk" ilan ediyordu (sınandı).
$Tar = Join-Path (Join-Path $env:SystemRoot "System32") "tar.exe"
if (-not (Test-Path $Tar)) { $Tar = "tar" }

if (-not (Test-Path $BackupDir)) {
    Write-Host "HATA: yedek klasörü bulunamadı: $BackupDir" -ForegroundColor Red
    exit 1
}
$BackupDir = Resolve-Path $BackupDir

# ── Parçaları bul ────────────────────────────────────────────────────────────
$OracleTar = Join-Path $BackupDir "oracle-data.tar.gz"
$OracleDir = Join-Path $BackupDir "oracle-data"
$TefasTar  = Join-Path $BackupDir "tefas-data.tar.gz"
$PgGz      = @("postgres.sql.gz", "postgres_dump.sql.gz") |
             ForEach-Object { Join-Path $BackupDir $_ } |
             Where-Object { Test-Path $_ } | Select-Object -First 1

$parcalar = @()
if (Test-Path $OracleTar)     { $parcalar += "oracle-data (arşiv)" }
elseif (Test-Path $OracleDir) { $parcalar += "oracle-data (klasör)" }
if (Test-Path $TefasTar)      { $parcalar += "tefas-data (arşiv)" }
if ($PgGz)                    { $parcalar += "postgres ($([IO.Path]::GetFileName($PgGz)))" }

if ($parcalar.Count -eq 0) {
    Write-Host "HATA: bu klasörde tanınan hiçbir yedek parçası yok: $BackupDir" -ForegroundColor Red
    exit 1
}
if ((Test-Path (Join-Path $BackupDir "TAMAM")) -eq $false -and (Test-Path $OracleTar)) {
    Write-Host "UYARI: otomatik yedekte TAMAM işareti yok — yedek yarım kalmış olabilir." -ForegroundColor Yellow
}
Write-Host "Bulunan parçalar: $($parcalar -join ', ')" -ForegroundColor Cyan

# ── Deneme: arşivleri ve dökümü sına, hiçbir şeye dokunma ────────────────────
if ($Deneme) {
    $hata = 0
    foreach ($t in @($OracleTar, $TefasTar)) {
        if (Test-Path $t) {
            & $Tar -tzf $t | Out-Null
            if ($LASTEXITCODE -ne 0) { Write-Host "  BOZUK: $t" -ForegroundColor Red; $hata++ }
            else { Write-Host "  okunuyor: $([IO.Path]::GetFileName($t))" -ForegroundColor Green }
        }
    }
    if ($PgGz) {
        docker run --rm -v "${BackupDir}:/y:ro" postgres:15-alpine sh -c "gzip -t /y/$([IO.Path]::GetFileName($PgGz))"
        if ($LASTEXITCODE -ne 0) { Write-Host "  BOZUK: $PgGz" -ForegroundColor Red; $hata++ }
        else { Write-Host "  okunuyor: $([IO.Path]::GetFileName($PgGz))" -ForegroundColor Green }
    }
    if ($hata -gt 0) { Write-Host "Deneme: $hata parça bozuk." -ForegroundColor Red; exit 1 }
    Write-Host "Deneme tamam — hiçbir şey değiştirilmedi." -ForegroundColor Green
    exit 0
}

Write-Host "DİKKAT: Geri yükleme şu anki model, fon ve veritabanı verisinin YERİNE geçer." -ForegroundColor Yellow
Write-Host "Devam etmek için EVET yazın:" -ForegroundColor Yellow
if ((Read-Host) -ne "EVET") { Write-Host "İptal."; exit 0 }

Push-Location $Kok
try {
    # Yazan servisleri durdur — geri yükleme sırasında kimse yazmasın.
    docker compose stop ai-oracle-service core-api tefas-service market-data-service analyst-engine fundamental-service yedek | Out-Null

    # ── 1. oracle-data ──────────────────────────────────────────────────────
    $Hedef = Join-Path $Kok "oracle-data"
    if (Test-Path $OracleTar) {
        if (Test-Path $Hedef) { Rename-Item $Hedef "oracle-data.onceki-$(Get-Date -Format yyyyMMdd_HHmmss)" }
        & $Tar -xzf $OracleTar -C $Kok
        if ($LASTEXITCODE -ne 0) { throw "oracle-data arşivi açılamadı" }
        Write-Host "  oracle-data geri yüklendi (önceki hâli yeniden adlandırıldı)" -ForegroundColor Green
    } elseif (Test-Path $OracleDir) {
        if (Test-Path $Hedef) { Rename-Item $Hedef "oracle-data.onceki-$(Get-Date -Format yyyyMMdd_HHmmss)" }
        Copy-Item -Recurse -Path $OracleDir -Destination $Hedef
        Write-Host "  oracle-data geri yüklendi (önceki hâli yeniden adlandırıldı)" -ForegroundColor Green
    }

    # ── 2. tefas-data ───────────────────────────────────────────────────────
    if (Test-Path $TefasTar) {
        $THedef = Join-Path $Kok "tefas-data"
        if (Test-Path $THedef) { Rename-Item $THedef "tefas-data.onceki-$(Get-Date -Format yyyyMMdd_HHmmss)" }
        & $Tar -xzf $TefasTar -C $Kok
        if ($LASTEXITCODE -ne 0) { throw "tefas-data arşivi açılamadı" }
        Write-Host "  tefas-data geri yüklendi" -ForegroundColor Green
    }

    # ── 3. Postgres: önce boşalt, sonra yükle ───────────────────────────────
    if ($PgGz) {
        $PgUser = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { "admin" }
        $PgDb   = if ($env:POSTGRES_DB)   { $env:POSTGRES_DB }   else { "marketsentinel" }
        docker cp $PgGz serinvest-postgres:/tmp/si_restore.sql.gz | Out-Null
        docker exec serinvest-postgres sh -c "psql -q -U $PgUser -d $PgDb -v ON_ERROR_STOP=1 -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' && gunzip -c /tmp/si_restore.sql.gz | psql -q -U $PgUser -d $PgDb -v ON_ERROR_STOP=1"
        if ($LASTEXITCODE -ne 0) { throw "postgres geri yüklemesi başarısız" }
        docker exec serinvest-postgres rm -f /tmp/si_restore.sql.gz
        Write-Host "  postgres geri yüklendi" -ForegroundColor Green
    }
}
finally {
    docker compose up -d | Out-Null
    Pop-Location
}
Write-Host "Geri yükleme tamamlandı; servisler yeniden başlatıldı." -ForegroundColor Green
