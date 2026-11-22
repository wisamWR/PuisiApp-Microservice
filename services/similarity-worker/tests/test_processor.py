from unittest.mock import patch

from app.processor import proses_kandidat


def test_processor_mengurutkan_kandidat_berdasarkan_jaccard():
    payload = {
        "poem_id": "00000000-0000-0000-0000-000000000001",
        "signature": [10] * 128,
        "stanza_signatures": [],
    }

    kandidat = [
        {
            "poem_id": "00000000-0000-0000-0000-000000000002",
            "version": 1,
            "signature": [20] * 128,
            "stanza_signatures": [],
            "matched_stanza": None,
            "match_kind": "whole",
        },
        {
            "poem_id": "00000000-0000-0000-0000-000000000003",
            "version": 1,
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
    assert hasil[0]["jaccard_estimate"] == 1.0
    assert hasil[1]["jaccard_estimate"] == 0.0


def test_processor_mengembalikan_kosong_jika_tidak_ada_kandidat():
    payload = {
        "poem_id": "00000000-0000-0000-0000-000000000001",
        "signature": [10] * 128,
        "stanza_signatures": [],
    }

    with patch("app.processor.cari_kandidat", return_value=[]):
        hasil = proses_kandidat(None, payload)

    assert hasil == []
