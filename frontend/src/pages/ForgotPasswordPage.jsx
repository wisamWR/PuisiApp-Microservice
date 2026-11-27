import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Input } from '../components/UI'
import { api } from '../lib/api'
import { pesanGalat } from '../lib/galat'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [pesan, setPesan] = useState('')
  const [galat, setGalat] = useState('')
  const [sedangKirim, setSedangKirim] = useState(false)

  async function kirim(e) {
    e.preventDefault()
    setPesan('')
    setGalat('')

    if (!email.trim()) {
      setGalat('Alamat email wajib diisi.')
      return
    }

    setSedangKirim(true)
    try {
      await api.post('/auth/forgot-password', { email: email.trim() })
      setPesan('Jika email terdaftar, kami telah mengirimkan tautan pemulihan kata sandi (berlaku 30 menit).')
    } catch (err) {
      setGalat(pesanGalat(err))
    } finally {
      setSedangKirim(false)
    }
  }

  return (
    <section className="auth-page">
      <h1>Lupa Kata Sandi</h1>
      <p className="muted-text">
        Masukkan email akun Anda untuk menerima tautan atur ulang kata sandi.
      </p>

      <form className="form-stack" onSubmit={kirim} noValidate>
        <Input
          label="Email"
          name="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />

        {pesan && <p className="form-info" role="status">{pesan}</p>}
        {galat && <p className="form-error" role="alert">{galat}</p>}

        <Button type="submit" disabled={sedangKirim}>
          {sedangKirim ? 'Mengirim...' : 'Kirim Tautan Pemulihan'}
        </Button>
      </form>

      <p>
        Sudah ingat kata sandi? <Link to="/login">Kembali ke Masuk</Link> ·{' '}
        <Link to="/reset-password">Punya token reset?</Link>
      </p>
    </section>
  )
}
