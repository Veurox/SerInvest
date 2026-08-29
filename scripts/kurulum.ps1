<#
  SerInvest -- Kurulum ve Calistirma
  ===================================
  Teknik bilgisi olmayan bir kullanicinin cift tiklamayla calistirabilmesi icin.
  Cagri KUR.bat / BASLAT.bat / DURDUR.bat uzerinden yapilir -- .ps1 dosyasina
  cift tiklamak Windows'ta betigi CALISTIRMAZ, Notepad'de acar.

  Tasarim ilkeleri:
    - Metin tamamen ASCII. cmd.exe kod sayfasi Turkce karakterleri bozabiliyor;
      teknik olmayan kullanicinin ekraninda anlamsiz isaretler gormesi, sade
      yazimdan daha kotudur.
    - Her hata OKUNUR bir cumleyle anlatilir; yigin izi kullaniciya gosterilmez.
    - Sirlar KURULUMDA RASTGELE uretilir; .env.example'daki "change_me"
      degerleri hicbir zaman canliya gecmez.
    - Yeniden calistirilabilir: mevcut .env EZILMEZ.
    - Her sey kurulum-log.txt'ye yazilir; sorun cikarsa tek dosya gonderilir.
#>
param(
    [switch]$Kur,
    [switch]$Baslat,
    [switch]$Durdur
)

$ErrorActionPreference = 'Stop'

$Kok = Split-Path -Parent $PSScriptRoot
Set-Location $Kok
$LogDosyasi = Join-Path $Kok 'kurulum-log.txt'

function Kaydet([string]$metin) {
    $zaman = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    try { Add-Content -Path $LogDosyasi -Value "[$zaman] $metin" -Encoding utf8 } catch { }
}

function Yaz([string]$metin, [string]$renk = 'Gray') {
    Write-Host $metin -ForegroundColor $renk
    Kaydet $metin
}

function Baslik([string]$metin) {
    Write-Host ''
    Write-Host ('=' * 62) -ForegroundColor DarkGray
    Write-Host "  $metin" -ForegroundColor Cyan
    Write-Host ('=' * 62) -ForegroundColor DarkGray
    Kaydet "== $metin =="
}

function Hata([string]$metin, [string]$cozum = '') {
    Write-Host ''
    Write-Host '  [HATA] ' -NoNewline -ForegroundColor Red
    Write-Host $metin -ForegroundColor Red
    if ($cozum) { Write-Host "         -> $cozum" -ForegroundColor Yellow }
    Kaydet "HATA: $metin | $cozum"
}

function Tamam([string]$metin) {
    Write-Host '  [OK] ' -NoNewline -ForegroundColor Green
    Write-Host $metin
    Kaydet "OK: $metin"
}

