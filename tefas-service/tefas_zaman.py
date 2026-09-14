"""
TEFAS çekim zamanlaması — SAF karar katmanı
===========================================
Tek soru: "şu an çekim yapmalı mıyım?" Ağ yok, disk yok, saat okuma yok —
hepsi parametre olarak geliyor. Böylece 21:00'i, hafta sonunu ve "makine üç
gün kapalı kaldı" durumunu beklemeden sınayabiliyoruz.

NEDEN AYRI DOSYA
  Bu mantık bir kez sessizce yanlış çalıştı (14.09.2026): makine 11-14 Eylül
  arası kapalı kaldı, açıldığında program "bugünün yayın saati gelmedi" deyip
  bekledi ve 11 Eylül Cuma'nın kapanışı hiç alınmadı. 7 günlük pencere tam
  bunu telafi etmek için vardı ama pencerenin çalışması için çekimin bir kez
  TETİKLENMESİ gerekiyordu; tetiklenmiyordu.

  Asıl hata daha derindeydi: karar "en son NE ZAMAN çalıştık"a bakıyordu,
  "elimizde NE VAR"a değil. Sabah çalışmak `son_basarili_gun`'ü bugüne
  çeviriyor ama o saatte bugünün kapanışı henüz yayımlanmamış oluyor —
  yani çalışmış ama veri almamış oluyoruz. Karar artık DEPODAKİ EN YENİ GÜNE
  bakıyor.

İKİ ÇEKİM HAKKI, GÜNDE EN FAZLA
  1. Telafi  — kapalı kalınan günler varsa, saat kaç olursa olsun (günde 1)
  2. Akşam   — yayın saatinden sonra bugünün kapanışı için (günde 1)
  Tatilde veri hiç yayımlanmaz; üst sınır olmasa program her turda boşuna
  deneyip siteyi yorardı.
"""
from __future__ import annotations

import datetime

# Hafta sonu TEFAS'ta veri yok. Resmî tatil takvimi TUTULMUYOR: tatilde
# telafi bir kez denenir, boş döner ve günlük sınır tekrarını engeller.
# Bir tatil takvimi bakım yükü getirir ve yanlış tutulursa veri kaybettirir;
# günde bir boş istek bu riske değmez.
HAFTA_SONU = (5, 6)      # Cumartesi, Pazar


def son_yayin_gunu(bugun: datetime.date, saat: int, cekim_saati: int) -> str:
    """
    Şu an itibarıyla kapanışı YAYIMLANMIŞ OLMASI GEREKEN en son gün.

    Birim pay değeri akşam yayımlanır: yayın saatinden önceysek bugünün
    kapanışı henüz yok, dünden geriye bakılır. Hafta sonuna denk gelirse
    Cuma'ya kadar geri yürünür.
    """
    g = bugun if saat >= cekim_saati else bugun - datetime.timedelta(days=1)
    while g.weekday() in HAFTA_SONU:
        g -= datetime.timedelta(days=1)
    return g.isoformat()


def cekim_gerekli(durum: dict, depo_son_gun: str | None,
                  bugun: datetime.date, saat: int, cekim_saati: int) -> str | None:
    """
    Çekim gerekiyorsa GEREKÇESİNİ, gerekmiyorsa None döner.

    Gerekçeyi metin olarak döndürmek bilinçli: loga ve /durum çıktısına aynen
    yazılıyor, böylece "niye şimdi çekti / niye çekmedi" sorusu sonradan
    cevaplanabiliyor.
    """
    b = bugun.isoformat()

    # 1) Akşam çekimi — bugünün kapanışı için. Gündüz yapılan telafi bunu
    #    KARŞILAMAZ; o saatte bugünün değeri henüz yayımlanmamıştı.
    if saat >= cekim_saati and durum.get("son_aksam_gun") != b:
        return "yayın saati geldi"

    # 2) Telafi — elimizdeki en yeni gün, yayımlanmış olması gerekenden eski.
    #    Kapalı kalınan günleri kurtaran yol bu; akşamı beklemek kurtarmıyordu.
    beklenen = son_yayin_gunu(bugun, saat, cekim_saati)
    if (depo_son_gun is None or depo_son_gun < beklenen) \
            and durum.get("son_telafi_gun") != b:
        return f"geride kalınmış (elde {depo_son_gun or 'veri yok'}, beklenen {beklenen})"

    return None
