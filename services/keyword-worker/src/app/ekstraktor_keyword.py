import math
import re
from collections import Counter
from typing import Any

from Sastrawi.Stemmer.StemmerFactory import StemmerFactory
from Sastrawi.StopWordRemover.StopWordRemoverFactory import StopWordRemoverFactory

_STEMMER = StemmerFactory().create_stemmer()
_STOPWORDS_DASAR = set(StopWordRemoverFactory().get_stop_words())
_STOPWORDS_TAMBAHAN = {
    "yang", "dan", "di", "ke", "dari", "ini", "itu", "untuk", "pada", "dengan",
    "adalah", "sebagai", "dalam", "tidak", "tak", "tiada", "bukan", "akan",
    "telah", "sudah", "sedang", "masih", "belum", "juga", "saja", "hanya",
    "pun", "lah", "kah", "nya", "ku", "mu", "aku", "kamu", "engkau", "kau",
    "dia", "ia", "kami", "kita", "mereka", "apa", "siapa", "mana", "kapan",
    "mengapa", "kenapa", "bagaimana", "bila", "jika", "kalau", "ketika",
    "saat", "waktu", "karena", "sebab", "agar", "supaya", "tetapi", "tapi",
    "namun", "melainkan", "sedangkan", "atau", "maupun", "serta", "lalu",
    "kemudian", "setelah", "sebelum", "hingga", "sampai", "oleh", "tentang",
    "terhadap", "antara", "tanpa", "bagi", "demi", "atas", "bawah", "luar",
    "sini", "situ", "sana", "begini", "begitu", "demikian", "seperti", "bagai",
    "bagaikan", "laksana", "umpama", "sangat", "amat", "terlalu", "lebih",
    "paling", "sekali", "semua", "segala", "seluruh", "setiap", "tiap",
    "beberapa", "banyak", "sedikit", "satu", "dua", "tiga", "pertama", "kedua",
    "ada", "tiada", "jadi", "menjadi", "buat", "membuat", "beri", "memberi",
    "kata", "berkata", "ucap", "ujar", "tanya", "jawab", "lihat", "melihat",
    "dengar", "mendengar", "rasa", "merasa", "tahu", "mengetahui", "ingin",
    "mau", "bisa", "dapat", "harus", "wajib", "perlu", "boleh", "mungkin",
    "wahai", "oh", "ah", "duh", "hai", "mari", "ayo", "ya", "iya", "tidak",
}
STOPWORDS = _STOPWORDS_DASAR | _STOPWORDS_TAMBAHAN

# Korpus referensi puisi Indonesia agar skor IDF bermakna sejak dokumen pertama
_KORPUS_REFERENSI: list[set[str]] = [
    {"hujan", "rindu", "malam", "kenang", "sunyi", "jendela"},
    {"senja", "langit", "awan", "angin", "laut", "ombak"},
    {"ibu", "ayah", "rumah", "pulang", "doa", "peluk"},
    {"juang", "merdeka", "tanah", "air", "langkah", "api"},
    {"tuhan", "sujud", "cahaya", "jiwa", "sabar", "syukur"},
    {"sepi", "bayang", "luka", "air", "mata", "hilang"},
    {"bunga", "pohon", "akar", "daun", "musim", "mekar"},
    {"jalan", "waktu", "mimpi", "harap", "esok", "pagi"},
]


def stem_kata(kata: str) -> str:
    bersih = re.sub(r"(.)\1{2,}", r"\1", kata.lower().strip())
    if not bersih:
        return ""
    return _STEMMER.stem(bersih)


def tokenisasi_dan_stem(teks: str) -> list[str]:
    normal = (teks or "").lower().replace("-", " ")
    kandidat = re.findall(r"[a-z]+", normal)
    hasil: list[str] = []
    for kata in kandidat:
        if len(kata) < 3 or kata in STOPWORDS:
            continue
        akar = stem_kata(kata)
        if len(akar) >= 3 and akar not in STOPWORDS:
            hasil.append(akar)
    return hasil


def hitung_tfidf(
    tokens: list[str],
    frekuensi_dokumen: dict[str, int] | None = None,
    total_dokumen: int = 0,
    max_keywords: int = 5,
) -> list[dict[str, Any]]:
    if not tokens:
        return []

    jumlah_token = len(tokens)
    hitung_tf = Counter(tokens)

    df_gabungan: Counter[str] = Counter()
    for dok in _KORPUS_REFERENSI:
        df_gabungan.update(dok)
    n_korpus = len(_KORPUS_REFERENSI)

    if frekuensi_dokumen and total_dokumen > 0:
        for term, count in frekuensi_dokumen.items():
            if count > 0:
                df_gabungan[term] += int(count)
        n_korpus += int(total_dokumen)

    # Tambahkan dokumen saat ini ke N
    n_total = n_korpus + 1

    skor_item: list[dict[str, Any]] = []
    for term, freq in hitung_tf.items():
        tf = freq / jumlah_token
        df = df_gabungan.get(term, 0) + 1
        idf = math.log((n_total + 1) / (df + 1)) + 1.0
        tfidf = tf * idf
        skor_item.append(
            {
                "keyword": term,
                "tf": round(tf, 4),
                "idf": round(idf, 4),
                "score": round(tfidf, 4),
                "count": freq,
            }
        )

    skor_item.sort(key=lambda x: (x["score"], x["count"], -len(x["keyword"])), reverse=True)
    return skor_item[: max(1, max_keywords)]


def ekstrak_kata_kunci(
    teks: str,
    *,
    frekuensi_dokumen: dict[str, int] | None = None,
    total_dokumen: int = 0,
    max_keywords: int = 5,
) -> dict[str, Any]:
    tokens = tokenisasi_dan_stem(teks)
    ranked = hitung_tfidf(
        tokens,
        frekuensi_dokumen=frekuensi_dokumen,
        total_dokumen=total_dokumen,
        max_keywords=max_keywords,
    )

    if not ranked:
        fallback = [w for w in re.findall(r"[a-z]{2,}", (teks or "").lower()) if w not in STOPWORDS]
        kata_cadangan = stem_kata(fallback[0]) if fallback else "puisi"
        kata_cadangan = kata_cadangan or "puisi"
        ranked = [{"keyword": kata_cadangan, "tf": 1.0, "idf": 1.0, "score": 1.0, "count": 1}]

    keywords = [item["keyword"] for item in ranked]
    scores = {item["keyword"]: item["score"] for item in ranked}

    return {
        "keywords": keywords,
        "scores": scores,
        "details": ranked,
        "token_count": len(tokens),
    }
