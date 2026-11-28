# theme-worker (Kelompok 6)

Worker ekstraksi tema puisi berbasis kamus berbobot dalam `data/themes.yaml`.

- Mengonsumsi `poem.submitted` dan `poem.revised` dari exchange domain puisi.
- Menyimpan hasil ekstraksi (`primary`, `secondary`, `scores`, `themes`) ke `theme-db` (`poem_themes`) secara idempoten.
- Menerbitkan event `poem.themes.extracted` ke exchange `analysis.events`.
