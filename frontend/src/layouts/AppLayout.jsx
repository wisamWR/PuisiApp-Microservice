import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import MoodIcon from '../components/MoodIcon'
import { EMOSI_LIST, bacaPreferensiMood, sudahPilihMood } from '../lib/moodData'

const navigation = [
  { heading: 'UTAMA', links: [['/', 'Beranda'], ['/mood-entry', 'Mood Entry'], ['/mood-feed', 'Mood Feed']] },
  { heading: 'PUISI', links: [['/write', 'Tulis Puisi'], ['/my-poems', 'Puisi Saya'], ['/themes', 'Jelajah Tema'], ['/search', 'Pencarian']] },
  { heading: 'AKUN & LAINNYA', links: [['/notifications', 'Notifikasi'], ['/moderation', 'Moderasi'], ['/login', 'Masuk'], ['/register', 'Daftar']] },
]

export default function AppLayout() {
  const [pref, setPref] = useState(() => bacaPreferensiMood())
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    const sync = () => setPref(bacaPreferensiMood())
    window.addEventListener('puisiapp:mood-changed', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('puisiapp:mood-changed', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  useEffect(() => {
    if (location.pathname === '/' && !sudahPilihMood()) {
      navigate('/mood-entry', { replace: true })
    }
  }, [location.pathname, navigate])

  const infoEmosi = EMOSI_LIST.find((e) => e.key === pref.mood) || EMOSI_LIST[0]

  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink to="/" className="brand">
          <span className="brand-mark">P</span>
          <span>puisi<span className="brand-accent">app</span></span>
        </NavLink>
        <div className="topbar-actions">
          <NavLink to="/mood-entry" className="mood-header-pill" title="Ubah suasana hati">
            <MoodIcon mood={infoEmosi.key} size={15} color={infoEmosi.color} />
            <span>{infoEmosi.label} · {pref.mode === 'menghibur' ? 'Menghibur' : 'Senada'}</span>
          </NavLink>
          <NavLink to="/login" className="button button-outline">Masuk</NavLink>
        </div>
      </header>

      <div className="main-layout">
        <aside className="sidebar">
          <div className="sidebar-intro">
            <span className="eyebrow">NAVIGASI</span>
            <p>Jelajahi PuisiApp</p>
          </div>
          {navigation.map((group) => (
            <div className="nav-group" key={group.heading}>
              <span className="nav-heading">{group.heading}</span>
              {group.links.map(([path, label]) => (
                <NavLink key={path} to={path} end={path === '/'} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                  <span className="nav-dot" />
                  {label}
                </NavLink>
              ))}
            </div>
          ))}
          <div className="sidebar-note">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
            <p>Ruang aman untuk setiap cerita dan perasaan.</p>
          </div>
        </aside>

        <main className="main-content">
          <Outlet />
          <footer className="footer">PuisiApp · Ruang ekspresi dan apresiasi karya</footer>
        </main>
      </div>
    </div>
  )
}
