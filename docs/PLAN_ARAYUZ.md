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

**Karar (14.09.2026): Yapı 2.** Önce Yapı 3 seçilip yazıldı, sonra
kullanıcı beğenmedi ve Yapı 2'ye geçildi. Yapı 3'ün gerçek kusurları
inşa edilince görüldü:

1. **Eşit ızgara, eşit olmayan önemi anlatamıyor.** "Bugünün çağrısı"
   sayfanın cevabı, "kâğıt üstü portföy" ise bağlam; altı eşit karo ikisine
   de aynı ağırlığı veriyordu. Boyutla telafi denendi (46px/34px), ızgara
   geri itti.
2. **Okuma sırası yok.** Kullanıcının sorusunun doğal bir sırası var
   (piyasa uygun mu → model ne diyor → güvenebilir miyim); 3×2 ızgarada
   göz rastgele bir yerden başlıyor.
3. **En can alıcısı:** eski Terminal'i eleştirirken yazdığımız hata
   tekrarlandı — çağrı yukarıdaki karoda, grafiği 400 piksel aşağıda.
   Karar ile kanıtı ayrıldı. Yapı 2'de ikisi orta bantta yan yana.

Ayrıca Yapı 2'nin tek zayıf yeri (Bant 1'in çıplak sayı dizisi olması)
bu arada üretilen görsel ailesiyle kapandı: kadran, genişlik şeridi,
dağılım halkası, eşikli çubuk.

Ders: bir iskeletin kusuru maketten değil, inşa edilince görünüyor.
Yapı 3'ün yazılması kayıp değil — jetonlar, görseller ve veri bağlantıları
olduğu gibi taşındı, yalnız yerleşim değişti.

Yapı seçilince sıra: (1) jeton sistemi ve bileşen kütüphanesi yeni yapıya
göre kurulur, (2) Bugün baştan sona yazılır, (3) beğenilirse kalan sayfalara
yayılır.

---

## Sembol sayfasının alt yarısı (14.09.2026)

Boş duran alan dolduruldu. İstenenler: yapay zekâ yorumu, destek/direnç,
teknik + temel skor, ve "modelin bu hissedeki sicili".

### Ne yapıldı, ne yapılmadı

| İstenen | Karşılığı | Not |
|---|---|---|
| YZ yorumu | `analiz.reasoning` + katkı çubukları | Model gerekçeyi zaten üretiyordu, ekrana hiç basılmıyordu |
| Destek/direnç | **Fiyat seviyeleri** | Ad ve içerik değiştirildi — aşağıya bakınız |
| Teknik + temel skor | İkisi de var | Haber/makro skorları YOK — ölçülmüyorlar |
| Modelin sicili | Sonuç şeridi + güven aralığı | Oran değil, önce olgu |

### Destek/direnç neden "fiyat seviyeleri" oldu

"Destek 18,42 · Direnç 20,15" yazmak on dakika sürerdi, ama o sayıların
nereden geldiği söylenemezdi. Bunun yerine her seviyenin bir TANIMI var ve
tanım ipucunda yazılı: EMA'lar, Bollinger bantları, dönem zirve/dibi, ve
"kendisinden önceki ve sonraki 5 barın hepsinden yüksek/düşük bar"
kuralıyla bulunan belirgin tepe/dipler.

Seviyeler grafiğe **tek tek** çizilir. İlk yazımda tek bir "hepsini çiz"
düğmesi vardı; on üç kesikli çizgi açılınca grafik okunmaz oluyor ve asıl
olan (hedef/stop) kayboluyordu.

### Sicil: neden oran öne konmadı

`lib/sicil.ts` · `viz/OutcomeStrip` · `viz/IntervalBar`

Ekranda önce olgu duruyor — kaç çağrı, kaçı hedefe, kaçı stopa, kaçı
bekliyor — sonra oran. Oranın arkasında iki ayrı zayıflık var:

1. **Sayı az.** Hisse başına iki ayda 12–16 değerlendirilmiş çağrı.
2. **Gözlemler bağımsız değil.** Çağrı her gün üretiliyor, ufuk 10 gün;
   ardışık iki çağrının penceresi 9 gün çakışıyor. 39 işlem gününe kabaca
   **3 bağımsız pencere** sığıyor.

