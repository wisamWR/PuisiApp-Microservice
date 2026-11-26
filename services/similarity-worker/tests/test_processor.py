from unittest.mock import patch

from app.processor import (
    estimasi_containment,
    proses_kandidat,
)


def test_processor_mengurutkan_kandidat_berdasarkan_skor():
    payload = {
        "poem_id": "00000000-0000-0000-0000-000000000001",
        "shingle_count": 20,
        "signature": [10] * 128,
        "stanza_signatures": [],
    }

    kandidat = [
        {
            "poem_id": "00000000-0000-0000-0000-000000000002",
            "version": 1,
            "shingle_count": 20,
            "signature": [20] * 128,
            "stanza_signatures": [],
            "matched_stanza": None,
            "match_kind": "whole",
        },
        {
            "poem_id": "00000000-0000-0000-0000-000000000003",
            "version": 1,
            "shingle_count": 20,
            "signature": [10] * 128,
            "stanza_signatures": [],
            "matched_stanza": None,
            "match_kind": "whole",
        },
    ]

    with patch("app.processor.cari_kandidat", return_value=kandidat):
        hasil = proses_kandidat(None, payload)

    assert len(hasil) == 2
    assert hasil[0]["poem_id"] == kandidat[1]["poem_id"]
    assert hasil[0]["score"] == 1.0
    assert hasil[1]["score"] == 0.0


def test_processor_mengembalikan_kosong_jika_tidak_ada_kandidat():
    payload = {
        "poem_id": "00000000-0000-0000-0000-000000000001",
        "shingle_count": 20,
        "signature": [10] * 128,
        "stanza_signatures": [],
    }

    with patch("app.processor.cari_kandidat", return_value=[]):
        hasil = proses_kandidat(None, payload)

    assert hasil == []


def test_puisi_tanpa_shingle_tidak_mencari_kandidat():
    payload = {
        "poem_id": "00000000-0000-0000-0000-000000000001",
        "shingle_count": 0,
        "signature": [2**64 - 1] * 128,
        "stanza_signatures": [],
    }

    with patch("app.processor.cari_kandidat") as cari:
        assert proses_kandidat(None, payload) == []
        cari.assert_not_called()


def test_containment_mendeteksi_shingle_yang_terkandung():
    # A memiliki 10 shingle dan B memiliki 100 shingle.
    # Jaccard 0.2 menghasilkan estimasi containment A sebesar 1.0.
    containment = estimasi_containment(
        jaccard=0.2,
        jumlah_a=10,
        jumlah_b=100,
    )

    assert containment == 1.0


def test_containment_tidak_melebihi_satu():
    containment = estimasi_containment(
        jaccard=1.0,
        jumlah_a=10,
        jumlah_b=100,
    )

    assert 0.0 <= containment <= 1.0


def test_processor_menggunakan_containment_pada_kandidat():
    payload = {
        "poem_id": "00000000-0000-0000-0000-000000000001",
        "shingle_count": 10,
        "signature": [10] * 128,
        "stanza_signatures": [],
    }

    kandidat = [
        {
            "poem_id": "00000000-0000-0000-0000-000000000002",
            "version": 1,
            "shingle_count": 100,
            "signature": [10] * 26 + [20] * 102,
            "stanza_signatures": [],
            "matched_stanza": None,
            "match_kind": "whole",
        }
    ]

    with patch("app.processor.cari_kandidat", return_value=kandidat):
        hasil = proses_kandidat(None, payload)

    assert len(hasil) == 1
    assert hasil[0]["containment_estimate"] == 1.0
    assert hasil[0]["score"] == 1.0
