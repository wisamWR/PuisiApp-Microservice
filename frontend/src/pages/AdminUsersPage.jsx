import { useState } from 'react'
import { Button, Input } from '../components/UI'
import { api } from '../lib/api'
import { pesanGalat } from '../lib/galat'
import { PERAN } from '../lib/peran'

export default function AdminUsersPage() {
  const [q, setQ] = useState('')
  const [items, setItems] = useState(null)
  const [peranBaru, setPeranBaru] = useState({})
  const [pesan, setPesan] = useState('')
  const [sukses, setSukses] = useState('')
  const [sedangCari, setSedangCari] = useState(false)
  const [simpanId, setSimpanId] = useState(null)

  async function cari(e) {
    e.preventDefault()
    const kata = q.trim()
    setPesan('')
    setSukses('')
    if (!kata) {
      setPesan('Isi username yang dicari.')
      return
    }
    setSedangCari(true)
    try {
      const data = await api.get(`/admin/users?q=${encodeURIComponent(kata)}`)
      setItems(data.items)
      setPeranBaru(Object.fromEntries(data.items.map((u) => [u.id, u.role])))
    } catch (err) {
      setItems(null)
      setPesan(err.status === 403 ? 'Halaman ini hanya untuk admin.' : pesanGalat(err))
    } finally {
      setSedangCari(false)
    }
  }

  async function simpan(u) {
    setPesan('')
    setSukses('')
    setSimpanId(u.id)
    try {
      const hasil = await api.put(`/admin/users/${u.id}/role`, { role: peranBaru[u.id] })
      setItems((daftar) => daftar.map((x) => (x.id === u.id ? { ...x, role: hasil.role } : x)))
      setSukses(`Peran ${hasil.username} sekarang ${hasil.role}.`)
    } catch (err) {
      setPesan(err.status === 403 ? 'Hanya admin yang bisa mengubah peran.' : pesanGalat(err))
    } finally {
      setSimpanId(null)
    }
  }

  return (
    <section className="page-section">
      <div className="page-heading">
        <span className="eyebrow">ADMIN</span>
        <h1>Kelola pengguna</h1>
        <p>Cari akun berdasarkan username, lalu ubah peran.</p>
      </div>

      <form className="form-stack" onSubmit={cari}>
        <Input label="Username" name="q" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="submit" disabled={sedangCari}>{sedangCari ? 'Mencari...' : 'Cari'}</Button>
      </form>

      {sukses && <p className="form-info" role="status">{sukses}</p>}
      {pesan && <p className="form-error" role="alert">{pesan}</p>}

      {items && items.length === 0 && <p className="muted-text">Tidak ada akun yang cocok.</p>}

      {items && items.length > 0 && (
        <ul className="admin-list">
          {items.map((u) => (
            <li key={u.id} className="admin-row">
              <span className="admin-username">{u.username}</span>
              <span className="muted-text">peran sekarang: {u.role}</span>
              <select
                value={peranBaru[u.id] ?? u.role}
                onChange={(e) => setPeranBaru({ ...peranBaru, [u.id]: e.target.value })}
                aria-label={`Peran untuk ${u.username}`}
              >
                {PERAN.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <Button
                variant="outline"
                disabled={simpanId === u.id || (peranBaru[u.id] ?? u.role) === u.role}
                onClick={() => simpan(u)}
              >
                {simpanId === u.id ? 'Menyimpan...' : 'Simpan'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
