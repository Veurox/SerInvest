// =============================================================================
// SerInvest — Çalışma Alanı Haritası
// docs/PLAN_ARAYUZ.md §1: 11 sayfa → 5 sayfa, iki kat sekme → bir kat.
//
// HER ÜST SEKMENİN BİR SORUSU VAR. Bir içeriğin hangi sayfaya ait olduğu,
// o soruya cevap verip vermediğine bakılarak belirlenir. Eski harita
// arka uçtaki servislerin haritasıydı: her servis bir kutu, her veri türü
// bir sayfa. Ekran kullanıcının ne yaptığına göre değil, kodun nasıl
// bölündüğüne göre kurulmuştu.
//
// GEÇİŞ DURUMU (14.09.2026)
// Çoklu Grafik ve Haberler ayrı sayfa OLMAYACAK (kullanıcı kararı: biri araç,
// biri akış). Ama henüz Sembol/Bugün içine gömülmediler; erişim kaybolmasın
// diye şimdilik ilgili alanın altında bölüm olarak duruyorlar. Gömüldüklerinde
// buradan kalkacaklar.
//
// Eski ekranlar (Terminal, Piyasa Genel, Sembol İncele) menüden çıktı ama
// rotaları çalışmaya devam ediyor — yer imi ve elle yazılan adres bozulmasın.
// =============================================================================
import type { IconName } from '../components/ui'

export interface WorkspaceSection {
  to: string
  label: string
  end?: boolean
  badgeKey?: 'oracle' | 'news' | 'fundamentals'
}

export interface Workspace {
  id: string
  label: string
  icon: IconName
  /** Sekmeye tıklanınca gidilecek rota */
  home: string
  /** Bu alanın cevapladığı soru — alt satırda gösterilir */
  soru: string
  /** Bu alana ait bölümler (ikincil sekmeler) */
  sections: WorkspaceSection[]
}

export const WORKSPACES: Workspace[] = [
  {
    id: 'bugun', label: 'Bugün', icon: 'overview', home: '/bugun',
    soru: 'bugün alınacak bir şey var mı?',
    sections: [
      { to: '/bugun', label: 'Bugün' },
      // 14.09: yeni dile taşındı. Bugün'ün İÇİNE alınmadı — 200 haberlik
      // bir akış tek bir banda sığmıyor, Bugün'ü kendi sorusundan
      // ("bugün alınacak bir şey var mı") uzaklaştırırdı. Bugün özeti
      // gösteriyor, ayrıntı burada.
      { to: '/news', label: 'Haberler', badgeKey: 'news' },
    ],
  },
  {
    id: 'sembol', label: 'Sembol', icon: 'trending-up', home: '/sembol',
    soru: 'bu sembolde ne oluyor?',
    sections: [
      { to: '/sembol', label: 'Sembol' },
      // 14.09: yeni dile taşındı (kendi yoğun ızgara görünümünü koruyarak —
      // karşılaştırmada yoğunluk işin kendisi). Sembol'ün bir "modu" haline
      // getirilmedi: Sembol tek karara odaklı, bu ekran 8 sembole aynı anda
      // bakmak için; ikisini tek sayfaya sıkıştırmak ikisini de bozardı.
      { to: '/coklu-grafik', label: 'Karşılaştır' },
    ],
  },
  {
    // Faz F: üç ayrı tarama sayfası tek tabloda birleşmişti; TEFAS fonları
    // da aynı tabloya bir görünüm olarak eklendi.
    id: 'tarama', label: 'Tarama', icon: 'target', home: '/tarayici',
    soru: 'hangisini alayım?',
    sections: [
      { to: '/tarayici',         label: 'AI Tavsiye', badgeKey: 'oracle' },
      { to: '/tarayici?g=dip',   label: 'Dip Fırsatı' },
      { to: '/tarayici?g=temel', label: 'Temel Analiz', badgeKey: 'fundamentals' },
      { to: '/tarayici?g=fon',   label: 'Fonlar' },
    ],
  },
  {
    // Portföy = PARA. Modelin doğru olup olmadığı Model alanında.
    id: 'portfoy', label: 'Portföy', icon: 'briefcase', home: '/portfolio',
    soru: 'param ne yaptı?',
    sections: [
      { to: '/portfolio',     label: 'Portföyüm' },
      { to: '/model-portfoy', label: 'Model Portföyü' },
    ],
  },
  {
    // Model = DOĞRULUK. Çağrılar tuttu mu, olasılıklar dürüst mü.
    id: 'model', label: 'Model', icon: 'mlops', home: '/model',
    soru: 'buna güvenebilir miyim?',
    sections: [
      { to: '/model',   label: 'Durum & Kanıt' },
      { to: '/history', label: 'Tahmin Geçmişi' },
    ],
  },
]

/**
 * Bir rota hangi çalışma alanına ait? (bilinmiyorsa ilk alan)
 *
 * Yalnız kök adres burada: kaldırılan eski ekranlar (piyasa-genel, terminal,
 * degerlendirme) artık main.tsx'te YÖNLENDİRİLİYOR, yani bu haritaya hiç
 * ulaşmıyorlar. Eşlemeyi tutmak, var olmayan sayfalar için sekme kuralı
 * bakmak olurdu.
 */
const ESKI_ROTA_ALANI: Record<string, string> = {
  '/': 'bugun',
}

export function workspaceForPath(pathname: string): Workspace {
  const exact = WORKSPACES.find(w => w.sections.some(s => s.to === pathname))
  if (exact) return exact
  const eski = ESKI_ROTA_ALANI[pathname]
  if (eski) return WORKSPACES.find(w => w.id === eski) ?? WORKSPACES[0]
  return WORKSPACES[0]
}
