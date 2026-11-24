import hashlib
from collections.abc import Sequence


def estimasi_jaccard(
    signature_a: Sequence[int],
    signature_b: Sequence[int],
) -> float:
    """Estimasi Jaccard berdasarkan proporsi nilai MinHash yang sama."""
    if len(signature_a) != len(signature_b):
        raise ValueError("Panjang signature harus sama")
    if not signature_a:
        raise ValueError("Signature tidak boleh kosong")

    cocok = sum(a == b for a, b in zip(signature_a, signature_b))
    return cocok / len(signature_a)


def buat_bucket_lsh(
    signature: Sequence[int],
    bands: int = 32,
    rows: int = 4,
) -> list[tuple[int, str]]:
    """Membentuk kunci bucket dari signature MinHash."""
    if bands <= 0 or rows <= 0:
        raise ValueError("Bands dan rows harus lebih dari nol")
    if len(signature) != bands * rows:
        raise ValueError("Panjang signature harus sama dengan bands x rows")

    buckets = []

    for band in range(bands):
        awal = band * rows
        bagian = signature[awal:awal + rows]
        isi = ",".join(str(nilai) for nilai in bagian)
        digest = hashlib.sha256(isi.encode("utf-8")).hexdigest()
        buckets.append((band, digest))

    return buckets


def hitung_skor(jaccard: float, containment: float) -> float:
    """Menggabungkan Jaccard dan containment sesuai spesifikasi."""
    if not 0 <= jaccard <= 1:
        raise ValueError("Jaccard harus berada antara 0 dan 1")
    if not 0 <= containment <= 1:
        raise ValueError("Containment harus berada antara 0 dan 1")

    return max(jaccard, containment)


def tentukan_level(
    score: float,
    shingle_count: int,
    threshold_inspired: float = 0.20,
    threshold_similar: float = 0.50,
    threshold_plagiarism: float = 0.80,
) -> str:
    """Menentukan kategori kemiripan berdasarkan threshold konfigurasi."""
    if not 0 <= score <= 1:
        raise ValueError("Score harus berada antara 0 dan 1")

    if not (
        0 <= threshold_inspired
        < threshold_similar
        < threshold_plagiarism
        <= 1
    ):
        raise ValueError("Urutan threshold tidak valid")

    if score < threshold_inspired:
        return "original"
    if score < threshold_similar:
        return "inspired"
    if score < threshold_plagiarism:
        return "similar"
    if shingle_count < 15:
        return "similar"

    return "suspected_plagiarism"
