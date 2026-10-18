// =============================================================================
// SerInvest — bildirim (toast) bağlamı ve hook'u
// Toast.tsx'ten ayrıldı (18.10.2026): bileşen dosyası yalnız bileşen dışa
// açarsa hızlı yenileme (HMR) güvenilir çalışır.
// =============================================================================
import { createContext, useContext } from 'react'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface ToastContextValue {
  show: (message: string, type?: ToastType, duration?: number) => void
  success: (message: string) => void
  error: (message: string) => void
  warning: (message: string) => void
  info: (message: string) => void
}

export const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    // Provider yoksa no-op döndür (hata fırlatmasın)
    return {
      show: () => {}, success: () => {}, error: () => {}, warning: () => {}, info: () => {},
    }
  }
  return ctx
}
