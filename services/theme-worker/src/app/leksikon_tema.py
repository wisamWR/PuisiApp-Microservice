import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

TEMA_BAKU = (
    "rindu",
    "kesepian",
    "alam",
    "perjuangan",
    "keluarga",
    "religius",
)
TEMA_CADANGAN_BAKU = "lainnya"
AMBANG_MINIMUM_BAKU = 0.15
AMBANG_PENDAMPING_BAKU = 0.35

_AKHIRAN_PARTIKEL = ("lah", "kah", "pun", "nya", "ku", "mu")
_AKHIRAN_TURUNAN = ("kan", "an", "i")
_AWALAN_SEDERHANA = (
    "meng", "meny", "men", "mem", "me",
    "peng", "peny", "pen", "pem", "pe",
    "ber", "be", "ter", "di", "ke", "se",
)


@dataclass(frozen=True)
class KonfigurasiTema:
    bobot_tema: dict[str, dict[str, float]]
    ambang_minimum: float = AMBANG_MINIMUM_BAKU
    ambang_pendamping: float = AMBANG_PENDAMPING_BAKU
    tema_cadangan: str = TEMA_CADANGAN_BAKU


def _parse_yaml_sederhana(teks: str) -> dict[str, Any]:
    """Parser cadangan ringan bila PyYAML tidak tersedia."""
    hasil: dict[str, Any] = {}
    bagian_aktif: str | None = None
    tema_aktif: str | None = None

    for baris_mentah in teks.splitlines():
        baris = baris_mentah.split("#", 1)[0].rstrip()
        if not baris.strip():
            continue
        indent = len(baris) - len(baris.lstrip(" "))
        isi = baris.strip()

        if indent == 0 and isi.endswith(":"):
            bagian_aktif = isi[:-1].strip()
            hasil[bagian_aktif] = {}
            tema_aktif = None
        elif indent == 2 and bagian_aktif == "ambang" and ":" in isi:
            k, v = isi.split(":", 1)
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            try:
                hasil["ambang"][k] = float(v) if "." in v else v
            except ValueError:
                hasil["ambang"][k] = v
        elif indent == 2 and bagian_aktif == "tema" and isi.endswith(":"):
            tema_aktif = isi[:-1].strip()
            hasil["tema"][tema_aktif] = {}
        elif indent == 4 and bagian_aktif == "tema" and tema_aktif and ":" in isi:
            kata, bobot = isi.split(":", 1)
            hasil["tema"][tema_aktif][kata.strip().lower()] = float(bobot.strip())

    return hasil


def muat_konfigurasi_tema(path: Path) -> KonfigurasiTema:
    konten = path.read_text(encoding="utf-8")
    try:
        data = yaml.safe_load(konten) or {}
    except Exception:
        data = _parse_yaml_sederhana(konten)

    if not isinstance(data, dict):
        raise ValueError("Format themes.yaml tidak valid")

    raw_tema = data.get("tema")
    if not isinstance(raw_tema, dict) or not raw_tema:
        raise ValueError("Bagian 'tema' pada themes.yaml wajib diisi")

    bobot_tema: dict[str, dict[str, float]] = {}
    for nama_tema, daftar_kata in raw_tema.items():
        tema = str(nama_tema).strip().lower()
        if not tema or not isinstance(daftar_kata, dict) or not daftar_kata:
            raise ValueError(f"Tema '{nama_tema}' pada themes.yaml harus memiliki daftar kata")
        kamus_kata: dict[str, float] = {}
        for kata, bobot in daftar_kata.items():
            k = str(kata).strip().lower()
            nilai = float(bobot)
            if k and nilai > 0:
                kamus_kata[k] = nilai
        if not kamus_kata:
            raise ValueError(f"Tema '{tema}' tidak memiliki kata berbobot positif")
        bobot_tema[tema] = kamus_kata

    ambang_raw = data.get("ambang") or {}
    ambang_minimum = float(ambang_raw.get("minimum", AMBANG_MINIMUM_BAKU))
    ambang_pendamping = float(ambang_raw.get("pendamping", AMBANG_PENDAMPING_BAKU))
    raw_cadangan = str(ambang_raw.get("cadangan", TEMA_CADANGAN_BAKU)).strip().lower()
    tema_cadangan = raw_cadangan or TEMA_CADANGAN_BAKU

    return KonfigurasiTema(
        bobot_tema=bobot_tema,
        ambang_minimum=ambang_minimum,
        ambang_pendamping=ambang_pendamping,
        tema_cadangan=tema_cadangan,
    )


def gabung_kosakata(bobot_tema: dict[str, dict[str, float]]) -> set[str]:
    kosakata: set[str] = set()
    for kamus in bobot_tema.values():
        kosakata.update(kamus.keys())
    return kosakata


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
                if pref == "meny" and ("s" + sisa) in kosakata:
                    return "s" + sisa
                if pref == "men" and ("t" + sisa) in kosakata:
                    return "t" + sisa
                if pref == "mem" and ("p" + sisa) in kosakata:
                    return "p" + sisa
                if pref == "meng" and ("k" + sisa) in kosakata:
                    return "k" + sisa

    return diperluas[-1]


def tokenisasi_puisi(teks: str, kosakata: set[str]) -> list[str]:
    bersih = (teks or "").lower().replace("-", " ")
    kata_mentah = re.findall(r"[a-z]+", bersih)
    return [stem_sederhana(k, kosakata) for k in kata_mentah]


def ekstrak_tema(teks: str, konfigurasi: KonfigurasiTema) -> dict[str, Any]:
    kosakata = gabung_kosakata(konfigurasi.bobot_tema)
    tokens = tokenisasi_puisi(teks, kosakata)
    jumlah_token = max(len(tokens), 1)

    total_bobot_mentah: dict[str, float] = {}
    scores: dict[str, float] = {}

    for tema, kamus in konfigurasi.bobot_tema.items():
        bobot_cocok = sum(kamus[tok] for tok in tokens if tok in kamus)
        total_bobot_mentah[tema] = round(bobot_cocok, 4)
        # Normalisasi relatif terhadap panjang puisi dan bobot maksimum yang wajar
        skor_norm = min(1.0, bobot_cocok / (jumlah_token * 0.65))
        scores[tema] = round(skor_norm, 4)

    peringkat = sorted(
        konfigurasi.bobot_tema.keys(),
        key=lambda t: (scores[t], total_bobot_mentah[t]),
        reverse=True,
    )

    terbaik = peringkat[0] if peringkat else None
    skor_terbaik = scores[terbaik] if terbaik else 0.0

    if not terbaik or skor_terbaik < konfigurasi.ambang_minimum or total_bobot_mentah[terbaik] <= 0:
        primary = konfigurasi.tema_cadangan
        secondary = None
        themes = [konfigurasi.tema_cadangan]
    else:
        primary = terbaik
        kedua = peringkat[1] if len(peringkat) > 1 else None
        if (
            kedua
            and kedua != primary
            and total_bobot_mentah[kedua] > 0
            and scores[kedua] >= konfigurasi.ambang_pendamping
        ):
            secondary = kedua
            themes = [primary, secondary]
        else:
            secondary = None
            themes = [primary]

    return {
        "primary": primary,
        "secondary": secondary,
        "scores": scores,
        "themes": themes,
        "tokens": tokens,
    }
