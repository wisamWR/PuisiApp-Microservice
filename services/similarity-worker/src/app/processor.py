from app.database import cari_kandidat
from app.similarity import estimasi_jaccard


def proses_kandidat(cur, payload: dict) -> list[dict]:
    # Puisi tanpa shingle hanya punya signature sentinel; membandingkannya
    # akan menghasilkan Jaccard 1,0 terhadap puisi kosong lain.
    if payload["shingle_count"] == 0:
        return []

    kandidat = cari_kandidat(cur, payload)
    hasil = []

    for item in kandidat:
        if item["match_kind"] == "whole":
            skor = estimasi_jaccard(
                payload["signature"],
                item["signature"],
            )
            matched_stanza = None
            source_stanza = None

        else:
            signature_kandidat = next(
                (
                    stanza["signature"]
                    for stanza in item["stanza_signatures"]
                    if stanza["stanza"] == item["matched_stanza"]
                ),
                None,
            )

            if signature_kandidat is None:
                continue

            perbandingan = [
                (
                    estimasi_jaccard(stanza["signature"], signature_kandidat),
                    stanza["stanza"],
                )
                for stanza in payload["stanza_signatures"]
            ]

            if not perbandingan:
                continue

            skor, source_stanza = max(perbandingan, key=lambda hasil: hasil[0])
            matched_stanza = item["matched_stanza"]

        hasil.append(
            {
                "poem_id": str(item["poem_id"]),
                "version": item["version"],
                "jaccard_estimate": skor,
                "matched_stanza": matched_stanza,
                "source_stanza": source_stanza,
                "match_kind": item["match_kind"],
            }
        )

    return sorted(
        hasil,
        key=lambda item: item["jaccard_estimate"],
        reverse=True,
    )
