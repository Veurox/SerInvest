#!/bin/sh
# =============================================================================
# SerInvest — günlük otomatik yedek (docker-compose "yedek" servisi)
#
# Her saat bakar; o günün yedeği yoksa alır. Makine gece kapalı olabileceği
# için belirli bir saati beklemez. Bir yedek ancak DOĞRULANINCA tamam sayılır
# (gzip -t + tar listesi) — doğrulanmamış yedek yedek değildir.
#
# Çıktı: /yedek/otomatik/YYYYMMDD/{oracle-data.tar.gz, tefas-data.tar.gz,
#        postgres.sql.gz, TAMAM}
# Geri yükleme: scripts/restore.ps1 (postgres) + tar xzf (klasörler).
# =============================================================================
set -u
KOK=/yedek/otomatik
GUN=${YEDEK_GUN:-14}
mkdir -p "$KOK"

yedek_al() {
    bugun=$(date +%Y%m%d)
    hedef="$KOK/$bugun"
    [ -f "$hedef/TAMAM" ] && return 0
    gecici="$KOK/.$bugun.yariyor"
    rm -rf "$gecici"; mkdir -p "$gecici"
    echo "[yedek] $(date '+%F %T') başladı"

    tar czf "$gecici/oracle-data.tar.gz" -C /kaynak oracle-data 2>/dev/null
    tar czf "$gecici/tefas-data.tar.gz"  -C /kaynak tefas-data  2>/dev/null
    if ! pg_dump --no-owner | gzip -9 > "$gecici/postgres.sql.gz"; then
        echo "[yedek] HATA: pg_dump başarısız"; rm -rf "$gecici"; return 1
    fi

    for f in oracle-data tefas-data; do
        if ! tar tzf "$gecici/$f.tar.gz" >/dev/null 2>&1; then
            echo "[yedek] HATA: $f arşivi okunamıyor"; rm -rf "$gecici"; return 1
        fi
    done
    if ! gzip -t "$gecici/postgres.sql.gz"; then
        echo "[yedek] HATA: postgres dökümü bozuk"; rm -rf "$gecici"; return 1
    fi

    date '+%F %T' > "$gecici/TAMAM"
    rm -rf "$hedef"; mv "$gecici" "$hedef"
    echo "[yedek] tamam → $hedef ($(du -sh "$hedef" | cut -f1))"

    # Eski yedekler: yalnız doğrulanmış (TAMAM'lı) günler sayılır, en yeni $GUN kalır.
    ls -1d "$KOK"/[0-9]* 2>/dev/null | sort -r | tail -n +$((GUN + 1)) | while read -r eski; do
        rm -rf "$eski" && echo "[yedek] silindi: $eski"
    done
}

while true; do
    yedek_al || echo "[yedek] bir saat sonra yeniden denenecek"
    sleep 3600
done