Bu yüzden güven aralığı ham sayıya değil, çakışmayan pencere sayısına göre
hesaplanıyor (`bagimsizGozlem`), ve Wilson kullanılıyor — normal
yaklaşıklık 0/13 gibi uçlarda sıfır genişlikte aralık üretip "isabet kesin
%0" diyordu.

**Sahadaki ölçüm (14.09.2026).** Üç hisse, üç çok farklı görünen sicil:

| Hisse | Sicil | Ham oran | Etkin aralık | Sonuç |
|---|---|---|---|---|
| THYAO | 0 hedef / 13 stop | %0,0 | %0–%56 | Fark söylenemez |
| AEFES | 6 hedef / 10 stop | %37,5 | %6–%79 | Fark söylenemez |
| GARAN | 7 hedef / 5 stop | %58,3 | %21–%94 | Fark söylenemez |

Üçünün aralığı da modelin genel isabetini (%45,5) kapsıyor. Yani "THYAO'da
model hiç tutturamıyor, GARAN'da iyi" cümlesi **kurulamaz** — ham oranlar
öyle diyor gibi görünse de. Ekran bunu açıkça yazıyor.

Sicili ham oranıyla göstermek, bu projede reddedilen şeyin ta kendisi
olurdu: ölçüm gibi duran, arkasında ölçüm olmayan bir sayı.

---

## Baştan sona denetim (14.09.2026)

Taşıma bitince uygulama uçtan uca gezildi: on sayfa, konsol, derleme, lint,
testler. On beş bulgu çıktı; on biri düzeltildi.

### Düzeltilenler

| # | Bulgu | Not |
|---|---|---|
| 1 | Üç ayrı sayı yazımı | `lib/format.ts` + `bicim.py` (Python ikizi) |
| 2 | Başlık NÖTR'de hedef/stop gösteriyordu | `alim` koşuluna bağlandı |
| 3 | Terim ipucu `.ui2` dışında kalıyordu | Portal kapsamı tetikleyiciden okuyor |
| 4 | Yan etki için ternary | if/else |
| 5 | Fon satırı ölü uçtu | `FonDetay` — fiyat, büyüklük, yatırımcı |
| 6 | Haberler ve Pano eski tasarımda | İkisi de taşındı |
| 8 | Hatalı adres eski sayfaya düşüyordu | `*` → `/bugun` |
| 9 | İki ölü bileşen | Silindi |
| 10 | Seviye numaraları sahte sıra vaat ediyordu | Numara kalktı, `anahtar` geldi |
| 11 | BÜYÜK HARF etiketler | `u-label` |
| 13 | tefas imajında pytest yoktu | requirements.txt |

### Biçim tutarlılığı bir hatayı saklıyormuş

Denetimin en öğretici kısmı 1. maddeydi. Üç ayrı yüzde yazımı (`%53,6`,
`%53.6`, `147.5%`) yalnız çirkin değildi — arasında **bin yedi yüz küsur
temettü verimi** duruyordu ve kimse görmemişti:

```
DOAS   %1.817,00   →   %18,17
TTRAK  %1.696,00   →   %16,96
FROTO  %1.170,00   →   %11,70
```

Temettü verimi arka uçtan zaten yüzde biriminde geliyor (ROE'nin aksine
oran değil); arayüz onu bir kez daha 100'le çarpıyordu. Üç sayfada birden.

**Ders:** tutarsız biçim, gürültü üretir; gürültü hatayı saklar.

### İkinci sessiz yalan: `percent` bayrağı

Fon detayına grafik koyarken ekran "+%3,04" yazdı, gerçek dönem değişimi
+%44,99'du. `PriceChart`'ın `percent` bayrağı yalnız EKSEN ETİKETİNİ
değiştiriyor, veriyi dönüştürmüyor — normalizasyon çağıranın işi.

