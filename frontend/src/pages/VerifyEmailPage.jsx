import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button, Input, Loader } from '../components/UI'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { pesanGalat } from '../lib/galat'

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams()
  const { user, setUser } = useAuth()
  const [token, setToken] = useState('')
  const [status, setStatus] = useState('idle') // idle | loading | success | error
  const [pesan, setPesan] = useState('')

  async function jalankanVerifikasi(nilaiToken) {
    if (!nilaiToken || !nilaiToken.trim()) {
      setStatus('error')
      setPesan('Token verifikasi wajib diisi.')
      return
    }
    setStatus('loading')
    setPesan('')
    try {
      await api.post('/auth/verify-email', { token: nilaiToken.trim() })
      setStatus('success')
      setPesan('Alamat email Anda berhasil diverifikasi.')
      if (user) {
        setUser({ ...user, emailVerified: true })
      }
    } catch (err) {
      setStatus('error')
      setPesan(pesanGalat(err))
    }
  }

  useEffect(() => {
    const t = searchParams.get('token')
    if (t) {
      setToken(t)
      jalankanVerifikasi(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  function kirimForm(e) {
    e.preventDefault()
    jalankanVerifikasi(token)
  }

  return (
    <section className="auth-page">
      <h1>Verifikasi Email</h1>

      {status === 'loading' && <Loader label="Memverifikasi email..." />}

      {status === 'success' && (
        <p className="form-info" role="status">
          {pesan} <Link to="/login">Lanjut ke halaman masuk</Link>.
        </p>
      )}

      {status !== 'success' && (
        <form className="form-stack" onSubmit={kirimForm} noValidate>
          <Input
            label="Token Verifikasi Email"
            name="token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          {status === 'error' && pesan && (
            <p className="form-error" role="alert">{pesan}</p>
          )}
          <Button type="submit" disabled={status === 'loading'}>
            Verifikasi Email
          </Button>
        </form>
      )}
    </section>
  )
}
