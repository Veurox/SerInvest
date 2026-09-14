# Arayüz Yeniden Kurgusu — Sayfa Haritası ve Görsel Dil

**Tarih:** 14.09.2026 · **Kararlar:** kullanıcı
**Durum:** sayfa haritası KESİN · Terminal/Bugün iskeleti açık

> Bu dosya "neyi neden değiştirdik"i tutar. Görsel tercih değil, bilgi
> mimarisi kararı: hangi sayfa hangi soruyu cevaplıyor.

---

## 0. Neden yeniden

Kullanıcının tespiti: *"çok fazla başlık ve alt başlık oldu ve bazıları
alakasız yerlerde."* Doğru, ve iki katmanda birden doğru.

**Sayfa içinde.** Terminal ekranında **11 başlıklı bölge** var: makro şerit,
sekmeler, tiker, AI Karar Merkezi, Aktif AL Sinyalleri, Duyarlılık Radarı,
grafik başlığı, Piyasa Yorumu, Model Sağlığı, İzleme Listesi, durum çubuğu.
Her biri büyük harfle kendini duyuruyor, hiçbiri "önce şuraya bak" demiyor.

**Navigasyonda.** 4 çalışma alanı, altlarında 11 sayfa — iki kat sekme.

Ortak sebep: **mevcut düzen arka uçtaki servislerin haritası.** Her servis bir
kutu, her veri türü bir sayfa almış. Ekran kullanıcının ne yaptığına göre
değil, kodun nasıl bölündüğüne göre kurulmuş.

Üç somut sonucu:

1. **"Grafik" alanı bir çekmece.** Terminal, Çoklu Grafik, Piyasa Genel,
   Sembol İncele, Haberler — beş ayrı iş, tek ortak nokta "grafik gösteriyor".
   Widget türüne göre gruplama.
2. **Üç sayfa aynı soruyu cevaplıyor.** Piyasa Genel, Terminal ve Sembol
   İncele üçü de "bu sembolde ne oluyor" diyor; üç ayrı düzen, aynı veri.
3. **Model Sağlığı · MLOps, Terminal'de.** Modelin yaşı, PSI sapması,
   örneklem sayısı bakım verisidir; alım kararı verirken bakılmaz. Orada
   olmasının tek sebebi bir kutuya sığması.

---

## 1. Yeni harita — 5 sayfa, tek kat sekme

Her sayfanın **bir sorusu** var. Bir içerik hangi sayfaya ait, o soruya
cevap verip vermediğine bakılarak belirlenir.

| # | Sayfa | Sorusu |
|---|---|---|
| 1 | **Bugün** (açılış) | Bugün alınacak bir şey var mı? |
| 2 | **Sembol** | Bu hissede/fonda ne oluyor? |
| 3 | **Tarama** | Hangisini alayım? |
| 4 | **Portföy** | Param ne yaptı? |
| 5 | **Model** | Buna güvenebilir miyim? |

11 → 5. İki kat sekme → bir kat.

### Açılış sayfası neden "Bugün"

Kullanıcı kararı (14.09.2026): uygulamayı açma sebebi **"bugün alınacak bir
şey var mı"**. Açılış bu soruyu doğrudan cevaplamalı — rejim ve bugünün
çağrıları önde, gerisi arkada.

### Portföy ↔ Model ayrımının ölçütü

Bu ikisi bugün karışmış durumda: "Model Portföyü" Portföy altında ama
"Tahmin Geçmişi" Model altında. Ölçüt net değildi, o yüzden keyfi görünüyordu.
Yeni ölçüt:

- **Portföy = para.** Ne kazandım, ne kaybettim, neye ne kadar yatırdım.
- **Model = doğruluk.** Çağrılar tuttu mu, olasılıklar dürüst mü.

Buna göre *Model Portföyü* → Portföy (takip edilebilir bir portföy),
*Tahmin Geçmişi* → Model (modelin sicili).

---

## 2. Bugünkü sayfalar nereye gidiyor

Hiçbir şey sessizce düşmüyor; her birinin yeni adresi var.

