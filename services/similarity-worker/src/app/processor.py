
from app.database import cari_kandidat
from app.similarity import estimasi_jaccard, hitung_skor


def estimasi_containment(
    jaccard: float,
    jumlah_a: int,
    jumlah_b: int,
) -> float:
    """Memperkirakan containment berdasarkan Jaccard dan jumlah shingle."""
    if jumlah_a <= 0 or jumlah_b <= 0:
        return 0.0

    intersection = (
        jaccard * (jumlah_a + jumlah_b) / (1 + jaccard)
    )

    intersection = min(intersection, jumlah_a, jumlah_b)

    return min(1.0, intersection / jumlah_a)


def hitung_skor_kemiripan(
    signature_a: list[int],
    signature_b: list[int],
    jumlah_a: int,
    jumlah_b: int,
) -> tuple[float, float, float]:
    """Menghitung Jaccard, containment, dan skor akhir."""
    jaccard = estimasi_jaccard(signature_a, signature_b)

    containment = estimasi_containment(
        jaccard,
        jumlah_a,
        jumlah_b,
    )

    score = hitung_skor(jaccard, containment)

    return jaccard, containment, score


def proses_kandidat(cur, payload: dict) -> list[dict]:
    # Puisi tanpa shingle tidak dibandingkan.
    if payload["shingle_count"] == 0:
        return []

    kandidat = cari_kandidat(cur, payload)
    hasil = []

    for item in kandidat:
        # Hitung Jaccard seluruh puisi untuk setiap kandidat.
        whole_jaccard = estimasi_jaccard(
            payload["signature"],
            item["signature"],
        )

        if item["match_kind"] == "whole":
            jaccard, containment, score = hitung_skor_kemiripan(
                payload["signature"],
                item["signature"],
                payload["shingle_count"],
                item["shingle_count"],
            )

            matched_stanza = None
            source_stanza = None

        else:
            stanza_kandidat = next(
                (
                    stanza
                    for stanza in item["stanza_signatures"]
                    if stanza["stanza"] == item["matched_stanza"]
                ),
                None,
            )

            if stanza_kandidat is None:
                continue

            signature_kandidat = stanza_kandidat["signature"]
            jumlah_kandidat = stanza_kandidat.get("shingle_count", 0)

            if jumlah_kandidat <= 0:
                continue

            perbandingan = []

            for stanza in payload["stanza_signatures"]:
                jumlah_sumber = stanza.get("shingle_count", 0)

                if jumlah_sumber <= 0:
                    continue

                j, c, s = hitung_skor_kemiripan(
                    stanza["signature"],
                    signature_kandidat,
                    jumlah_sumber,
                    jumlah_kandidat,
                )

                perbandingan.append(
                    (s, j, c, stanza["stanza"])
                )

            if not perbandingan:
                continue

            score, jaccard, containment, source_stanza = max(
                perbandingan,
                key=lambda hasil: hasil[0],
            )

            matched_stanza = item["matched_stanza"]

        hasil.append(
            {
                "poem_id": str(item["poem_id"]),
                "version": item["version"],
                "jaccard_estimate": jaccard,
                "whole_jaccard_estimate": whole_jaccard,
                "containment_estimate": containment,
                "score": score,
                "matched_stanza": matched_stanza,
                "source_stanza": source_stanza,
                "match_kind": item["match_kind"],
            }
        )

    return sorted(
        hasil,
        key=lambda item: item["score"],
        reverse=True,
    )
