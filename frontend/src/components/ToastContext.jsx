import { createContext, useEffect, useState } from 'react'

const ToastContext = createContext(null)

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null)

  useEffect(() => {
    const handleToast = (event) => {
      setToast(event.detail)
      window.setTimeout(() => setToast(null), 3500)
    }

    window.addEventListener('app:toast', handleToast)
    return () => window.removeEventListener('app:toast', handleToast)
  }, [])

  const showToast = (message, type = 'info') => {
    setToast({ message, type })
    window.setTimeout(() => setToast(null), 3500)
  }

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && (
        <div className={`toast toast-${toast.type}`} role="status">
          <span className="toast-indicator" />
          {toast.message}
        </div>
      )}
    </ToastContext.Provider>
  )
}