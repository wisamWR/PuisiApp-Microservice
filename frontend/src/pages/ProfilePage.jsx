import { useEffect, useState } from 'react'
import { Button, Input, Loader } from '../components/UI'
import { api, ApiError } from '../lib/api'
import { pesanGalat } from '../lib/galat'
import { validasiProfil } from '../lib/validasiProfil'

export default function ProfilePage() {
  const [profil, setProfil] = useState(null)
  const [form, setForm] = useState({ display_name: '', bio: '' })
  const [errors, setErrors] = useState({})
  const [pesan, setPesan] = useState('')
  const [sukses, setSukses] = useState('')
  const [loading, setLoading] = useState(true)
  const [sedangKirim, setSedangKirim] = useState(false)

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
      // Server bisa menolak field tertentu dengan detail; tampilkan di field-nya.
      const detail = err.data?.details
      if (err.status === 400 && detail) setErrors(detail)
      setPesan(pesanGalat(err))
    } finally {
      setSedangKirim(false)
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

      {!profil && pesan && <p className="form-error" role="alert">{pesan}</p>}
    </section>
  )
}
