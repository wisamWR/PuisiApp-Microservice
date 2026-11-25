import pytest

from app.similarity import (
    buat_bucket_lsh,
    estimasi_jaccard,
    tentukan_level,
)


def test_signature_identik_menghasilkan_jaccard_satu():
    signature = [10] * 128
    assert estimasi_jaccard(signature, signature) == 1.0


def test_signature_berbeda_menghasilkan_jaccard_nol():
    signature_a = [10] * 128
    signature_b = [20] * 128
    assert estimasi_jaccard(signature_a, signature_b) == 0.0


def test_panjang_signature_harus_sama():
    with pytest.raises(ValueError):
        estimasi_jaccard([1, 2], [1])


def test_lsh_menghasilkan_32_bucket():
    signature = list(range(128))
    buckets = buat_bucket_lsh(signature)
    assert len(buckets) == 32


def test_lsh_menolak_signature_tidak_valid():
    with pytest.raises(ValueError):
        buat_bucket_lsh([1, 2, 3])


def test_puisi_pendek_tidak_dikategorikan_jiplakan():
    assert tentukan_level(0.95, 14) == "similar"


def test_puisi_panjang_dengan_skor_tinggi_dikategorikan_jiplakan():
    assert tentukan_level(0.95, 15) == "suspected_plagiarism"


def test_batas_kategori_similarity():
    assert tentukan_level(0.19, 20) == "original"
    assert tentukan_level(0.20, 20) == "inspired"
    assert tentukan_level(0.50, 20) == "similar"
    assert tentukan_level(0.80, 20) == "suspected_plagiarism"

def test_skor_menggunakan_nilai_jaccard_terbesar():
    from app.similarity import hitung_skor

    assert hitung_skor(0.85, 0.60) == 0.85


def test_skor_menggunakan_nilai_containment_terbesar():
    from app.similarity import hitung_skor

    assert hitung_skor(0.40, 0.90) == 0.90


def test_skor_menolak_nilai_di_luar_rentang():
    from app.similarity import hitung_skor

    with pytest.raises(ValueError):
        hitung_skor(1.2, 0.5)
