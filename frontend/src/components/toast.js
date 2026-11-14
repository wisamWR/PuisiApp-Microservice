import { createContext, useContext } from 'react'

export const ToastContext = createContext(null)

/** Tampilkan toast dari komponen: const { showToast } = useToast() */
export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast harus dipakai di dalam <ToastProvider>.')
  }
  return context
}