function Bekle {
    Write-Host ''
    Write-Host 'Bu pencereyi kapatabilirsiniz (veya bir tusa basin).' -ForegroundColor DarkGray
    try { $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown') } catch { Start-Sleep 8 }
}

# -- Rastgele sir uretimi ----------------------------------------------------
# Karistirilabilecek karakterler (l/1/I, O/0) havuzda YOK: kullanici bir gun bu
# degeri elle okumak zorunda kalirsa hata yapmasin.
function RastgeleSir([int]$uzunluk) {
    $havuz = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    $sonuc = New-Object System.Text.StringBuilder
    $rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
    $bayt = New-Object 'byte[]' 1
    for ($i = 0; $i -lt $uzunluk; $i++) {
        $rng.GetBytes($bayt)
        $null = $sonuc.Append($havuz[$bayt[0] % $havuz.Length])
    }
    $rng.Dispose()
    return $sonuc.ToString()
}

function DockerKurulu {
    $c = Get-Command docker -ErrorAction SilentlyContinue
    return ($null -ne $c)
}

function DockerCalisiyor {
    try {
        $null = docker info --format '{{.ServerVersion}}'
        return ($LASTEXITCODE -eq 0)
    } catch { return $false }
}

function DockerBekle {
    # Docker Desktop acilirken 30-60 sn surer. Kullaniciya ne bekledigini soyle.
    Yaz '  Docker Desktop aciliyor, bekleniyor (1-2 dakika surebilir)...' 'DarkGray'
    for ($i = 1; $i -le 40; $i++) {
        if (DockerCalisiyor) { Write-Host ''; return $true }
        Start-Sleep -Seconds 3
        Write-Host '.' -NoNewline -ForegroundColor DarkGray
    }
    Write-Host ''
    return $false
}

function DockerGardi {
    if (-not (DockerKurulu)) {
        Hata 'Docker Desktop bu bilgisayarda kurulu degil.'
        Write-Host ''
        Yaz '  Yapmaniz gereken:' 'Yellow'
        Yaz '    1) Su adrese gidin: https://www.docker.com/products/docker-desktop/' 'Yellow'
        Yaz '    2) Windows icin indirip kurun (varsayilan ayarlarla Ileri, Ileri).' 'Yellow'
        Yaz '    3) Bilgisayari yeniden baslatin.' 'Yellow'
        Yaz '    4) Bu dosyaya (KUR.bat) tekrar cift tiklayin.' 'Yellow'
        return $false
    }
    if (-not (DockerCalisiyor)) {
        Yaz '  Docker kurulu ama henuz calismiyor. Baslatmayi deniyorum...' 'Yellow'
        $yol = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
        if (Test-Path $yol) { try { Start-Process $yol | Out-Null } catch { } }
        if (-not (DockerBekle)) {
            Hata 'Docker Desktop baslatilamadi.' 'Baslat menusunden "Docker Desktop" uygulamasini elle acin, sag alttaki balina simgesi sabitlenene kadar bekleyin, sonra tekrar deneyin.'
            return $false
        }
    }
    Tamam 'Docker calisiyor'
    return $true
}

# -- .env: yoksa RASTGELE sirlarla uret --------------------------------------
function EnvHazirla {
    $envYol = Join-Path $Kok '.env'
    if (Test-Path $envYol) {
        Tamam 'Ayar dosyasi (.env) zaten var -- dokunulmadi'
        return
    }
    $ornek = Join-Path $Kok '.env.example'
    if (-not (Test-Path $ornek)) {
        Hata 'Kurulum sablonu (.env.example) bulunamadi.' 'Proje klasoru eksik kopyalanmis olabilir; klasorun tamamini yeniden alin.'
        throw 'env-example-yok'
    }

    # Sifreler ve yonetim anahtari BURADA uretilir. Sablondaki "change_me"
    # degerleri kullanilmaz -- her kurulum kendi sirlarini alir.
    $sirlar = @{
        'POSTGRES_PASSWORD' = (RastgeleSir 28)
        'RABBITMQ_PASSWORD' = (RastgeleSir 28)
        'ADMIN_API_KEY'     = (RastgeleSir 40)
    }

    $cikti = New-Object System.Collections.Generic.List[string]
    foreach ($satir in (Get-Content $ornek -Encoding utf8)) {
        $yazildi = $false
        foreach ($anahtar in $sirlar.Keys) {
            if ($satir -match "^\s*$anahtar\s*=") {
                $cikti.Add("$anahtar=$($sirlar[$anahtar])")
                $yazildi = $true
                break
            }
        }
        if (-not $yazildi) { $cikti.Add($satir) }
    }
    Set-Content -Path $envYol -Value $cikti -Encoding utf8
    Tamam 'Ayar dosyasi olusturuldu -- sifreler bu bilgisayara ozel, rastgele uretildi'
}

function ArayuzuBekle([int]$dakika = 5) {
    Yaz "  Ekranin hazir olmasi bekleniyor (en fazla $dakika dakika)..." 'DarkGray'
    $bitis = (Get-Date).AddMinutes($dakika)
    while ((Get-Date) -lt $bitis) {
        try {
            $y = Invoke-WebRequest -Uri 'http://localhost:3000' -UseBasicParsing -TimeoutSec 5
            if ($y.StatusCode -eq 200) { Write-Host ''; return $true }
        } catch { }
        Start-Sleep -Seconds 4
        Write-Host '.' -NoNewline -ForegroundColor DarkGray
    }
    Write-Host ''
    return $false
}

function TarayiciyiAc {
    try { Start-Process 'http://localhost:3000' | Out-Null } catch { }
}

# ============================================================================
try {
    Kaydet '----- yeni calistirma -----'

    if ($Durdur) {
        Baslik 'SerInvest -- Kapatiliyor'
        if (-not (DockerGardi)) { Bekle; exit 1 }
        docker compose stop
        if ($LASTEXITCODE -ne 0) {
            Hata 'Kapatma sirasinda bir sorun olustu.' 'kurulum-log.txt dosyasini programin sahibine gonderin.'
            Bekle; exit 1
        }
        Tamam 'Program kapatildi. BASLAT.bat ile tekrar acabilirsiniz.'
        Bekle
        exit 0
    }

    if ($Baslat) {
        Baslik 'SerInvest -- Aciliyor'
        if (-not (DockerGardi)) { Bekle; exit 1 }
        if (-not (Test-Path (Join-Path $Kok '.env'))) {
            Hata 'Program henuz kurulmamis.' 'Once KUR.bat dosyasina cift tiklayin.'
            Bekle; exit 1
        }
        Yaz '  Servisler baslatiliyor...' 'DarkGray'
        docker compose up -d
        if ($LASTEXITCODE -ne 0) {
            Hata 'Program acilamadi.' 'kurulum-log.txt dosyasini programin sahibine gonderin.'
            Bekle; exit 1
        }
        if (ArayuzuBekle 4) {
            Tamam 'Hazir -- tarayici aciliyor'
            TarayiciyiAc
        } else {
            Yaz '  Ekran henuz cevap vermedi. Birkac dakika sonra su adresi acin:' 'Yellow'
            Yaz '    http://localhost:3000' 'Yellow'
        }
        Bekle
        exit 0
    }

    # -- Varsayilan: KURULUM -------------------------------------------------
    Baslik 'SerInvest -- Kurulum'
    Yaz '  Bu islem ILK SEFERDE 10-15 dakika surebilir.' 'Yellow'
    Yaz '  Bu pencereyi kapatmayin, bilgisayari uyutmayin.' 'Yellow'
    Write-Host ''

    if (-not (DockerGardi)) { Bekle; exit 1 }
    EnvHazirla

    Write-Host ''
    Yaz '  Program derleniyor ve baslatiliyor...' 'DarkGray'
    Yaz '  (Asagida hizla akan satirlar normaldir; sadece beklemeniz yeterli)' 'DarkGray'
    Write-Host ''
    docker compose up -d --build
    if ($LASTEXITCODE -ne 0) {
        Hata 'Derleme veya baslatma basarisiz oldu.' 'kurulum-log.txt dosyasini programin sahibine gonderin.'
        Bekle; exit 1
    }
    Tamam 'Servisler ayakta'

    Write-Host ''
    if (ArayuzuBekle 6) {
        Tamam 'Kurulum tamamlandi'
        Write-Host ''
        Yaz '  ONEMLI: Yapay zeka modeli ilk egitimini SIMDI yapiyor.' 'Yellow'
        Yaz '  Bu 10-20 dakika surer. O zamana kadar tahmin bolumleri bos' 'Yellow'
        Yaz '  gorunebilir -- bu normaldir, bir sey bozuk degildir.' 'Yellow'
        Write-Host ''
        Yaz '  Bundan sonra:  BASLAT.bat ile acin,  DURDUR.bat ile kapatin.' 'Gray'
        TarayiciyiAc
    } else {
        Yaz '  Servisler calisiyor ama ekran henuz cevap vermedi.' 'Yellow'
        Yaz '  Birkac dakika bekleyip su adresi acin: http://localhost:3000' 'Yellow'
    }
    Bekle
    exit 0

} catch {
    Hata "Beklenmeyen bir sorun olustu: $($_.Exception.Message)" 'kurulum-log.txt dosyasini programin sahibine gonderin.'
    Kaydet $_.ScriptStackTrace
    Bekle
    exit 1
}
