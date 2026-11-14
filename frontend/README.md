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

## 3. Menjalankan melalui Docker

Dari direktori frontend:

```bash
docker compose --env-file ../.env -f ../infra/docker-compose.yml build frontend
docker compose --env-file ../.env -f ../infra/docker-compose.yml up -d frontend
```

Aplikasi dapat diakses melalui API Gateway:

http://localhost:8080/

## 4. Struktur direktori

```text
src/
├── components/
│   ├── UI.jsx
│   └── ToastContext.jsx
├── layouts/
│   └── AppLayout.jsx
├── lib/
│   └── api.js
├── pages/
│   └── PlaceholderPage.jsx
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
- Penanganan HTTP 401 dengan pengalihan ke halaman login.
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

ToastProvider tersedia di `src/components/ToastContext.jsx`.

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