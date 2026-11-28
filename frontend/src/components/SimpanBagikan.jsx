import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useToast } from './toast'

// T3.4: tombol Simpan (bookmark-service) dan Bagikan (tautan /p/{id} dengan meta Open Graph).
// awalTersimpan: status awal bila sudah diketahui (mis. di halaman Simpanan), agar tidak memanggil API.
export function SimpanBagikan({ poemId, title, awalTersimpan, onBerubah }) {
  const { showToast } = useToast()
  const [tersimpan, setTersimpan] = useState(awalTersimpan ?? null)
  const [sibuk, setSibuk] = useState(false)

  useEffect(() => {
    if (awalTersimpan !== undefined) return undefined
    let aktif = true
    api
      .get(`/me/bookmarks/${encodeURIComponent(poemId)}`, { tanpaAlihLogin: true })
      .then(({ data }) => aktif && setTersimpan(Boolean(data?.saved)))
      .catch(() => aktif && setTersimpan(false))
    return () => {
      aktif = false
    }
  }, [poemId, awalTersimpan])

  async function ubahSimpan() {
    setSibuk(true)
    const target = !tersimpan
    try {
      if (target) await api.put(`/me/bookmarks/${encodeURIComponent(poemId)}`)
      else await api.delete(`/me/bookmarks/${encodeURIComponent(poemId)}`)
      setTersimpan(target)
      onBerubah?.(target)
      showToast(target ? 'Puisi disimpan.' : 'Puisi dihapus dari Simpanan.', 'success')
    } catch (err) {
      if (err?.status !== 401) showToast(err?.message || 'Gagal menyimpan puisi.', 'error')
    } finally {
      setSibuk(false)
    }
  }

  async function bagikan() {
    const url = `${window.location.origin}/p/${poemId}`
    if (navigator.share) {
      try {
        await navigator.share({ title: title || 'Puisi di PuisiApp', url })
        return
      } catch (err) {
        if (err?.name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      showToast('Tautan disalin.', 'success')
    } catch {
      window.prompt('Salin tautan ini:', url)
    }
  }

  return (
    <div className="simpan-bagikan">
      <button
        type="button"
        className={`button button-outline simpan-tombol${tersimpan ? ' aktif' : ''}`}
        onClick={ubahSimpan}
        disabled={sibuk || tersimpan === null}
        aria-pressed={Boolean(tersimpan)}
      >
        {tersimpan ? '★ Tersimpan' : '☆ Simpan'}
      </button>
      <button type="button" className="button button-outline" onClick={bagikan}>
        Bagikan
      </button>
    </div>
  )
}
