"""Evaluasi & benchmark komparasi model leksikon vs IndoBERT untuk dokumentasi T5.1 & T5.2."""
import argparse
import json
import sys
import time
import tracemalloc
from pathlib import Path

ROOT_WORKER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT_WORKER / "src"))

from app.indobert import EMOSI_URUT, PredictorIndoBERT  # noqa: E402
from app.leksikon import analisis_puisi, muat_kamus  # noqa: E402


def hitung_metrik(y_true: list[str], y_pred: list[str]) -> tuple[float, float]:
    benar = sum(1 for a, b in zip(y_true, y_pred) if a == b)
    akurasi = benar / len(y_true) if y_true else 0.0
    f1_list = []
    for kelas in EMOSI_URUT:
        tp = sum(1 for a, b in zip(y_true, y_pred) if a == kelas and b == kelas)
        fp = sum(1 for a, b in zip(y_true, y_pred) if a != kelas and b == kelas)
        fn = sum(1 for a, b in zip(y_true, y_pred) if a == kelas and b != kelas)
        prec = tp / (tp + fp) if (tp + fp) else 0.0
        rec = tp / (tp + fn) if (tp + fn) else 0.0
        f1 = (2 * prec * rec / (prec + rec)) if (prec + rec) else 0.0
        f1_list.append(f1)
    return round(akurasi * 100, 2), round((sum(f1_list) / len(f1_list)) * 100, 2)


def benchmark_model(nama: str, fn_analisis, data_baris: list[dict], data_puisi: list[dict]) -> dict:
    tracemalloc.start()
    y_true = [item["label"] for item in data_baris]
    y_pred = [fn_analisis(item["text"])["dominant"] for item in data_baris]
    akurasi, f1_makro = hitung_metrik(y_true, y_pred)

    t0 = time.perf_counter()
    for p in data_puisi:
        fn_analisis(p["content"])
    durasi_ms = ((time.perf_counter() - t0) * 1000) / max(1, len(data_puisi))
    _, peak_bytes = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    return {
        "mode": nama,
        "akurasi_pct": akurasi,
        "f1_makro_pct": f1_makro,
        "waktu_per_puisi_ms": round(durasi_ms, 3),
        "puncak_memori_mb": round(peak_bytes / (1024 * 1024), 2),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--indobert-dir",
        default=str(Path.home() / ".cache/puisiapp/indobert-emot"),
    )
    args = parser.parse_args()

    folder = Path(__file__).resolve().parent
    baris_raw = (folder / "dataset_uji_puisi.jsonl").read_text(encoding="utf-8").splitlines()
    data_baris = [json.loads(line) for line in baris_raw if line.strip()]
    data_puisi = json.loads((folder / "puisi_contoh_10.json").read_text(encoding="utf-8"))
    kamus = muat_kamus(ROOT_WORKER / "data/kamus_emosi.json")

    def fn_lex(teks: str) -> dict:
        return analisis_puisi(teks, kamus)

    print("=== VERIFIKASI 10 PUISI CONTOH (T5.1) ===")
    lolos_10 = 0
    for p in data_puisi:
        hasil = fn_lex(p["content"])
        sesuai = hasil["dominant"] == p["expected"]
        lolos_10 += int(sesuai)
        status = "SESUAI" if sesuai else "BEDA"
        print(
            f"- {p['id']} ({p['title']}): expected={p['expected']} "
            f"| predicted={hasil['dominant']} | scores={hasil['poem_scores']} -> {status}"
        )
    print(f"Total sesuai: {lolos_10}/{len(data_puisi)}\n")

    hasil_eval = [benchmark_model("lexicon (lexicon-v1)", fn_lex, data_baris, data_puisi)]
    if Path(args.indobert_dir).exists():
        pred_bert = PredictorIndoBERT(args.indobert_dir)
        hasil_eval.append(
            benchmark_model(
                "indobert (indobert-v1)",
                pred_bert.analisis_puisi,
                data_baris,
                data_puisi,
            )
        )
    else:
        print(
            f"[Info] Bobot IndoBERT belum ditemukan di {args.indobert_dir} "
            "(jalankan train_indobert.py untuk menguji mode indobert).\n"
        )

    print("=== TABEL HASIL EVALUASI (T5.2) ===")
    print("| Mode Model | Akurasi (60 baris puisi) | F1 Makro | Waktu / Puisi | Memori Python |")
    print("| :--- | :---: | :---: | :---: | :---: |")
    for r in hasil_eval:
        print(
            f"| `{r['mode']}` | {r['akurasi_pct']}% | {r['f1_makro_pct']}% "
            f"| {r['waktu_per_puisi_ms']} ms | {r['puncak_memori_mb']} MB |"
        )


if __name__ == "__main__":
    main()
