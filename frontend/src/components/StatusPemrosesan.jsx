/**
 * Daftar langkah pemrosesan puisi milik sendiri yang tercentang langsung
 * (T2.7) lewat Server-Sent Events: GET /api/poems/{id}/status/stream.
 *
 * EventSource menyambung ulang sendiri bila koneksi putus (server mengirim
 * snapshot terkini setiap tersambung). Stream ditutup setelah semua langkah
 * selesai dan keputusan publikasi ada.
 */
import { useEffect, useState } from 'react'
import { sudahFinal, tampilanStatus } from '../lib/statusProses'

export default function StatusPemrosesan({ poemId }) {
  const [snapshot, setSnapshot] = useState(null)
  const [putus, setPutus] = useState(false)

  useEffect(() => {
    if (!poemId || typeof EventSource === 'undefined') return undefined
    const sumber = new EventSource(`/api/poems/${encodeURIComponent(poemId)}/status/stream`)
    sumber.addEventListener('status', (ev) => {
      const data = JSON.parse(ev.data)
      setSnapshot(data)
      setPutus(false)
      if (sudahFinal(data)) sumber.close()
    })
    sumber.onerror = () => setPutus(sumber.readyState !== EventSource.OPEN)
    return () => sumber.close()
  }, [poemId])

  const t = tampilanStatus(snapshot)
  if (!t) {
    return <p className="status-proses-memuat">Menyambungkan status pemrosesan...</p>
  }
  return (
    <section className="status-proses" aria-live="polite" aria-label="Status pemrosesan puisi">
      <div className="status-proses-atas">
        <strong>{t.judul}</strong>
        <span className="status-proses-persen">{t.persen}%</span>
      </div>
      <div className="status-proses-bilah" role="progressbar" aria-valuenow={t.persen} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${t.persen}%` }} />
      </div>
      <ul className="status-proses-daftar">
        {t.langkah.map((l) => (
          <li key={l.name} className={l.done ? 'selesai' : ''}>
            <span className="status-proses-tanda" aria-hidden="true">{l.done ? '✓' : ''}</span>
            {l.label}
            <span className="sr-only">{l.done ? ' selesai' : ' menunggu'}</span>
          </li>
        ))}
      </ul>
      <p className="status-proses-keterangan">{t.keterangan}</p>
      {putus && <p className="status-proses-putus">Koneksi terputus, menyambung ulang...</p>}
    </section>
  )
}
