import { NavLink, Outlet } from 'react-router-dom'

const navigation = [
  {
    heading: 'UTAMA',
    links: [
      ['/', 'Beranda'],
      ['/mood-entry', 'Mood Entry'],
      ['/mood-feed', 'Mood Feed'],
    ],
  },
  {
    heading: 'PUISI',
    links: [
      ['/write', 'Tulis Puisi'],
      ['/my-poems', 'Puisi Saya'],
      ['/themes', 'Jelajah Tema'],
      ['/search', 'Pencarian'],
    ],
  },
  {
    heading: 'AKUN & LAINNYA',
    links: [
      ['/notifications', 'Notifikasi'],
      ['/moderation', 'Moderasi'],
      ['/login', 'Masuk'],
      ['/register', 'Daftar'],
    ],
  },
]

export default function AppLayout() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink to="/" className="brand">
          <span className="brand-mark">P</span>
          <span>puisi<span className="brand-accent">app</span></span>
        </NavLink>
        <div className="topbar-actions">
          <span className="topbar-caption">Ruang ekspresi dan apresiasi</span>
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
                <NavLink
                  key={path}
                  to={path}
                  end={path === '/'}
                  className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                >
                  <span className="nav-dot" />
                  {label}
                </NavLink>
              ))}
            </div>
          ))}
          <div className="sidebar-note">
            <span>✦</span>
            <p>Ruang aman untuk setiap cerita dan perasaan.</p>
          </div>
        </aside>

        <main className="main-content">
          <Outlet />
          <footer className="footer">
            PuisiApp · Ruang ekspresi dan apresiasi karya
          </footer>
        </main>
      </div>
    </div>
  )
}