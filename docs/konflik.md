# Catatan konflik merge (T0.11)

Konflik yang muncul berulang saat branch kelompok digabung dengan `main`, beserta penyebab dan cara mengatasinya. Dipakai sebagai bahan evaluasi proses.

## 1. Daftar variabel gateway (`infra/nginx`)

**Gejala.** k1, k2, dan k5 saling bentrok di `infra/nginx/docker-entrypoint.sh` dan `infra/nginx/templates/vars.conf.template` (simulasi 21 Nov 2026).

**Penyebab.** Semua kelompok menambah alamat layanannya ke satu baris `envsubst` yang sama dan ke satu blok yang sama di satu berkas template. Setiap kelompok yang menambah layanan pasti mengubah baris yang juga diubah kelompok lain.

**Perbaikan (T0.11, branch `T0.11-gateway-vars`).**
- `templates/vars.conf.template` dipecah menjadi `templates/vars.d/<domain>.conf.template`, satu berkas per domain, seperti `routes/<domain>.conf`.
- `docker-entrypoint.sh` membaca daftar variabel `*_HOST` otomatis dari semua berkas `vars.d`, jadi tidak perlu diedit lagi.

**Cara menyelesaikan saat menggabungkan `main` ke branch kelompok (sekali saja).** Setelah `git merge origin/main` berhenti karena konflik:

1. Ambil entrypoint versi `main`:

   ```bash
   git checkout --theirs infra/nginx/docker-entrypoint.sh
   ```

2. Pindahkan baris `set $up_...` milik kelompokmu dari `templates/vars.conf.template` ke `templates/vars.d/<domain>.conf.template` (buat bila belum ada). Baris milik domain lain (frontend, auth, identity, contoh) sudah ada di `vars.d` dan tidak perlu disalin.
3. Hapus berkas lama:

   ```bash
   git rm infra/nginx/templates/vars.conf.template
   ```

4. `git add` berkas `vars.d` baru, lalu `git commit --no-edit`.

Sesudahnya, kelompok hanya menyentuh berkas domainnya sendiri dan konflik ini tidak muncul lagi.

## 2. `README.md` di branch yang belum mulai (k3, k4, k6, k8, k9)

**Gejala.** Menggabungkan `main` ke branch itu bentrok di `README.md`.

**Penyebab.** Branch dibuat 9 Nov dengan dokumen awal, lalu `README.md` di `main` diperbarui di Sprint 0. Branch tertinggal 16 commit.

**Penyelesaian.** Pakai versi `main`:

```bash
git checkout --theirs README.md
```

Lalu `git add README.md` dan `git commit --no-edit`. Pemilik branch sebaiknya menggabungkan `main` sebelum mulai mengerjakan task.

## 3. Berkas frontend bersama

**Gejala.** `frontend/src/App.jsx` diubah k1, k2, k5; `App.css` dan `layouts/AppLayout.jsx` diubah k1 dan k5; `pages/PoemDetailPage.jsx` diubah k2 dan k5.

**Penyebab.** Rute halaman dan tata letak didaftarkan di berkas yang sama.

**Penyelesaian.** Konflik kecil (penambahan rute/impor); ambil kedua sisi. Diselesaikan berurutan mengikuti urutan merge: k2, k1, lalu k5 menggabungkan `main` terbaru sekali.
