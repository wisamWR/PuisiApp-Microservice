import { Link } from 'react-router-dom'
import { PoemCard } from '../components/UI'

const pageInfo = {
  home: {
    title: 'Beranda',
    description: 'Selamat datang di PuisiApp. Temukan, baca, dan bagikan karya puisi.',
  },
  moodEntry: {
    title: 'Mood Entry',
    description: 'Catat suasana hati dan temukan ruang untuk mengekspresikan perasaan.',
  },
  moodFeed: {
    title: 'Mood Feed',
    description: 'Jelajahi suasana hati dan cerita dari komunitas PuisiApp.',
  },
  writePoem: {
    title: 'Tulis Puisi',
    description: 'Ruang untuk membuat dan menerbitkan karya puisimu.',
  },
  myPoems: {
    title: 'Puisi Saya',
    description: 'Kelola seluruh karya puisi yang telah kamu buat.',
  },
  authorProfile: {
    title: 'Profil Penulis',
    description: 'Informasi profil dan kumpulan karya seorang penulis.',
  },
  search: {
    title: 'Pencarian',
    description: 'Cari puisi, penulis, atau topik yang ingin kamu temukan.',
  },
  themes: {
    title: 'Jelajah Tema',
    description: 'Temukan puisi berdasarkan tema dan kategori.',
  },
  notifications: {
    title: 'Notifikasi',
    description: 'Lihat informasi dan aktivitas terbaru akunmu.',
  },
  login: {
    title: 'Masuk',
    description: 'Masuk ke akun PuisiApp untuk melanjutkan.',
  },
  register: {
    title: 'Daftar',
    description: 'Buat akun baru dan bergabung dengan komunitas PuisiApp.',
  },
  moderation: {
    title: 'Moderasi',
    description: 'Ruang kerja moderator untuk meninjau konten komunitas.',
  },
  notFound: {
    title: 'Halaman tidak ditemukan',
    description: 'Alamat yang kamu buka tidak tersedia. Kembali ke Beranda lewat navigasi.',
  },
}

export function PlaceholderPage({ pageKey }) {
  const page = pageInfo[pageKey]

  return (
    <section className="page-section">
      <div className="page-heading">
        <div>
          <span className="eyebrow">PUISIAPP / WORKSPACE</span>
          <h1>{page.title}</h1>
          <p>{page.description}</p>
        </div>
      </div>

      {pageKey === 'home' ? (
        <>
          <div className="welcome-panel">
            <div>
              <span className="eyebrow">RUANG EKSPRESI</span>
              <h2>Setiap perasaan punya cerita.</h2>
              <p>Tuangkan pikiranmu dalam puisi dan temukan karya dari komunitas.</p>
              <Link to="/write" className="button button-primary">
                Mulai menulis
              </Link>
            </div>
            <div className="welcome-decoration" aria-hidden="true">“</div>
          </div>
          <div className="section-title-row">
            <h2>Contoh tampilan puisi</h2>
            <span className="muted-text">Data placeholder</span>
          </div>
          <div className="poem-grid">
            <PoemCard
              title="Senja di Ujung Hari"
              author="Penulis PuisiApp"
              emotion="Sedih"
              originality="Orisinal"
              score="92"
              to="/poems/demo-1"
            />
            <PoemCard
              title="Ruang untuk Pulang"
              author="Komunitas Puisi"
              emotion="Cinta"
              originality="Terinspirasi"
              score="85"
              to="/poems/demo-2"
            />
          </div>
        </>
      ) : (
        <div className="placeholder-panel">
          <div className="placeholder-icon">✎</div>
          <h2>Fondasi halaman siap</h2>
          <p>
            Struktur halaman ini sudah tersedia. Fitur dan integrasi API
            akan dikembangkan oleh pemilik modul terkait.
          </p>
          <span className="status-chip">Placeholder · T0.5</span>
        </div>
      )}
    </section>
  )
}