| Bugün | Yeni yeri |
|---|---|
| Terminal | **Bugün** (çekirdek) |
| Piyasa Genel (`/`) | **Bugün**'ün piyasa manzarası + **Tarama** |
| Sembol İncele (`/degerlendirme`) | **Sembol** |
| Çoklu Grafik | **Sembol** içinde "karşılaştır" modu |
| Haberler (`/news`) | **Bugün**'de akış · **Sembol**'de o sembole ait |
| Tarayıcı (AI · Dip · Temel · Fonlar) | **Tarama** (zaten birleşik) |
| Portföyüm | **Portföy** |
| Model Portföyü | **Portföy** |
| Tahmin Geçmişi | **Model** |
| Model (Durum & Künye) | **Model** |
| Model Sağlığı · MLOps (Terminal'deki kutu) | **Model** — Bugün'de yalnız karara dokunan iki satır kalır: AL isabeti ve başabaş eşiği |

Çoklu Grafik ve Haberler'in ayrı sayfa olmaması kullanıcı kararı: ikisi de bir
*araç* ve bir *akış*, kendi başına bir soru cevaplamıyorlar.

---

## 3. Sayfaların içeriği

### 1 · Bugün
- **Piyasa rejimi:** trend filtresi açık/kapalı (tek en belirleyici bilgi),
  piyasa genişliği, ruh hali, hacim
- **Bugünün çağrıları:** sembol · yön · güven · hedef/stop; seçilen çağrının
  grafiği yanında
- **Açık pozisyon özeti:** kaç pozisyon, toplam kâr/zarar
- **Son bakıştan beri ne değişti:** zaman sıralı kısa akış (haber, çağrı,
  kapanan pozisyon)

### 2 · Sembol
- Fiyat + hedef/stop bariyerleri (sayfanın ana görseli)
- Teknik göstergeler (terim ipuçlarıyla)
- AI kararı ve **sürücüleri** — hangi gösterge kararı ne yöne itti
- Temel veriler; fon ise akran sırası ve eşik farkı
- O sembolün haberleri
- **Karşılaştır modu** — bugünkü çoklu grafik panosu

### 3 · Tarama
- Hisse tablosu (AI tavsiye · dip fırsatı · temel analiz görünümleri)
- Fonlar görünümü
- Kayıtlı görünümler, kolon seçici, CSV

### 4 · Portföy
- Açık ve kapanan pozisyonlar
- Kâr/zarar zaman serisi
- Dağılım (sektör / varlık türü)
- Model portföyü
- İsabet oranı, profit factor

### 5 · Model
- **Güvenilirlik eğrisi** (kalibrasyon) — sayfanın ana görseli
- Doğruluk zaman serisi
- Öz denetim (13 kontrol)
- MLOps sağlığı
- Tahmin geçmişi, sonuçlarıyla
- Kanıt bölümü

---

## 4. Görsel dil: "görsel önde, sayı yanında"

Kullanıcı kararı: her bölümde bir ana görsel olsun, kesin değer onun yanında
küçük dursun. Bir bakışta durum görünsün ama rakama da ulaşılabilsin.

### Pasta/halka grafik nerede DOĞRU

Pasta yalnız **parçanın bütüne oranı** için doğru araçtır. Göz açıyı kötü
okur; birbirine yakın iki dilimi ayırt edemez. Doğru kullanım yerleri:

- Portföy dağılımı (sektör, varlık türü)
- 96 sembolün sinyal dağılımı (AL / TUT / SAT)
- 475 fonun kategoriye dağılımı
- Haber duyarlılığı payları (olumlu / nötr / olumsuz)

### Pasta YANLIŞ olur — bunlar kullanılacak

| Bugün sayı | Ne olacak |
|---|---|
| Ruh hali `37` | Korku–açgözlülük kadranı |
| Genişlik `30/83` | 83 noktalı şerit (yeşil/kırmızı) |
| Güven `%58` | Çubuk + üstünde başabaş eşiği işareti |
| Kalibrasyon `0/150` | Güvenilirlik eğrisi: "%70 dediğinde gerçekten %70 mi" |
| Doğruluk `%58,3` | Zaman serisi + %50 (rastgele) referans çizgisi |
| Maksimum düşüş | Alan grafiği, dip taralı |
| Fon akran sırası | Kategori dağılımı üstünde konum noktası |
| MLOps satırları | Satır başına sparkline — trend mi, tek atış mı |
| Model sürücüleri | Yatay katkı çubukları (+/−) |

### Görselleştirmenin dürüstlük kuralları

Bu projenin tamamı "ölçümün desteklemediği iddiada bulunma" ilkesi üzerine
kurulu. Grafik bu ilkeyi kolayca çiğner: pürüzsüz bir çizgi, olmayan bir
kesinlik vaat eder.

1. **Belirsizlik çizilir.** Güven bandı, örneklem sayısı, yeterli veri
   yokken "henüz karar verilemez" gölgesi.
2. **Dönem her grafikte yazılı.** "%42 getiri" değil, "son 12 ayda %42".
3. **Kesin değer görselin yanında** küçük punto ile durur — görsel onun
   yerine geçmez.
4. **Sıfırdan başlamayan çubuk yok.** Çizgi grafikte kırpılmış eksen
   kullanılacaksa açıkça işaretlenir.
5. **10 günlük gürültüyü trend gibi çizme.** Modelin kısa vadeli doğruluk
   dalgalanması anlamlı bir eğilim değildir; öyle görünen bir çizgi yanlış
   okunur.

---

## 5. Açık kalan: Bugün sayfasının iskeleti

Terminal için dört iskelet çıkarıldı (tasarım tuvali). Açılış sayfasının
"bugün alınacak var mı" sorusunu cevaplaması gerektiği netleşince dördü de
bir yer buldu — hiçbiri boşa gitmiyor:

| İskelet | Nereye uyuyor |
|---|---|
| **Yapı 1** · Tek karar, tüm kanıt | **Sembol** sayfası. Açılış için fazla dar (tek sembol), ama tek sembolü incelerken tam olarak doğru şekil. |
| **Yapı 2** · Üç soru, sırayla | **Bugün** adayı. "Piyasa nasıl → model ne diyor → güvenebilir miyim" zinciri açılış sorusuyla birebir örtüşüyor. |
| **Yapı 3** · Kontrol odası | **Bugün** adayı. Göz atma ekranı olarak güçlü; ayrıntı bir tık uzakta. |
| **Yapı 4** · Bugünün akışı | **Bugün** içinde "son bakıştan beri ne değişti" bölümü. Tek başına sayfa değil, bir bölüm. |

Karar: Yapı 2 mi Yapı 3 mü (ya da karması). Kullanıcı düşünüyor.

Yapı seçilince sıra: (1) jeton sistemi ve bileşen kütüphanesi yeni yapıya
göre kurulur, (2) Bugün baştan sona yazılır, (3) beğenilirse kalan sayfalara
yayılır.
