
import pytest

from app.fingerprint import (
    buat_shingle,
    buat_signature_minhash,
    normalisasi_teks,
    proses_fingerprint,
)


def test_normalisasi_huruf_besar_dan_tanda_baca():
    teks = "CINTA dan ALAM!!!"
    assert normalisasi_teks(teks) == "cinta alam"


def test_normalisasi_spasi_berulang():
    teks = "cinta     alam   indah"
    assert normalisasi_teks(teks) == "cinta alam indah"


def test_normalisasi_unicode_nfc():
    teks = "cafe\u0301"
    hasil = normalisasi_teks(teks)
    assert hasil == "café"


def test_buat_shingle_tiga_kata():
    hasil = buat_shingle("cinta alam indah selalu dikenang")
    assert sum(hasil.values()) == 3
    assert len(hasil) == 3


def test_shingle_menghitung_kemunculan_berulang():
    hasil = buat_shingle("cinta alam indah cinta alam indah")
    assert hasil["cinta alam indah"] == 2


def test_teks_pendek_tidak_menghasilkan_shingle():
    hasil = buat_shingle("cinta alam")
    assert sum(hasil.values()) == 0


def test_minhash_menghasilkan_128_nilai():
    shingles = buat_shingle("cinta alam indah selalu dikenang")
    signature = buat_signature_minhash(shingles)
    assert len(signature) == 128


def test_minhash_deterministik():
    shingles = buat_shingle("cinta alam indah selalu dikenang")
    pertama = buat_signature_minhash(shingles)
    kedua = buat_signature_minhash(shingles)
    assert pertama == kedua


def test_minhash_teks_kosong_konsisten():
    signature = buat_signature_minhash({})
    assert len(signature) == 128
    assert len(set(signature)) == 1


def test_proses_fingerprint_dua_bait():
    puisi = (
        "Cinta alam indah selalu dikenang\n"
        "Bunga mekar menghiasi taman\n\n"
        "Langit biru membentang luas\n"
        "Burung bernyanyi menyambut pagi"
    )

    hasil = proses_fingerprint(puisi)

    assert len(hasil["signature"]) == 128
    assert len(hasil["stanza_signatures"]) == 2
    assert all(
        len(bait["signature"]) == 128
        for bait in hasil["stanza_signatures"]
    )


def test_proses_fingerprint_deterministik():
    puisi = "Cinta alam indah selalu dikenang"

    pertama = proses_fingerprint(puisi)
    kedua = proses_fingerprint(puisi)

    assert pertama == kedua


def test_ukuran_shingle_tidak_valid():
    with pytest.raises(ValueError):
        buat_shingle("cinta alam indah", ukuran=0)

def test_buat_payload_fingerprint_sesuai_spesifikasi():
    from app.fingerprint import buat_payload_fingerprint

    payload = buat_payload_fingerprint(
        poem_id="0b7d6f0e-4a8b-4a52-9d0b-3f4f0e9b2a10",
        version=1,
        body="senja datang perlahan\nangin menyentuh dedaunan",
    )

    assert payload["poem_id"] == "0b7d6f0e-4a8b-4a52-9d0b-3f4f0e9b2a10"
    assert payload["version"] == 1
    assert "shingle_count" in payload
    assert len(payload["signature"]) == 128
    assert isinstance(payload["stanza_signatures"], list)


def test_payload_fingerprint_deterministik():
    from app.fingerprint import buat_payload_fingerprint

    argumen = {
        "poem_id": "0b7d6f0e-4a8b-4a52-9d0b-3f4f0e9b2a10",
        "version": 1,
        "body": "senja datang perlahan\nangin menyentuh dedaunan",
    }

    hasil_pertama = buat_payload_fingerprint(**argumen)
    hasil_kedua = buat_payload_fingerprint(**argumen)

    assert hasil_pertama == hasil_kedua

