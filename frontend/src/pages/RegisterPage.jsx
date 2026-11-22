import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Input } from '../components/UI'
import { api } from '../lib/api'
import { pesanGalat } from '../lib/galat'
import { validasiRegistrasi } from '../lib/validasi'

const KOSONG = { username: '', email: '', display_name: '', password: '', confirm: '' }

export default function RegisterPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState(KOSONG)
  const [errors, setErrors] = useState({})
  const [pesan, setPesan] = useState('')
  const [sedangKirim, setSedangKirim] = useState(false)

  function ubah(e) {
    setForm({ ...form, [e.target.name]: e.target.value })
  }

  async function kirim(e) {
    e.preventDefault()
    const v = validasiRegistrasi(form)
    setErrors(v.errors)
    setPesan('')
    if (!v.ok) return

    setSedangKirim(true)
    try {
      await api.post('/auth/register', v.data)
      // Setelah daftar, arahkan ke halaman masuk (alur daftar lalu masuk).
      navigate('/login', { replace: true, state: { daftar: true } })
    } catch (err) {
      // Server bisa menolak field tertentu dengan detail; tampilkan di field-nya.
      const detail = err.data?.details
      if (err.status === 400 && detail) setErrors(detail)
      setPesan(pesanGalat(err))
    } finally {
      setSedangKirim(false)
    }
  }

  return (
    <section className="auth-page">
      <h1>Daftar</h1>

      <form className="form-stack" onSubmit={kirim} noValidate>
        <Input label="Username" name="username" value={form.username} onChange={ubah} autoComplete="username" />
        {errors.username && <p className="field-error">{errors.username}</p>}

        <Input label="Email" name="email" type="email" value={form.email} onChange={ubah} autoComplete="email" />
        {errors.email && <p className="field-error">{errors.email}</p>}

        <Input label="Nama tampil" name="display_name" value={form.display_name} onChange={ubah} />
        {errors.display_name && <p className="field-error">{errors.display_name}</p>}

        <Input label="Kata sandi" name="password" type="password" value={form.password} onChange={ubah} autoComplete="new-password" />
        {errors.password && <p className="field-error">{errors.password}</p>}

        <Input label="Ulangi kata sandi" name="confirm" type="password" value={form.confirm} onChange={ubah} autoComplete="new-password" />
        {errors.confirm && <p className="field-error">{errors.confirm}</p>}

        {pesan && <p className="form-error" role="alert">{pesan}</p>}

        <Button type="submit" disabled={sedangKirim}>
          {sedangKirim ? 'Memproses...' : 'Daftar'}
        </Button>
      </form>

      <p>
        Sudah punya akun? <Link to="/login">Masuk di sini</Link>
      </p>
    </section>
  )
}
