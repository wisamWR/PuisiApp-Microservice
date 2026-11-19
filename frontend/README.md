# PuisiApp Frontend

Frontend bersama PuisiApp dibangun menggunakan React, Vite, dan React Router.

## 1. Teknologi

- React
- Vite
- React Router
- Nginx
- Docker

## 2. Menjalankan secara lokal

Pastikan Node.js dan npm sudah terpasang.

```bash
npm install
npm run dev
```

Buka alamat yang ditampilkan Vite, biasanya http://localhost:5173.

Request `/api/*` diteruskan (proxy Vite) ke API gateway di `http://localhost:8080`, jadi nyalakan gateway dulu (`docker compose up -d api-gateway` dari root repositori). Alamat lain bisa diatur lewat `VITE_API_PROXY`, misalnya `VITE_API_PROXY=http://localhost:4010 npm run dev` untuk mock server Prism.

## 3. Menjalankan melalui Docker

Dari root repositori (memakai `COMPOSE_FILE` di `.env`):

```bash
docker compose build frontend
docker compose up -d api-gateway frontend
```

Container frontend tidak memetakan port ke host. Aplikasi diakses melalui API Gateway (rute `/` diteruskan ke `FRONTEND_HOST`):

http://localhost:8080/

## 4. Struktur direktori

```text
src/
├── components/
│   ├── UI.jsx
│   ├── ToastContext.jsx   (ToastProvider)
│   └── toast.js           (useToast)
├── layouts/
│   └── AppLayout.jsx
├── lib/
│   └── api.js
├── pages/
│   ├── PlaceholderPage.jsx
│   └── PoemDetailPage.jsx
├── App.jsx
├── App.css
├── index.css
└── main.jsx
```

## 5. Daftar route

| Halaman | Route |
|---|---|
| Beranda | / |
| Mood Entry | /mood-entry |
| Mood Feed | /mood-feed |
| Detail Puisi | /poems/:id |
| Tulis Puisi | /write |
| Puisi Saya | /my-poems |
| Profil Penulis | /authors/:id |
| Pencarian | /search |
| Jelajah Tema | /themes |
| Notifikasi | /notifications |
| Masuk | /login |
| Daftar | /register |
| Moderasi | /moderation |

## 6. Menambahkan halaman

1. Buat file halaman baru di `src/pages/`.
2. Buat komponen React untuk halaman tersebut.
3. Tambahkan route di `src/App.jsx`.
4. Gunakan `AppLayout` sebagai layout bersama.
5. Gunakan komponen dari `src/components/UI.jsx` jika diperlukan.

Contoh:

```jsx
export default function ExamplePage() {
  return (
    <section className="page-section">
      <h1>Halaman Baru</h1>
      <p>Konten halaman.</p>
    </section>
  )
}
```

Tambahkan route:

```jsx
<Route
  path="example"
  element={<ExamplePage />}
/>
```

## 7. Menggunakan API client

Semua komunikasi HTTP frontend menggunakan `src/lib/api.js`.

Contoh GET:

```jsx
import { api } from '../lib/api'

const response = await api.get('/poems')
console.log(response.data)
```

Contoh POST:

```jsx
const response = await api.post('/poems', {
  title: 'Judul Puisi',
  content: 'Isi puisi',
})
```

API client menyediakan:

- Base URL `/api`.
- `credentials: include` untuk pengiriman cookie.
- Penanganan HTTP 401 dengan pengalihan ke `/login?next=<halaman asal>`.
- Penanganan HTTP 202 dengan notifikasi permintaan sedang diproses.
- Helper GET, POST, PUT, PATCH, dan DELETE.
- ApiError untuk penanganan kesalahan HTTP.

Cookie autentikasi dikelola oleh browser dan backend. Frontend tidak membaca token httpOnly secara langsung.

## 8. Komponen UI

Komponen reusable tersedia di `src/components/UI.jsx`:

- Button
- Input
- PoemCard
- EmotionLabel
- OriginalityBadge
- Toast
- Loader

`OriginalityBadge` menerima empat level dari spesifikasi: `Orisinal`, `Terinspirasi`, `Mirip`, `Dugaan jiplakan`.

Toast: `ToastProvider` (`src/components/ToastContext.jsx`) sudah membungkus aplikasi. Dari komponen:

```jsx
import { useToast } from '../components/toast'

const { showToast } = useToast()
showToast('Puisi tersimpan.', 'success') // info | success | error
```

## 9. Pemeriksaan kualitas

Jalankan:

```bash
npm run lint
npm run build
```

Kedua perintah harus berhasil sebelum perubahan diserahkan.

## 10. Catatan pengembangan

- Pertahankan penggunaan API client tunggal.
- Hindari membuat layout dan navigasi baru untuk setiap halaman.
- Gunakan komponen UI bersama jika sesuai.
- Sesuaikan endpoint API dengan kontrak backend yang telah disepakati.
- Placeholder halaman dapat dikembangkan oleh pemilik modul masing-masing.
