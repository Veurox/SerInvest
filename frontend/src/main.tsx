import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './theme.css'      // Önce token'lar — sonraki tüm CSS bunları kullanır
import './index.css'
import './components/dashboard/dashboard.css'
import './components/watchlist/watchlist.css'
import './shell/shell.css'
import './components/terminal/terminal.css'
import App from './App.tsx'
import { ToastProvider } from './components/ui/Toast'

// ── Sayfalar (route'lar) ─────────────────────────────────────────────────────
import OverviewPage from './pages/OverviewPage'
import TerminalPage from './pages/TerminalPage'
import ModelPage from './pages/ModelPage'
import OraclePage from './pages/OraclePage'
import RadarPage from './pages/RadarPage'
import ModelPortfolioPage from './pages/ModelPortfolioPage'
import NewsPage from './pages/NewsPage'
import FundamentalPage from './pages/FundamentalPage'
import EvaluationPage from './pages/EvaluationPage'
import DipRadarPage from './pages/DipRadarPage'
import { PortfolioTab } from './tabs/PortfolioTab'
import { HistoryTab } from './tabs/HistoryTab'
import { MLOpsTab } from './tabs/MLOpsTab'
import { AdminTab } from './tabs/AdminTab'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          {/* App = Layout (header + nav + ortak veri) */}
          <Route path="/" element={<App />}>
            <Route index               element={<OverviewPage />} />
            <Route path="terminal"      element={<TerminalPage />} />
            <Route path="radar"         element={<RadarPage />} />
            <Route path="model-portfoy" element={<ModelPortfolioPage />} />
            <Route path="oracle"        element={<OraclePage />} />
            <Route path="portfolio"     element={<PortfolioTab />} />
            <Route path="history"       element={<HistoryTab />} />
            <Route path="news"          element={<NewsPage />} />
            <Route path="fundamental"   element={<FundamentalPage />} />
            {/* Model = eski ML Ops + Yönetim (07/2026 sadeleştirme).
                Eski rotalar korunur; yer imi/derin link kırılmasın. */}
            <Route path="model"         element={<ModelPage />} />
            <Route path="mlops"         element={<MLOpsTab />} />
            <Route path="admin"         element={<AdminTab />} />
            <Route path="degerlendirme" element={<EvaluationPage />} />
            <Route path="dip-radar"     element={<DipRadarPage />} />
            {/* Bilinmeyen route → Piyasa Genel */}
            <Route path="*"             element={<OverviewPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  </StrictMode>,
)
