import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './theme.css'      // Önce token'lar — sonraki tüm CSS bunları kullanır
import './design/tokens.css'   // Yeni arayüz jetonları (.ui2 kapsamında)
import './index.css'
import './components/dashboard/dashboard.css'
import './components/watchlist/watchlist.css'
import './components/ui/datatable.css'
import './shell/shell.css'
import './components/terminal/terminal.css'
import './components/multichart/multichart.css'
import App from './App.tsx'
import { ToastProvider } from './components/ui/Toast'

// ── Sayfalar (route'lar) ─────────────────────────────────────────────────────
import OverviewPage from './pages/OverviewPage'
import TodayPage from './pages/TodayPage'
import TerminalPage from './pages/TerminalPage'
import MultiChartPage from './pages/MultiChartPage'
import ModelPage from './pages/ModelPage'
import ScreenerPage from './pages/ScreenerPage'
import ModelPortfolioPage from './pages/ModelPortfolioPage'
import NewsPage from './pages/NewsPage'
import EvaluationPage from './pages/EvaluationPage'
import { PortfolioTab } from './tabs/PortfolioTab'
import { HistoryTab } from './tabs/HistoryTab'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          {/* App = Layout (header + nav + ortak veri) */}
          <Route path="/" element={<App />}>
            <Route index               element={<OverviewPage />} />
            <Route path="bugun"         element={<TodayPage />} />
            <Route path="terminal"      element={<TerminalPage />} />
            <Route path="coklu-grafik"  element={<MultiChartPage />} />
            <Route path="model-portfoy" element={<ModelPortfolioPage />} />
            <Route path="tarayici"      element={<ScreenerPage />} />
            {/* Eski tarama sayfaları — yer imleri kırılmasın diye yönlendirilir (Faz F) */}
            <Route path="oracle"        element={<Navigate to="/tarayici" replace />} />
            <Route path="dip-radar"     element={<Navigate to="/tarayici?g=dip" replace />} />
            <Route path="fundamental"   element={<Navigate to="/tarayici?g=temel" replace />} />
            <Route path="portfolio"     element={<PortfolioTab />} />
            <Route path="history"       element={<HistoryTab />} />
            <Route path="news"          element={<NewsPage />} />
            {/* Model = eski ML Ops + Yönetim (07/2026 sadeleştirme).
                Eski rotalar korunur; yer imi/derin link kırılmasın. */}
            <Route path="model"         element={<ModelPage />} />
            <Route path="degerlendirme" element={<EvaluationPage />} />
            {/* Bilinmeyen route → Piyasa Genel */}
            <Route path="*"             element={<OverviewPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  </StrictMode>,
)