Konsolda hata yoktu, grafik boş değildi, çizginin şekli bile doğruydu.
Yalnız eksendeki sayılar uydurmaydı. Gauge dersinin (14.09, "gözle
doğrulamak yetmiyor") ikinci kez tekrarı. Bayrağın tanımına tuzak yazıldı.

### Devam eden

| # | Bulgu | Neden bekliyor |
|---|---|---|
| 12 | 47 lint hatası, tek 880 KB paket | Çoğu eski kodda `any` ve `set-state-in-effect`; hata değil, biçem |
| 14 | HMR sırasında lightweight-charts "Object is disposed" | Normal gezinmede tekrarlanmıyor, üretimde görünmez |
| 15 | 375px'te büyük sayılar kırpılıyor | Masaüstü uygulaması; mobil hedef değilse düşer |

### 7. madde kapandı: üç sayfa kaldırıldı (15.09.2026)

Kullanıcı sildirdi. Üçü de menüden erişilemiyordu, eski tasarımda kalmıştı
ve işlerini yeni sayfalar devralmıştı:

| Kaldırılan | Ne yapıyordu | Devralan |
|---|---|---|
| `/piyasa-genel` | Barometre, en çok yükselen/düşen, sektör ısı haritası | Bugün |
| `/terminal` | Karar merkezi + bariyerli grafik + aktif sinyaller | Sembol |
| `/degerlendirme` | ML evreni dışındaki hisseleri inceleme | Sembol (90 varlığın hepsi) |

Adresler **yönlendiriliyor**, 404 vermiyor: yer imi ya da eski bir bağlantı
kırılmasın.

**Kademeli temizlik.** Üç sayfa gidince 15 bileşen daha ortada kaldı —
`components/dashboard/` ve `components/terminal/` klasörlerinin tamamı,
`components/market/`, `BistHeatmap`. Bunları tek tek aramak yerine sabit
noktaya kadar tekrarlayan bir tarama yazıldı: "yalnız kendi barrel
index'inden referans alınan dosya ölüdür".

Tarama iki şeyi de yakaladı:

* `SentimentRadar` ilk turda canlı göründü, çünkü `lib/sentiment.ts` onu
  bir YORUMDA anıyordu. Gerçek kullanımı yoktu.
* `latestBySymbol` bir SUNUM bileşeninin (`DecisionCenter`) içinde
  yaşıyordu ama Çoklu Grafik onu kullanıyordu. Silinmeden önce
  `lib/oracle.ts`'e taşındı — kural zaten oraya aitti.

Ayrıca `App.css` silindi: Vite iskeletinden kalma, ilk commit'ten beri hiç
import edilmemiş.

**Sonuç:** ~1150 satır gitti, üretim paketi 880 KB → 792 KB, lint 47 → 41.
On sayfanın onu da yeni dilde ve on başlığın onu da bir soru.

---

## Fiyat ile analiz ayrışması (16.09.2026)

Kullanıcı programı akşam 21:22'de açtı ve ekranda dünün fiyatlarını gördü.
Ölçülen açılış sırası:

```
21:22:46  oracle başladı, analizi HEMEN başlattı
21:23:16  analizler yazılmaya başladı        ← bugünün kapanışıyla (doğru)
21:24:31  market-data fiyatları ancak yayınladı ← ekran ancak şimdi güncel
```

**1 dakika 45 saniye** boyunca Sembol sayfası şunu gösterdi:

| | |
|---|---|
| Fiyat | 127,80 (dünkü — veritabanından) |
| Hedef / Stop | 120,90 üzerinden hesaplanmış (bugünkü — oracle'dan) |

Hedef, ekrandaki fiyatın *altında* görünebiliyordu.

### Kök: aynı olgunun iki bağımsız kaynağı

Oracle kendi yfinance çağrısını yapıyor, market-data kendi. Aralarında hiçbir
tutarlılık kontrolü yok. İki dakika ayrıştılar ve bunu söyleyen hiçbir şey
yoktu.

### Neden "fark varsa uyar" değil

Seans sürerken ekrandaki canlı fiyatla analizin baktığı kapanışın farklı
olması **normaldir**. Ölçülmesi gereken fark değil, **sıra**: fiyat verisi
analizden ESKİ mi? Öyleyse ekran geçmişi gösteriyordur.

`lib/tazelik.ts` bunu ölçüyor, iki kademe:

* **fiyat analizden eski** → başlıkta rozet + gövdede bant: "Ekranda 127,80
  yazıyor; model 120,90 üzerinden hesapladı. Hedef ve stop ikincisine göre."
* **15 dakikadan bayat** → rozet: "N dk önce" (döngü 5 dakikada bir; 15 dk
  üç kaçırılmış tur demek)

Her iki durumda **fiyatın kendisi soluklaşıyor**. Uyarıyı sayfanın altına
yazmak, gözün zaten okuduğu sayıyı düzeltmiyor.
