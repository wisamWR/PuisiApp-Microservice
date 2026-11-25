from app.hash_chain import (
    HASH_NOL,
    buat_catatan,
    hitung_chain_hash,
    hitung_content_hash,
    normalisasi_waktu,
)


def test_normalisasi_waktu_ke_utc():
    assert normalisasi_waktu("2026-01-02T03:04:05+07:00") == "2026-01-01T20:04:05Z"
    assert normalisasi_waktu("2026-01-02T03:04:05") == "2026-01-02T03:04:05Z"


def test_buat_catatan_dan_rantai_hash():
    catatan_1 = buat_catatan(
        poem_id="poem-1",
        version=1,
        body="baris satu\nbaris dua",
        recorded_at="2026-01-02T03:04:05Z",
        previous_hash=HASH_NOL,
    )
    assert catatan_1["previous_hash"] == HASH_NOL
    assert len(catatan_1["content_hash"]) == 64
    assert len(catatan_1["chain_hash"]) == 64
    assert catatan_1["algorithm"] == "SHA-256"

    catatan_2 = buat_catatan(
        poem_id="poem-1",
        version=2,
        body="baris satu\nbaris dua diubah",
        recorded_at="2026-01-02T03:05:05Z",
        previous_hash=catatan_1["chain_hash"],
    )
    assert catatan_2["previous_hash"] == catatan_1["chain_hash"]
    assert catatan_2["chain_hash"] != catatan_1["chain_hash"]

    assert hitung_content_hash("teks") == hitung_content_hash("teks")
    assert (
        hitung_chain_hash(
            index=1,
            poem_id="poem-1",
            version=1,
            content_hash=catatan_1["content_hash"],
            recorded_at="2026-01-02T03:04:05Z",
            previous_hash=HASH_NOL,
        )
        == catatan_1["chain_hash"]
    )
