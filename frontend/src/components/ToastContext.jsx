import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ToastContext } from './toast'
import { Toast } from './UI'

const DURASI_TOAST_MS = 3500

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null)
  const timerRef = useRef(null)

  const showToast = useCallback((message, type = 'info') => {
    window.clearTimeout(timerRef.current)
    setToast({ message, type })
    timerRef.current = window.setTimeout(() => setToast(null), DURASI_TOAST_MS)
  }, [])

  // Toast dari luar React, mis. lib/api.js saat menerima 202.
  useEffect(() => {
    const handleToast = (event) => showToast(event.detail.message, event.detail.type)

    window.addEventListener('app:toast', handleToast)
    return () => {
      window.removeEventListener('app:toast', handleToast)
      window.clearTimeout(timerRef.current)
    }
  }, [showToast])

  const value = useMemo(() => ({ showToast }), [showToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && <Toast message={toast.message} type={toast.type} />}
    </ToastContext.Provider>
  )
}
