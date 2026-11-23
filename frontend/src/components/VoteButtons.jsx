import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { formatSkor, nilaiBerikutnya, pesanPenolakan, terapkanOptimistik } from '../lib/vote'
import { useToast } from './toast'

const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function Panah({ arah }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {arah === 'naik' ? <path d="m6 15 6-6 6 6" /> : <path d="m6 9 6 6 6-6" />}
    </svg>
  )
}

/**
 * Tombol upvote/downvote (T9.3, kelompok 9) untuk kartu dan detail puisi.
 * Skor diambil dari GET /api/poems/{id}/vote; klik langsung mengubah tampilan
 * (optimistik) lalu disesuaikan dengan jawaban PUT. Bila server menolak,
 * tampilan dikembalikan dan pesan ditampilkan. Penulis tidak dapat memilih
 * puisinya sendiri, tetapi melihat rincian naik/turun. Bila skor tidak bisa
 * dimuat (belum masuk, puisi contoh, layanan mati) tombol tidak ditampilkan.
 */
export default function VoteButtons({ poemId, ringkas = false }) {
  const { showToast } = useToast()
  const [skor, setSkor] = useState(null)
  const [mengirim, setMengirim] = useState(false)
  // Respons yang datang belakangan dari klik lama tidak boleh menimpa klik terbaru.
  const urutan = useRef(0)
  const idValid = typeof poemId === 'string' && POLA_UUID.test(poemId)

  useEffect(() => {
    if (!idValid) return undefined
    let aktif = true
    api
      .get(`/poems/${encodeURIComponent(poemId)}/vote`, { tanpaAlihLogin: true })
      .then(({ data }) => {
        if (aktif) setSkor(data)
      })
      .catch(() => {
        if (aktif) setSkor(null)
      })
    return () => {
      aktif = false
    }
  }, [poemId, idValid])

  if (!idValid || !skor) return null

  const pilih = async (tombol) => {
    if (skor.pemilik || mengirim) return
    const sebelum = skor
    const baru = nilaiBerikutnya(skor.nilai, tombol)
    const nomor = ++urutan.current
    setSkor(terapkanOptimistik(skor, baru))
    setMengirim(true)
    try {
      const { data } = await api.put(`/poems/${encodeURIComponent(poemId)}/vote`, { nilai: baru })
      if (nomor === urutan.current) setSkor(data)
    } catch (galat) {
      if (nomor === urutan.current) setSkor(sebelum)
      showToast(pesanPenolakan(galat), 'error')
    } finally {
      if (nomor === urutan.current) setMengirim(false)
    }
  }

  const judulPemilik = skor.pemilik ? 'Kamu tidak dapat memberi suara pada puisimu sendiri' : undefined

  return (
    <div className={`vote-buttons${ringkas ? ' vote-buttons-ringkas' : ''}`} aria-busy={mengirim}>
      <button
        type="button"
        className={`vote-button${skor.nilai === 1 ? ' vote-aktif-naik' : ''}`}
        onClick={() => pilih(1)}
        disabled={skor.pemilik}
        aria-pressed={skor.nilai === 1}
        aria-label={skor.nilai === 1 ? 'Tarik upvote' : 'Upvote'}
        title={judulPemilik}
      >
        <Panah arah="naik" />
      </button>
      <span className="vote-skor" aria-live="polite" title={`${skor.jumlah_suara} suara`}>
        {formatSkor(skor.skor)}
      </span>
      <button
        type="button"
        className={`vote-button${skor.nilai === -1 ? ' vote-aktif-turun' : ''}`}
        onClick={() => pilih(-1)}
        disabled={skor.pemilik}
        aria-pressed={skor.nilai === -1}
        aria-label={skor.nilai === -1 ? 'Tarik downvote' : 'Downvote'}
        title={judulPemilik}
      >
        <Panah arah="turun" />
      </button>
      {skor.pemilik && !ringkas && (
        <span className="vote-rincian">
          {skor.naik ?? 0} naik · {skor.turun ?? 0} turun
        </span>
      )}
    </div>
  )
}
