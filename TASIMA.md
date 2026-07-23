# SerInvest — Bilgisayarlar Arası Taşıma Rehberi

Projeyi başka bir bilgisayara (ör. masaüstü ↔ laptop) **hiçbir şey kaybetmeden**
taşımanın yolu. Geçmişte model sıfırlanıyordu çünkü Docker "named volume"ları
klasörle birlikte gelmiyor. Bu kurulumda o sorun çözüldü.

## Neyin nasıl taşındığı (özet)

| Parça | Nerede | Nasıl taşınır |
|---|---|---|
| **Kod** | proje klasörü | git veya klasör kopyası |
| **Model + eğitim verisi** | `oracle-data/` (proje içinde) | **klasörü kopyala** — ~13 MB |
| **`.env`** | proje kökü (gitignore'da) | **elle kopyala** |
| **DB geçmişi** (haber/sinyal/analiz) | `postgres_data` named volume | `backup.ps1` → `restore.ps1` |
| Redis (syslog) | — | taşınmaz, önemsiz (uçucu) |

> **Neden `oracle-data/` git'e girmiyor?** İçindeki `training_data.csv` ~11 MB ve her
> retrain'de değişir; git ikili dosyada delta tutmaz → repo şişer. Bu yüzden `.gitignore`'da.
> Onun yerine klasörü elle kopyalıyoruz (zaten 13 MB, USB/Drive/zip ile kolay).

---

## KAYNAK bilgisayarda (taşımadan önce)

```powershell
# 1. DB'yi yedekle (model zaten oracle-data/ içinde, ekstra iş yok)
./scripts/backup.ps1
# → backups/TARIH/postgres_dump.sql.gz + oracle-data kopyası
```

Sonra şunları hedef bilgisayara götür (USB, Drive, ağ):
- **Proje klasörü** — `node_modules/`, `bin/`, `obj/`, `__pycache__/` HARİÇ (Docker içinde kurulur)
- **`oracle-data/`** klasörü (kod klasörünün içinde zaten) — model burada
- **`.env`** dosyası (git taşımaz)
- **`backups/TARIH/`** klasörü (DB dump'ı)

> Git kullanıyorsan: kodu `git push`/`pull` ile taşı; ama `oracle-data/`, `.env` ve
> `backups/` git'e girmez → onları AYRICA kopyala.

---

## HEDEF bilgisayarda (kurulum)

Ön koşul: Docker Desktop kurulu ve çalışıyor.

```powershell
# 1. Servisleri derle + başlat (oracle-data/ zaten yerinde → model direkt yüklenir)
docker compose up -d --build

# 2. DB geçmişini geri yükle
./scripts/restore.ps1 -BackupDir .\backups\TARIH

# 3. Oracle'ı tazele
docker compose restart ai-oracle-service
```

### Doğrulama
```powershell
# Model sıfırdan eğitilmeden yüklendiyse başarılı:
docker compose logs ai-oracle-service | Select-String "Champion model yüklendi"
```
Bu satırı görüyorsan model taşındı. "Champion bulunamadı — sıfırdan eğitiliyor"
görüyorsan `oracle-data/` kopyalanmamış demektir.

---

## Sık sorunlar

- **Port çakışması** (`5672 already allocated` vb.): başka bir projenin konteyneri
  aynı portu tutuyordur. RabbitMQ host portu bu projede zaten 5673/15673'e alındı.
- **Frontend admin çağrıları kırık**: iki bilgisayarda `.env` içindeki `ADMIN_API_KEY`
  farklıdır. Aynı değeri kullan.
- **`oracle-data/` yazılamıyor / boş kaldı**: Docker Desktop → Settings → Resources →
  File Sharing bölümünde proje sürücüsünün paylaşıldığından emin ol.
