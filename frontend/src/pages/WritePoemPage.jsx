/**
 * Halaman Tulis Puisi (T2.6, kelompok 2).
 *   /write              -> puisi baru, POST /api/poems
 *   /poems/:id/edit     -> revisi, PUT /api/poems/{id} (T2.4)
 *
 * - Draf tersimpan otomatis di localStorage dan dipulihkan saat dibuka lagi.
 * - Idempotency-Key dibuat sekali per draf: klik kirim berkali-kali atau
 *   kirim ulang setelah muat ulang tetap menghasilkan satu puisi.
 * - Pratinjau gambar kutipan (T2.5) dengan debounce 500 ms.
 * - Setelah 202, pindah ke halaman detail dengan tampilan optimistik.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { useToast } from '../components/toast'
import {
  BATAS,
  buatIdempotencyKey,
  buatPenyimpanDraf,
  drafKosong,
  galatServer,
  kunciDraf,
  panjang,
  pecahBait,
  TEMPLATE_BAWAAN,
  urlPratinjau,
  validasiForm,
} from '../lib/puisi'
import './WritePoemPage.css'

const JEDA_PRATINJAU_MS = 500
const JEDA_SIMPAN_DRAF_MS = 800
const penyimpan = buatPenyimpanDraf()

const WARNA_TEMPLATE = {
  latar1: ['#1B2337', '#34425F'],
  latar2: ['#F7F0E3', '#E4D2B6'],
  latar3: ['#2F5D50', '#6E9F87'],
}

const FORM_KOSONG = { judul: '', isi: '', indeksBait: null, template: 'latar1', kategori: '', kataKunci: '' }

/** Ubah data puisi dari API (respons 202 atau poem-query) ke bentuk form. */
function dariPuisi(p) {
  return {
    judul: p.title ?? '',
    isi: p.body ?? '',
    indeksBait: Number.isInteger(p.quote_stanza) ? p.quote_stanza : null,
    template: p.template_id ?? 'latar1',
    kategori: p.category ?? '',
    kataKunci: (p.keywords ?? []).join(', '),
  }
}

function useDebounce(nilai, jeda) {
  const [tertunda, setTertunda] = useState(nilai)
  useEffect(() => {
    const t = setTimeout(() => setTertunda(nilai), jeda)
    return () => clearTimeout(t)
  }, [nilai, jeda])
  return tertunda
}

const jam = (iso) => new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })

function Penghitung({ nilai, batas }) {
  const n = panjang(nilai)
  return <span className={`tulis-penghitung${n > batas ? ' lebih' : ''}`}>{n.toLocaleString('id-ID')} / {batas.toLocaleString('id-ID')}</span>
}

