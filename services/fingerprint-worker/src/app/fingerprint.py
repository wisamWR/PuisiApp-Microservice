import hashlib
import re
import unicodedata
from collections import Counter

# Daftar awal stopword bahasa Indonesia.
# Dapat diperluas sesuai kesepakatan tim.
STOPWORDS_ID = {
    "yang",
    "dan",
    "di",
    "ke",
    "dari",
    "ini",
    "itu",
    "untuk",
    "dengan",
    "pada",
    "adalah",
    "atau",
    "karena",
    "dalam",
    "sebagai",
    "akan",
    "telah",
    "sudah",
    "belum",
    "tidak",
    "tak",
    "ada",
    "saya",
    "aku",
    "kami",
    "kita",
    "kamu",
    "dia",
    "mereka",
    "nya",
    "pun",
    "sang",
}


def normalisasi_teks(teks: str) -> str:
    """Normalisasi teks puisi sebelum proses shingling."""
    if not isinstance(teks, str):
        raise TypeError("Teks puisi harus berupa string")

    # Unicode NFC
    teks = unicodedata.normalize("NFC", teks)

    # Ubah huruf menjadi huruf kecil.
    teks = teks.lower()

    # Ganti tanda baca dan simbol dengan spasi.
    teks = "".join(
        karakter if karakter.isalnum() or karakter.isspace() else " "
        for karakter in teks
    )

    # Hapus stopword.
    kata = [
        item
        for item in teks.split()
        if item not in STOPWORDS_ID
    ]

    # Satukan spasi berulang.
    return " ".join(kata)


def buat_shingle(teks: str, ukuran: int = 3) -> Counter:
    """Membentuk dan menghitung kemunculan shingle dari teks."""
    if ukuran < 1:
        raise ValueError("Ukuran shingle harus lebih dari 0")

    kata = teks.split()

    if len(kata) < ukuran:
        return Counter()

    shingle = [
        " ".join(kata[i : i + ukuran])
        for i in range(len(kata) - ukuran + 1)
    ]

    return Counter(shingle)


def buat_signature_minhash(
    shingles: Counter,
    jumlah_hash: int = 128,
    seed: int = 42,
) -> list[int]:
    """Menghasilkan signature MinHash deterministik."""
    if jumlah_hash < 1:
        raise ValueError("Jumlah hash harus lebih dari 0")

    elemen = sorted(shingles.keys())

    if not elemen:
        return [2**64 - 1] * jumlah_hash

    signature = []

    for indeks in range(jumlah_hash):
        nilai_minimum = 2**64 - 1

        for shingle in elemen:
            data = f"{seed}:{indeks}:{shingle}".encode()
            digest = hashlib.sha256(data).digest()
            nilai_hash = int.from_bytes(digest[:8], "big")

            nilai_minimum = min(nilai_minimum, nilai_hash)

        signature.append(nilai_minimum)

    return signature


def proses_fingerprint(
    teks: str,
    jumlah_hash: int = 128,
    seed: int = 42,
    ukuran_shingle: int = 3,
) -> dict:
    """Menghasilkan fingerprint seluruh puisi dan setiap bait."""
    if not isinstance(teks, str):
        raise TypeError("Teks puisi harus berupa string")

    # Pisahkan bait berdasarkan satu atau lebih baris kosong.
    bait_asli = [
        bagian.strip()
        for bagian in re.split(r"\n\s*\n", teks)
        if bagian.strip()
    ]

    # Normalisasi seluruh puisi.
    teks_normal = normalisasi_teks(teks)
    shingles_puisi = buat_shingle(teks_normal, ukuran_shingle)

    signature_puisi = buat_signature_minhash(
        shingles_puisi,
        jumlah_hash,
        seed,
    )

    # Hitung signature dan jumlah shingle unik untuk setiap bait.
    stanza_signatures = []

    for indeks, bait in enumerate(bait_asli, start=1):
        bait_normal = normalisasi_teks(bait)
        shingles_bait = buat_shingle(bait_normal, ukuran_shingle)

        # Bait tanpa shingle tidak diindeks untuk menghindari
        # false positive akibat signature sentinel yang identik.
        if not shingles_bait:
            continue

        signature_bait = buat_signature_minhash(
            shingles_bait,
            jumlah_hash,
            seed,
        )

        stanza_signatures.append(
            {
                "stanza": indeks,
                "shingle_count": len(shingles_bait),
                "signature": signature_bait,
            }
        )

    return {
        # Menggunakan jumlah shingle unik agar konsisten dengan MinHash.
        "shingle_count": len(shingles_puisi),
        "signature": signature_puisi,
        "stanza_signatures": stanza_signatures,
    }


def buat_payload_fingerprint(
    poem_id: str,
    version: int,
    body: str,
    jumlah_hash: int = 128,
    seed: int = 42,
    ukuran_shingle: int = 3,
) -> dict:
    """Membentuk payload event poem.fingerprint.created."""
    if not poem_id:
        raise ValueError("poem_id tidak boleh kosong")

    if version < 1:
        raise ValueError("version harus lebih dari 0")

    hasil = proses_fingerprint(
        teks=body,
        jumlah_hash=jumlah_hash,
        seed=seed,
        ukuran_shingle=ukuran_shingle,
    )

    return {
        "poem_id": poem_id,
        "version": version,
        "shingle_count": hasil["shingle_count"],
        "signature": hasil["signature"],
        "stanza_signatures": hasil["stanza_signatures"],
    }
