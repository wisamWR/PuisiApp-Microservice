-- jumlah_puisi dihitung dari poem_cari (status PUBLISHED), bukan disimpan di penulis_cari.
ALTER TABLE penulis_cari DROP COLUMN IF EXISTS jumlah_puisi;
