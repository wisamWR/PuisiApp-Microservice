import { useEffect, useState } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { Button, Input } from '../components/UI'
import { api } from '../lib/api'
import { pesanGalat } from '../lib/galat'

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [token, setToken] = useState('')
  const [password, setPassword] = useState('')
  const [konfirmasi, setKonfirmasi] = useState('')
  const [pesan, setPesan] = useState('')
  const [galat, setGalat] = useState('')
  const [sedangKirim, setSedangKirim] = useState(false)

  useEffect(() => {
    const t = searchParams.get('token')
    if (t) setToken(t)
  }, [searchParams])

  async function kirim(e) {
    e.preventDefault()
    setPesan('')
    setGalat('')

    if (!token.trim()) {
      setGalat('Token pemulihan wajib diisi.')
      return
    }
    if (password.length < 8) {
      setGalat('Kata sandi baru minimal 8 karakter.')
      return
    }
    if (password !== konfirmasi) {
      setGalat('Konfirmasi kata sandi tidak cocok.')
      return
    }

    setSedangKirim(true)
    try {
      await api.post('/auth/reset-password', {
        token: token.trim(),
        password,
      })
      setPesan('Kata sandi berhasil diperbarui dan seluruh sesi lama telah dicabut.')
      window.setTimeout(() => navigate('/login', { replace: true }), 1500)
    } catch (err) {
      setGalat(pesanGalat(err))
    } finally {
      setSedangKirim(false)
    }
  }

  return (
    <section className="auth-page">
      <h1>Atur Ulang Kata Sandi</h1>

      <form className="form-stack" onSubmit={kirim} noValidate>
        <Input
          label="Token Pemulihan"
          name="token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <Input
          label="Kata Sandi Baru"
          name="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
        <Input
          label="Konfirmasi Kata Sandi Baru"
          name="konfirmasi"
          type="password"
          value={konfirmasi}
          onChange={(e) => setKonfirmasi(e.target.value)}
          autoComplete="new-password"
        />

        {pesan && <p className="form-info" role="status">{pesan}</p>}
        {galat && <p className="form-error" role="alert">{galat}</p>}

        <Button type="submit" disabled={sedangKirim}>
          {sedangKirim ? 'Menyimpan...' : 'Simpan Kata Sandi Baru'}
        </Button>
      </form>

      <p>
        <Link to="/login">Kembali ke Masuk</Link>
      </p>
    </section>
  )
}
