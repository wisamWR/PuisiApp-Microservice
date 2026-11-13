# @puisiapp/poem-common

Kode bersama domain puisi (kelompok 2), dipakai poem-create-service (T2.1), poem-edit-service, dan poem-delete-service (T2.4). Tujuannya agar aturan validasi pengajuan dan revisi hanya ada di satu tempat.

| Modul | Isi |
| --- | --- |
| `validasi.js` | `validasiPengajuan`, `hashPengajuan`, `buangHtml`, `normalisasiIsi`, `pecahBait`, batas panjang, pola Idempotency-Key |
| `http.js` | `buatFastify` (body 64 KB, hanya JSON, X-Request-Id), `pasangDasar` (log/metrik per permintaan, galat seragam, `/health*`, `/metrics`), `idPengguna`, `konteksEvent` |
| `metrik.js` | `buatMetrik(layanan, penghitung?)`: histogram durasi HTTP + penghitung hasil operasi |

Pemasangan di layanan:

```json
"@puisiapp/poem-common": "file:../poem-common"
```

Dockerfile layanan menyalin `services/poem-common` dan menjalankan `npm ci` di sana sebelum layanan itu sendiri (lihat Dockerfile poem-create-service).

```bash
npm test
```
