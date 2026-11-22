import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Input, Loader } from '../components/UI'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { pesanGalat } from '../lib/galat'
import { validasiProfil } from '../lib/validasiProfil'

export default function ProfilePage() {
  const navigate = useNavigate()
  const { setUser } = useAuth()
  const [profil, setProfil] = useState(null)
  const [form, setForm] = useState({ display_name: '', bio: '' })
  const [errors, setErrors] = useState({})
  const [pesan, setPesan] = useState('')
  const [sukses, setSukses] = useState('')
  const [loading, setLoading] = useState(true)
  const [sedangKirim, setSedangKirim] = useState(false)

  // Hapus akun
  const [kataSandiHapus, setKataSandiHapus] = useState('')
  const [setujuHapus, setSetujuHapus] = useState(false)
  const [sedangHapus, setSedangHapus] = useState(false)
  const [pesanHapus, setPesanHapus] = useState('')

  useEffect(() => {
    let aktif = true
    api
      .get('/profiles/me')
      .then((data) => {
        if (!aktif) return
        setProfil(data)
        setForm({ display_name: data.display_name, bio: data.bio ?? '' })
      })
      .catch((err) => {
        if (aktif) setPesan(err instanceof ApiError && err.status === 404 ? 'Profil belum tersedia.' : pesanGalat(err))
      })
      .finally(() => {
        if (aktif) setLoading(false)
      })
    return () => {
      aktif = false
    }
  }, [])

  function ubah(e) {
    setForm({ ...form, [e.target.name]: e.target.value })
    setSukses('')
  }

  async function simpan(e) {
    e.preventDefault()
    const v = validasiProfil(form)
    setErrors(v.errors)
    setPesan('')
    setSukses('')
    if (!v.ok) return

    setSedangKirim(true)
    try {
      const data = await api.put('/profiles/me', v.data)
      setProfil(data)
      setForm({ display_name: data.display_name, bio: data.bio ?? '' })
      setSukses('Profil tersimpan.')
    } catch (err) {
      const detail = err.data?.details
      if (err.status === 400 && detail) setErrors(detail)
      setPesan(pesanGalat(err))
    } finally {
      setSedangKirim(false)
    }
  }

  async function hapusAkun(e) {
    e.preventDefault()
    setPesanHapus('')
    if (!setujuHapus) {
      setPesanHapus('Centang persetujuan dulu untuk menghapus akun.')
      return
    }
    if (!kataSandiHapus) {
      setPesanHapus('Masukkan kata sandi untuk konfirmasi.')
      return
    }
    setSedangHapus(true)
    try {
      await api.delete('/me', { body: { password: kataSandiHapus } })
      // Akun dihapus. Cabut sesi di server (token dan refresh) lalu kembali ke halaman Masuk.
      try {
        await api.post('/auth/logout')
      } catch {
        // abaikan: cookie sudah dihapus oleh server
      }
      setUser(null)
      navigate('/login', { replace: true, state: { info: 'Akun kamu sudah dihapus.' } })
    } catch (err) {
      if (err.status === 403) setPesanHapus('Kata sandi salah.')
      else if (err.status === 409) setPesanHapus('Akun ini sudah dihapus.')
      else setPesanHapus(pesanGalat(err))
    } finally {
      setSedangHapus(false)
    }
  }

  if (loading) return <Loader label="Memuat profil..." />

  return (
    <section className="auth-page">
      <h1>Profil Saya</h1>
      {profil && <p className="muted-text">Username: {profil.username}</p>}

      {profil && (
        <form className="form-stack" onSubmit={simpan} noValidate>
          <Input label="Nama tampil" name="display_name" value={form.display_name} onChange={ubah} />
          {errors.display_name && <p className="field-error">{errors.display_name}</p>}

          <label className="input-group">
            <span>Bio</span>
            <textarea name="bio" rows={4} value={form.bio} onChange={ubah} className="input" />
          </label>
          {errors.bio && <p className="field-error">{errors.bio}</p>}

          {sukses && <p className="form-info" role="status">{sukses}</p>}
          {pesan && <p className="form-error" role="alert">{pesan}</p>}

          <Button type="submit" disabled={sedangKirim}>
            {sedangKirim ? 'Menyimpan...' : 'Simpan'}
          </Button>
        </form>
      )}

      {profil && (
        <section className="danger-zone">
          <h2>Hapus akun</h2>
          <p className="muted-text">
            Akun akan dihapus dan tidak bisa dipakai masuk lagi. Tindakan ini tidak bisa dibatalkan dari aplikasi.
          </p>
          <form className="form-stack" onSubmit={hapusAkun} noValidate>
            <Input
              label="Kata sandi untuk konfirmasi"
              name="kata_sandi_hapus"
              type="password"
              value={kataSandiHapus}
              onChange={(e) => setKataSandiHapus(e.target.value)}
              autoComplete="current-password"
            />
            <label className="check-row">
              <input type="checkbox" checked={setujuHapus} onChange={(e) => setSetujuHapus(e.target.checked)} />
              <span>Saya mengerti akun ini akan dihapus.</span>
            </label>
            {pesanHapus && <p className="form-error" role="alert">{pesanHapus}</p>}
            <Button type="submit" disabled={sedangHapus}>
              {sedangHapus ? 'Menghapus...' : 'Hapus akun saya'}
            </Button>
          </form>
        </section>
      )}

      {!profil && pesan && <p className="form-error" role="alert">{pesan}</p>}
    </section>
  )
}
