# k8-laporan: Laporan, Sengketa, dan Moderasi

Branch: `k8-laporan` | Penanggung jawab: Zoya | Task: T8.1 sampai T8.4 | Frontend: layar moderator, form sanggahan dan banding, halaman kebijakan

## Cakupan

Pelaporan dugaan plagiarisme, bukti pembanding otomatis, antrean kasus moderator, keputusan, banding, dan log audit.

## Layanan dan Komponen

| Layanan | Tipe | Data | Task |
| --- | --- | --- | --- |
| report-service | API | report-db + outbox | T8.1 |
| evidence-worker | worker | evidence-db: snapshot teks dan bukti | T8.1 |
| case-queue-service | API | case-db + outbox | T8.2 |
| case-decision-service | API | decision-db + outbox | T8.3 |
| appeal-service | API | appeal-db + outbox | T8.3 |
| audit-worker | worker | audit-db (append-only) | T8.3 |
| layar Moderasi dan halaman kebijakan | frontend | tidak ada | T8.4 |

## Endpoint

| Metode | Path | Respons |
| --- | --- | --- |
| POST | `/api/reports` | 202; `poem_id`, `poem_pembanding_id`, `alasan` |
| GET | `/api/moderation/cases` | daftar kasus (moderator) |
| POST | `/api/moderation/cases/{id}/claim` | klaim kasus |
| POST | `/api/moderation/cases/{id}/statement` | sanggahan penulis |
| POST | `/api/moderation/cases/{id}/decision` | 202; ditolak, diberi label, atau dikabulkan |
| POST | `/api/appeals` | 202; dalam 7 hari setelah keputusan |

## Event

| Event | Peran |
| --- | --- |
| `report.created` | publish (report), consume (evidence, case-queue, audit, notification) |
| `report.evidence.ready` | publish (evidence), consume (case-queue) |
| `case.opened`, `case.claimed` | publish (case-queue) |
| `case.decided` | publish (case-decision), consume (publication, case-queue, appeal, audit, notification) |
| `appeal.filed` | publish (appeal), consume (case-queue, audit, notification) |
| `poem.similarity.scored` | consume (case-queue; membuka kasus otomatis) |

## Catatan Teknis

- Kasus dibuka dari dua sumber: laporan pengguna dan level otomatis (MIRIP prioritas rendah, DUGAAN_JIPLAKAN prioritas tinggi).
- `evidence-worker` membekukan snapshot teks kedua puisi dan catatan Jejak Keaslian saat laporan dibuat, sehingga bukti tidak berubah walaupun puisi direvisi atau dihapus.
- Status kasus dijaga `case-queue-service`: OPEN, EVIDENCE_READY, UNDER_REVIEW, RESOLVED, APPEALED. Satu kasus hanya dapat diklaim satu moderator; klaim kedaluwarsa setelah 24 jam.
- Aturan otorisasi: endpoint moderasi memerlukan `X-User-Role: moderator`; `case-decision-service` menolak keputusan dari moderator yang bukan pengklaim; kasus banding tidak ditugaskan kepada moderator yang memutuskan kasus asal.
- Keputusan dikabulkan mengubah status puisi menjadi HIDDEN melalui `publication-service` (saga koreografi); kompensasi berupa transisi status, bukan pembatalan data.
- Banding membuka kasus baru. Jendela banding 7 hari.
- `audit-worker` mencatat semua peristiwa moderasi ke tabel append-only (`REVOKE UPDATE, DELETE`).
- Rate limit `POST /api/reports` ditegakkan di gateway (sekitar 5 per menit per pengguna).
- Publik hanya melihat label level; skor dan puisi pembanding hanya terlihat oleh penulis dan moderator.
- Koordinasikan dengan k4 mengenai laporan komentar (`comment.reported`).

## Dependensi

T0.6, T0.5 (frontend), T2.1 (`poem.submitted`), T7.2 (`poem.similarity.scored`), T2.2 (publication untuk dampak keputusan).

## Alur Git

Kerjakan langsung di `k8-laporan`, awali commit dengan kode task (`T8.1: snapshot bukti`). Gabungkan `main` ke branch ini setiap hari kerja dan buat PR ke `main` minimal tiap Jumat.