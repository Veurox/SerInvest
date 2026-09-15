import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './theme.css'      // Önce token'lar — sonraki tüm CSS bunları kullanır
import './design/tokens.css'   // Yeni arayüz jetonları (.ui2 kapsamında)
import './index.css'
import './components/watchlist/watchlist.css'
import './components/ui/datatable.css'
import './shell/shell.css'
import './components/multichart/multichart.css'
import App from './App.tsx'
import { ToastProvider } from './components/ui/Toast'

// ── Sayfalar (route'lar) ─────────────────────────────────────────────────────
import TodayPage from './pages/TodayPage'
import SymbolPage from './pages/SymbolPage'
import MultiChartPage from './pages/MultiChartPage'
import ModelPage from './pages/ModelPage'
import ScreenerPage from './pages/ScreenerPage'
import ModelPortfolioPage from './pages/ModelPortfolioPage'
import NewsPage from './pages/NewsPage'
import { PortfolioTab } from './tabs/PortfolioTab'
import { HistoryTab } from './tabs/HistoryTab'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          {/* App = Layout (header + nav + ortak veri) */}
          <Route path="/" element={<App />}>
            {/* Açılış = Bugün (docs/PLAN_ARAYUZ.md §1). Kullanıcı uygulamayı
                "bugün alınacak bir şey var mı" diye açıyor; açılış sayfası
                doğrudan o soruyu cevaplamalı. */}
            <Route index               element={<TodayPage />} />
            <Route path="bugun"         element={<TodayPage />} />
            <Route path="sembol"        element={<SymbolPage />} />
            <Route path="coklu-grafik"  element={<MultiChartPage />} />
            <Route path="model-portfoy" element={<ModelPortfolioPage />} />
            <Route path="tarayici"      element={<ScreenerPage />} />
            {/* KALDIRILAN SAYFALAR (15.09.2026) — yer imi kırılmasın diye
                yönlendiriliyor. Üçü de menüde erişilemiyordu, eski tasarımda
                kalmıştı ve işlerini yeni sayfalar devralmıştı:
                  piyasa-genel  → Bugün
                  terminal      → Sembol
                  degerlendirme → Sembol (90 varlığın hepsini listeliyor;
                                  model analizi olmayanda seviyelerle devam eder)
                Gerekçe ve ekran görüntüleri: docs/PLAN_ARAYUZ.md */}
            <Route path="piyasa-genel"  element={<Navigate to="/bugun" replace />} />
            <Route path="terminal"      element={<Navigate to="/sembol" replace />} />
            <Route path="degerlendirme" element={<Navigate to="/sembol" replace />} />

            {/* Eski tarama sayfaları — yer imleri kırılmasın diye yönlendirilir (Faz F) */}
            <Route path="oracle"        element={<Navigate to="/tarayici" replace />} />
            <Route path="dip-radar"     element={<Navigate to="/tarayici?g=dip" replace />} />
            <Route path="fundamental"   element={<Navigate to="/tarayici?g=temel" replace />} />
            <Route path="portfolio"     element={<PortfolioTab />} />
            <Route path="history"       element={<HistoryTab />} />
            <Route path="news"          element={<NewsPage />} />
            {/* Model = eski ML Ops + Yönetim (07/2026 sadeleştirme). */}
            <Route path="model"         element={<ModelPage />} />
            {/* Bilinmeyen adres → açılış sayfası.
                Önce eski Piyasa Genel'e düşüyordu ve bu iki şeyi birden
                bozuyordu: kullanıcı yanlış yazdığını anlamıyordu (sayfa
                açılıyor, ama istediği değil) ve karşısına taşınmamış ESKİ
                tasarım çıkıyordu — üstelik menüde "Bugün" sekmesi yanarken.
                Yönlendirme, adres çubuğunu da düzelttiği için sessiz
                kalmıyor: kullanıcı nereye düştüğünü görüyor. */}
            <Route path="*"             element={<Navigate to="/bugun" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  </StrictMode>,
)