export default function WritePoemPage() {
  const { id: poemId } = useParams()
  const modeEdit = Boolean(poemId)
  const kunci = kunciDraf(poemId)
  const navigate = useNavigate()
  const location = useLocation()
  const { showToast } = useToast()

  // Draf lokal lebih diutamakan daripada data awal agar tulisan tidak pernah hilang.
  const [awal] = useState(() => {
    const draf = penyimpan.muat(kunci)
    if (draf?.form) return { form: draf.form, key: draf.idempotencyKey, dipulihkan: draf.disimpanPada }
    const dariState = location.state?.puisi
    return { form: dariState ? dariPuisi(dariState) : FORM_KOSONG, key: null, dipulihkan: null }
  })
  const [form, setForm] = useState(awal.form)
  const [idempotencyKey, setIdempotencyKey] = useState(() => awal.key ?? buatIdempotencyKey())
  const [templates, setTemplates] = useState(TEMPLATE_BAWAAN)
  const [galat, setGalat] = useState({})
  const [mengirim, setMengirim] = useState(false)
  const [statusDraf, setStatusDraf] = useState(awal.dipulihkan ? `Draf dipulihkan (${jam(awal.dipulihkan)})` : '')
  const [statusMuat, setStatusMuat] = useState(modeEdit && !awal.dipulihkan && !location.state?.puisi ? 'memuat' : 'siap')
  // Status pratinjau dicatat per URL, jadi URL baru otomatis berstatus "memuat".
  const [urlGagal, setUrlGagal] = useState(null)
  const [urlSelesai, setUrlSelesai] = useState(null)
  const formRef = useRef(null)
  // Penjaga sinkron: dua klik dalam satu frame terjadi sebelum state `mengirim`
  // sempat me-render tombol nonaktif, jadi state saja tidak cukup.
  const sedangMengirim = useRef(false)
  // Fokus ke field galat pertama dilakukan setelah render (atribut aria-invalid sudah terpasang).
  const fokusKeGalat = useRef(false)
  useEffect(() => {
    if (!fokusKeGalat.current) return
    fokusKeGalat.current = false
    formRef.current?.querySelector('[aria-invalid="true"]')?.focus()
  }, [galat])

  useEffect(() => {
    if (awal.dipulihkan) showToast('Draf terakhir dipulihkan.', 'info')
  }, [awal.dipulihkan, showToast])

  // Daftar template dari image-preview-service; bawaan dipakai bila gagal.
  useEffect(() => {
    let batal = false
    api.get('/images/templates')
      .then(({ data }) => { if (!batal && Array.isArray(data) && data.length) setTemplates(data) })
      .catch(() => {})
    return () => { batal = true }
  }, [])

  // Mode edit tanpa draf dan tanpa data dari halaman sebelumnya: ambil dari poem-query (T2.3).
  useEffect(() => {
    if (statusMuat !== 'memuat') return
    let batal = false
    api.get(`/poems/${poemId}`)
      .then(({ data }) => { if (!batal) { setForm(dariPuisi(data)); setStatusMuat('siap') } })
      .catch(() => { if (!batal) setStatusMuat('gagal') })
    return () => { batal = true }
  }, [statusMuat, poemId])

  // Simpan draf otomatis setelah berhenti mengetik.
  useEffect(() => {
    if (statusMuat !== 'siap') return
    const t = setTimeout(() => {
      if (drafKosong(form)) return
      if (penyimpan.simpan(kunci, { form, idempotencyKey })) setStatusDraf(`Draf tersimpan ${jam(new Date())}`)
    }, JEDA_SIMPAN_DRAF_MS)
    return () => clearTimeout(t)
  }, [form, idempotencyKey, kunci, statusMuat])

  const bait = useMemo(() => pecahBait(form.isi), [form.isi])
  // Pilihan pengguna dipakai bila masih ada; bila belum memilih, bait pertama.
  const indeksEfektif = Number.isInteger(form.indeksBait) && form.indeksBait < bait.length ? form.indeksBait : bait.length ? 0 : null
  const teksKutipan = indeksEfektif === null ? '' : bait[indeksEfektif]
  const kutipanTerlaluPanjang = panjang(teksKutipan) > BATAS.baitKutipan

  const urlTertunda = useDebounce(kutipanTerlaluPanjang ? null : urlPratinjau(form.template, teksKutipan), JEDA_PRATINJAU_MS)
  const pratinjauGagal = urlTertunda !== null && urlGagal === urlTertunda
  const pratinjauMemuat = urlTertunda !== null && urlSelesai !== urlTertunda && !pratinjauGagal

  const ubah = (field) => (e) => {
    setForm((f) => ({ ...f, [field]: e.target.value }))
    setGalat((g) => ({ ...g, [{ judul: 'title', isi: 'body', kategori: 'category', kataKunci: 'keywords' }[field]]: undefined }))
  }

  const hapusDraf = () => {
    penyimpan.hapus(kunci)
    setForm(modeEdit && location.state?.puisi ? dariPuisi(location.state.puisi) : FORM_KOSONG)
    setIdempotencyKey(buatIdempotencyKey())
    setGalat({})
    setStatusDraf('')
    showToast('Draf dihapus.', 'info')
  }

  const kirim = async (e) => {
    e.preventDefault()
    if (sedangMengirim.current) return
    const templateSah = templates.map((t) => t.id)
    const { galat: g, body } = validasiForm({ ...form, indeksBait: indeksEfektif }, templateSah)
    if (Object.keys(g).length) {
      fokusKeGalat.current = true
      setGalat(g)
      return
    }
    setGalat({})

    sedangMengirim.current = true
    setMengirim(true)
    try {
      const opsi = { headers: { 'Idempotency-Key': idempotencyKey } }
      const { data } = modeEdit ? await api.put(`/poems/${poemId}`, body, opsi) : await api.post('/poems', body, opsi)
      penyimpan.hapus(kunci)
      navigate(`/poems/${data.poem_id}`, { state: { puisiDiproses: data } })
    } catch (err) {
      if (!(err instanceof ApiError)) {
        showToast('Tidak dapat terhubung ke server. Draf tetap tersimpan, coba lagi.', 'error')
      } else if (err.status === 400) {
        fokusKeGalat.current = true
        setGalat(galatServer(err.data))
        showToast(err.message, 'error')
      } else if (err.status === 409) {
        // Key sudah dipakai untuk isi lain (draf terkirim lalu diubah). Mulai key baru.
        setIdempotencyKey(buatIdempotencyKey())
        showToast('Draf ini sudah pernah terkirim dengan isi berbeda. Kirim sekali lagi untuk membuat versi baru.', 'error')
      } else if (err.status === 403 || err.status === 404) {
        showToast(err.message, 'error')
      } else if (err.status !== 401) {
        showToast(`${err.message} Draf tetap tersimpan.`, 'error')
      }
    } finally {
      sedangMengirim.current = false
      setMengirim(false)
    }
  }

  const tidakValid = (f) => (galat[f] ? { 'aria-invalid': 'true', 'aria-describedby': `galat-${f}` } : {})
  const pesan = (f) => galat[f] && <span className="tulis-galat" id={`galat-${f}`}>{galat[f]}</span>

  if (statusMuat === 'memuat') {
    return <section className="page-section"><p className="muted-text">Memuat puisi...</p></section>
  }

  return (
    <section className="page-section">
      <div className="page-heading tulis-heading">
        <div>
          <span className="eyebrow">PUISIAPP / PENULISAN</span>
          <h1>{modeEdit ? 'Revisi Puisi' : 'Tulis Puisi'}</h1>
          <p>
            {modeEdit
              ? 'Revisi disimpan sebagai versi baru. Versi lama tetap tampil sampai versi baru selesai diperiksa.'
              : 'Tuliskan puisimu, pilih satu bait sebagai kutipan, lalu kirim. Analisis dan gambar dibuat di latar belakang.'}
          </p>
        </div>
        {statusDraf && <span className="status-chip">{statusDraf}</span>}
      </div>

      {statusMuat === 'gagal' && (
        <p className="tulis-pemberitahuan">
          Data puisi belum bisa dimuat. Kamu tetap bisa menulis ulang isinya di bawah sebagai versi baru.
        </p>
      )}

      <form className="tulis-tata" onSubmit={kirim} ref={formRef} noValidate>
        <div className="tulis-kolom">
          <label className="tulis-field">
            <span className="tulis-label">Judul <Penghitung nilai={form.judul} batas={BATAS.judul} /></span>
            <input className="input tulis-judul" value={form.judul} onChange={ubah('judul')} placeholder="Judul puisi" {...tidakValid('title')} />
            {pesan('title')}
          </label>

          <label className="tulis-field">
            <span className="tulis-label">Isi puisi <Penghitung nilai={form.isi} batas={BATAS.isi} /></span>
            <textarea
              className="input tulis-isi"
              value={form.isi}
              onChange={ubah('isi')}
              rows={14}
              placeholder={'sore turun tanpa permisi\nhujan mengetuk kaca\n\n(baris kosong memisahkan bait)'}
              {...tidakValid('body')}
            />
            <span className="tulis-petunjuk">Pisahkan bait dengan satu baris kosong. {bait.length > 0 && `${bait.length} bait terdeteksi.`}</span>
            {pesan('body')}
          </label>

          <fieldset className="tulis-field tulis-fieldset" tabIndex={-1} {...tidakValid('quote_stanza')}>
            <legend className="tulis-label">Bait kutipan untuk gambar</legend>
            {bait.length === 0 && <p className="tulis-petunjuk">Bait akan muncul di sini setelah kamu menulis isi puisi.</p>}
            <div className="tulis-daftar-bait">
              {bait.map((b, i) => {
                const n = panjang(b)
                const terlalu = n > BATAS.baitKutipan
                return (
                  <label key={i} className={`tulis-bait${indeksEfektif === i ? ' dipilih' : ''}${terlalu ? ' terlalu' : ''}`}>
                    <input
                      type="radio"
                      name="bait"
                      checked={indeksEfektif === i}
                      onChange={() => { setForm((f) => ({ ...f, indeksBait: i })); setGalat((g) => ({ ...g, quote_stanza: undefined })) }}
                    />
                    <span className="tulis-bait-nomor">Bait {i + 1}</span>
                    <span className="tulis-bait-teks">{b}</span>
                    <span className="tulis-bait-meta">{terlalu ? `${n} karakter, maksimal ${BATAS.baitKutipan}` : `${n} karakter`}</span>
                  </label>
                )
              })}
            </div>
            {pesan('quote_stanza')}
          </fieldset>

          <fieldset className="tulis-field tulis-fieldset" tabIndex={-1} {...tidakValid('template_id')}>
            <legend className="tulis-label">Template gambar</legend>
            <div className="tulis-template">
              {templates.map((t) => {
                const [a, b] = WARNA_TEMPLATE[t.id] ?? ['#eee8e1', '#d9cec5']
                return (
                  <button
                    type="button"
                    key={t.id}
                    className={`tulis-template-pilihan${form.template === t.id ? ' dipilih' : ''}`}
                    aria-pressed={form.template === t.id}
                    onClick={() => setForm((f) => ({ ...f, template: t.id }))}
                  >
                    <span className="tulis-swatch" style={{ background: `linear-gradient(135deg, ${a}, ${b})` }} />
                    {t.nama}
                  </button>
                )
              })}
            </div>
            {pesan('template_id')}
          </fieldset>

          <details className="tulis-tambahan" open={Boolean(form.kategori || form.kataKunci)}>
            <summary>Detail tambahan (opsional)</summary>
            <label className="tulis-field">
              <span className="tulis-label">Kategori</span>
              <input className="input" value={form.kategori} onChange={ubah('kategori')} placeholder="mis. lirik" {...tidakValid('category')} />
              {pesan('category')}
            </label>
            <label className="tulis-field">
              <span className="tulis-label">Kata kunci</span>
              <input className="input" value={form.kataKunci} onChange={ubah('kataKunci')} placeholder="hujan, rindu" {...tidakValid('keywords')} />
              <span className="tulis-petunjuk">Pisahkan dengan koma, maksimal {BATAS.jumlahKataKunci}. Kata kunci otomatis tetap dibuat sistem.</span>
              {pesan('keywords')}
            </label>
          </details>

          <div className="tulis-aksi">
            <button type="submit" className="button button-primary" disabled={mengirim}>
              {mengirim ? 'Mengirim...' : modeEdit ? 'Kirim revisi' : 'Kirim puisi'}
            </button>
            <button type="button" className="button button-outline" onClick={hapusDraf} disabled={mengirim || drafKosong(form)}>
              Hapus draf
            </button>
          </div>
        </div>

        <aside className="tulis-pratinjau" aria-live="polite">
          <span className="eyebrow">PRATINJAU GAMBAR KUTIPAN</span>
          <div className="tulis-pratinjau-bingkai">
            {urlTertunda && !pratinjauGagal ? (
              <img
                key={urlTertunda}
                src={urlTertunda}
                alt={`Pratinjau gambar kutipan: ${teksKutipan}`}
                className={pratinjauMemuat ? 'memuat' : ''}
                onLoad={() => setUrlSelesai(urlTertunda)}
                onError={() => setUrlGagal(urlTertunda)}
              />
            ) : (
              <p className="tulis-pratinjau-kosong">
                {pratinjauGagal
                  ? 'Pratinjau sedang tidak tersedia. Puisi tetap bisa dikirim; gambar final dibuat setelah dikirim.'
                  : kutipanTerlaluPanjang
                    ? `Bait terpilih lebih dari ${BATAS.baitKutipan} karakter. Pilih bait yang lebih pendek.`
                    : 'Tulis isi puisi untuk melihat pratinjau gambar kutipan.'}
              </p>
            )}
          </div>
          <p className="tulis-petunjuk">Gambar final berukuran lebih besar dibuat otomatis setelah puisi dikirim.</p>
        </aside>
      </form>
    </section>
  )
}
