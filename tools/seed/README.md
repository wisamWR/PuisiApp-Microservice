# Seed Data Puisi App (T0.10)

Seed digunakan untuk menghasilkan data demo akun dan puisi melalui RabbitMQ.

## Data bawaan
- 5 akun demo
- 50 puisi
- 5 kategori emosi
- 10 kategori tema

## Prasyarat
- Node.js dan dependensi proyek sudah terpasang.
- RabbitMQ berjalan untuk pengiriman event.
- File .env sudah dikonfigurasi.

## Penggunaan
Semua perintah dijalankan dari root repository.

### Melihat bantuan
```powershell
node tools/seed/index.js --help
```

### Validasi tanpa mengirim event
```powershell
node tools/seed/index.js --dry-run
```

### Menjalankan seed dengan konfigurasi default
```powershell
node --env-file=.env tools/seed/index.js
```

Konfigurasi default: 50 puisi dan 10 event per detik.

### Mengatur jumlah puisi
```powershell
node --env-file=.env tools/seed/index.js --count 100
```

### Mengatur laju publikasi
```powershell
node --env-file=.env tools/seed/index.js --rate 5
```

### Menggabungkan opsi
```powershell
node --env-file=.env tools/seed/index.js --count 100 --rate 5
```

## Pengujian
```powershell
node --check tools/seed/index.js
node --check tools/seed/rate-limit.js
node --test tools/seed/rate-limit.test.js
node tools/seed/index.js --dry-run
```

## Catatan
- --count harus berupa bilangan bulat positif.
- --rate harus berupa angka positif.
- --dry-run tidak mengirim event ke RabbitMQ.
- Periksa integrasi consumer dan deduplikasi sebelum menjalankan seed normal kembali.
- Opsi --reset belum tersedia.
- Jangan menghapus database layanan lain untuk mereset seed.
