// =============================================================================
// SerInvest — Piyasa Kartı + Liste Satırı
// AssetCard: grid görünümü kartı   |   AssetRow: liste görünümü satırı
// =============================================================================
import React from 'react'
import { DailyChangeBadge, Sparkline } from '../finance'
import { fmt } from '../../lib/format'
import type { PriceData } from '../../lib/types'
import { COMPANY_NAMES } from '../../lib/companies'
import { CompanyLogo } from '../common/CompanyLogo'

export function AssetCard({
  data, selected, onClick, starred, onStar,
}: {
  data: PriceData; selected: boolean; onClick: () => void
  starred?: boolean; onStar?: (e: React.MouseEvent) => void
}) {
  const change    = data.close != null && data.open != null ? data.close - data.open : null
  const changePct = change != null && data.open ? (change / data.open) * 100 : null
  const companyName = COMPANY_NAMES[data.symbol]

  return (
    <div className={`asset-card${selected ? ' selected' : ''}`} onClick={onClick}>
      {/* Üst satır: logo + sembol/ad + yıldız */}
      <div className="asset-card-header">
        <CompanyLogo symbol={data.symbol} size={34} />
        <div className="asset-card-info">
          <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
            <span className="asset-symbol">{data.symbol}</span>
            <span className={`asset-type-badge ${{ BIST: 'badge-bist', COMMODITY: 'badge-commodity', FOREX: 'badge-forex' }[data.assetType] ?? 'badge-general'}`}>
              {data.assetType}
            </span>
          </div>
          {companyName && <div className="asset-company-name">{companyName}</div>}
        </div>
        {onStar && (
          <button className={`star-btn${starred ? ' starred' : ''}`} onClick={onStar} title={starred ? 'Listeden çıkar' : 'Listeye ekle'}>
            {starred ? '★' : '☆'}
          </button>
        )}
      </div>

      {/* Fiyat + günlük değişim rozeti */}
      <div className="asset-price" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {fmt(data.close, data.assetType === 'FOREX' ? 4 : 2)}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <DailyChangeBadge changePct={changePct != null ? changePct / 100 : null} size="sm" />
        {change != null && (
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
            {change >= 0 ? '+' : ''}{fmt(change)}
          </span>
        )}
      </div>

      {/* 7-günlük sparkline */}
      <div style={{ marginTop: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
        <Sparkline symbol={data.symbol} days={7} width={220} height={32} showAxis />
      </div>

      {/* Sinyal + RSI */}
      <div className="signal-row">
        <span className={`signal-pill ${data.signal === 'BUY' ? 'signal-buy' : data.signal === 'SELL' ? 'signal-sell' : 'signal-neutral'}`}>
          {data.signal}
        </span>
        <span className="rsi-label">RSI {data.rsi != null ? fmt(data.rsi, 1) : '—'}</span>
      </div>
    </div>
  )
}

export function AssetRow({
  data, selected, onClick, starred, onStar,
}: {
  data: PriceData; selected: boolean; onClick: () => void
  starred?: boolean; onStar?: (e: React.MouseEvent) => void
}) {
  const change    = data.close != null && data.open != null ? data.close - data.open : null
  const changePct = change != null && data.open ? (change / data.open) * 100 : null
  const chClass   = change == null ? 'change-neu' : change >= 0 ? 'change-pos' : 'change-neg'
  const companyName = COMPANY_NAMES[data.symbol]

  return (
    <div className={`asset-row${selected ? ' selected' : ''}`} onClick={onClick}>
      {/* Logo */}
      <CompanyLogo symbol={data.symbol} size={34} />

      {/* İsim */}
      <div className="asset-row-name">
        <div className="asset-row-symbol">{data.symbol}</div>
        {companyName && <div className="asset-row-company">{companyName}</div>}
      </div>

      {/* Fiyat */}
      <div className="asset-row-price">{fmt(data.close, data.assetType === 'FOREX' ? 4 : 2)}</div>

      {/* Değişim */}
      <div className={`asset-row-change ${chClass}`}>
        {changePct != null ? `${changePct >= 0 ? '+' : ''}${fmt(changePct, 1)}%` : '—'}
      </div>

      {/* Sinyal */}
      <div className="asset-row-signal">
        <span className={`signal-pill ${data.signal === 'BUY' ? 'signal-buy' : data.signal === 'SELL' ? 'signal-sell' : 'signal-neutral'}`}>
          {data.signal}
        </span>
      </div>

      {/* RSI */}
      <div className="asset-row-rsi">RSI {data.rsi != null ? fmt(data.rsi, 1) : '—'}</div>

      {/* Yıldız */}
      {onStar && (
        <button className={`star-btn${starred ? ' starred' : ''}`} onClick={onStar} title={starred ? 'Listeden çıkar' : 'Listeye ekle'}>
          {starred ? '★' : '☆'}
        </button>
      )}
    </div>
  )
}
