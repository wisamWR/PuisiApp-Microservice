import json
import re
from pathlib import Path

EMOSI_URUTAN = ("senang", "sedih", "cinta", "marah", "takut")
SKOR_NETRAL = {emosi: round(1.0 / len(EMOSI_URUTAN), 4) for emosi in EMOSI_URUTAN}
MODEL_VERSI = "lexicon-v1"

_AKHIRAN_PARTIKEL = ("lah", "kah", "pun", "nya", "ku", "mu")
_AKHIRAN_TURUNAN = ("kan", "an", "i")
_AWALAN_SEDERHANA = (
    "meng", "meny", "men", "mem", "me",
    "peng", "peny", "pen", "pem", "pe",
    "ber", "be", "ter", "di", "ke", "se",
)


def muat_kamus(path: Path) -> dict[str, set[str]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    kamus: dict[str, set[str]] = {}
    for emosi in EMOSI_URUTAN:
        daftar = data.get(emosi)
        if not isinstance(daftar, list) or len(daftar) < 50:
            raise ValueError(f"Kamus emosi '{emosi}' wajib memiliki minimal 50 kata")
        kamus[emosi] = {str(kata).strip().lower() for kata in daftar if str(kata).strip()}
    return kamus


def gabung_kosakata(kamus: dict[str, set[str]]) -> set[str]:
    semua: set[str] = set()
    for kata_set in kamus.values():
        semua.update(kata_set)
    return semua


def stem_sederhana(kata: str, kosakata: set[str]) -> str:
    k = re.sub(r"(.)\1{2,}", r"\1", kata.lower().strip())
    if not k or k in kosakata:
        return k

    kandidat = [k]
    for suf in _AKHIRAN_PARTIKEL:
        if k.endswith(suf) and len(k) > len(suf) + 2:
            kandidat.append(k[: -len(suf)])

    diperluas: list[str] = []
    for base in kandidat:
        diperluas.append(base)
        for suf in _AKHIRAN_TURUNAN:
            if base.endswith(suf) and len(base) > len(suf) + 2:
                diperluas.append(base[: -len(suf)])

    for item in diperluas:
        if item in kosakata:
            return item
        for pref in _AWALAN_SEDERHANA:
            if item.startswith(pref) and len(item) > len(pref) + 2:
                sisa = item[len(pref) :]
                if sisa in kosakata:
                    return sisa
                # Pemulihan peluluhan huruf awal (meny- -> s, men- -> t, mem- -> p, meng- -> k)
                if pref == "meny" and ("s" + sisa) in kosakata:
                    return "s" + sisa
                if pref == "men" and ("t" + sisa) in kosakata:
                    return "t" + sisa
                if pref == "mem" and ("p" + sisa) in kosakata:
                    return "p" + sisa
                if pref == "meng" and ("k" + sisa) in kosakata:
                    return "k" + sisa

    return diperluas[-1]


def tokenisasi(baris: str, kosakata: set[str]) -> list[str]:
    bersih = baris.lower().replace("-", " ")
    kata_mentah = re.findall(r"[a-z]+", bersih)
    return [stem_sederhana(k, kosakata) for k in kata_mentah]


def analisis_puisi(teks: str, kamus: dict[str, set[str]]) -> dict[str, object]:
    kosakata = gabung_kosakata(kamus)
    baris_list = [b.strip() for b in (teks or "").splitlines() if b.strip()]
    if not baris_list:
        baris_list = [""]

    hasil_baris: list[dict[str, object]] = []
    bobot_list: list[int] = []

    for idx, baris in enumerate(baris_list):
        tokens = tokenisasi(baris, kosakata)
        hitungan = {emosi: 0 for emosi in EMOSI_URUTAN}
        for tok in tokens:
            for emosi in EMOSI_URUTAN:
                if tok in kamus[emosi]:
                    hitungan[emosi] += 1

        total_cocok = sum(hitungan.values())
        if total_cocok == 0:
            skor_baris = dict(SKOR_NETRAL)
        else:
            skor_baris = {
                emosi: round(hitungan[emosi] / total_cocok, 4) for emosi in EMOSI_URUTAN
            }

        bobot = max(len(tokens), 1)
        bobot_list.append(bobot)
        hasil_baris.append({"index": idx, "scores": skor_baris})

    total_bobot = sum(bobot_list)
    poem_scores = {
        emosi: round(
            sum(hasil_baris[i]["scores"][emosi] * bobot_list[i] for i in range(len(hasil_baris)))
            / total_bobot,
            4,
        )
        for emosi in EMOSI_URUTAN
    }
    dominant = max(EMOSI_URUTAN, key=lambda e: poem_scores[e])

    return {
        "lines": hasil_baris,
        "poem_scores": poem_scores,
        "dominant": dominant,
        "model": MODEL_VERSI,
    }
