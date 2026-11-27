# keyword-worker (Kelompok 6 — T6.1)

Worker ekstraksi kata kunci puisi bahasa Indonesia menggunakan **stemming Sastrawi** dan pembobotan **TF-IDF**.

- **Event dikonsumsi:** `poem.submitted`, `poem.revised` (antrean `q.keyword-worker`)
- **Event diterbitkan:** `poem.keywords.extracted` (`poem_id`, `keywords`)
- **Penyimpanan:** MongoDB `theme-db` (koleksi `poem_keywords`, `processed_events`)
