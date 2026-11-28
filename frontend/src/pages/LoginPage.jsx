import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Button, Input } from '../components/UI'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { pesanGalat, tujuanSetelahMasuk } from '../lib/galat'
import { validasiMasuk } from '../lib/validasi'

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { setUser } = useAuth()
  const [form, setForm] = useState({ username: '', password: '' })
  const [errors, setErrors] = useState({})
  const [pesan, setPesan] = useState('')
  const [sedangKirim, setSedangKirim] = useState(false)

  const dariDaftar = location.state?.daftar === true
  const next = new URLSearchParams(location.search).get('next')

  function ubah(e) {
    setForm({ ...form, [e.target.name]: e.target.value })
  }

  async function kirim(e) {
    e.preventDefault()
    const v = validasiMasuk(form)
    setErrors(v.errors)
    setPesan('')
    if (!v.ok) return

    setSedangKirim(true)
    try {
      const { data } = await api.post('/auth/login', v.data)
      setUser({ id: data.id ?? null, username: data.username, role: data.role })
      navigate(tujuanSetelahMasuk(next), { replace: true })
    } catch (err) {
      setPesan(pesanGalat(err))
    } finally {
      setSedangKirim(false)
    }
  }

  return (
    <section className="auth-page">
      <h1>Masuk</h1>
      {dariDaftar && <p className="form-info">Akun berhasil dibuat. Silakan masuk.</p>}

      <form className="form-stack" onSubmit={kirim} noValidate>
        <Input
          label="Username"
          name="username"
          value={form.username}
          onChange={ubah}
          autoComplete="username"
        />
        {errors.username && <p className="field-error">{errors.username}</p>}

        <Input
          label="Kata sandi"
          name="password"
          type="password"
          value={form.password}
          onChange={ubah}
          autoComplete="current-password"
        />
        {errors.password && <p className="field-error">{errors.password}</p>}

        {pesan && <p className="form-error" role="alert">{pesan}</p>}

        <Button type="submit" disabled={sedangKirim}>
          {sedangKirim ? 'Memproses...' : 'Masuk'}
        </Button>
      </form>

      <p>
        Belum punya akun? <Link to="/register">Daftar di sini</Link> · <Link to="/forgot-password">Lupa kata sandi?</Link>
      </p>
    </section>
  )
}
