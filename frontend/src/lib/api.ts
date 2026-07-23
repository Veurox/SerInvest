// =============================================================================
// SerInvest — API erişim katmanı
// Tüm component'ler bu modülü kullanır; URL/header yönetimi tek yerden.
// =============================================================================

// Geliştirme: localhost:8080 — üretim: VITE_API_URL env (relative).
export const API = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8080/api'

// Admin endpoint base — MLOps ve Yönetim sekmesindeki tüm proxy çağrıları.
export const ADMIN = `${API}/admin/oracle`

// Admin API anahtarı — localStorage > VITE env > boş
export const getAdminKey = (): string =>
  localStorage.getItem('si_admin_key') ||
  (import.meta.env.VITE_ADMIN_API_KEY as string | undefined) ||
  ''

// Yönetim endpoint'leri için header sağlayan fetch sarmalayıcı.
export const adminFetch = (url: string, init: RequestInit = {}): Promise<Response> =>
  fetch(url, {
    ...init,
    headers: {
      ...(init.headers || {}),
      'X-Admin-Key': getAdminKey(),
    },
  })
