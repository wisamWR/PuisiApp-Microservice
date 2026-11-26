import csv
import importlib.util
import json
import sys
from collections import Counter
from pathlib import Path

# ============================================================
# PATH DAN KONFIGURASI
# ============================================================

ROOT = Path(__file__).resolve().parents[3]

DATASET_PATH = ROOT / "services/similarity-worker/eval/sources/evaluation_pairs.json"
POEMS_PATH = ROOT / "services/similarity-worker/eval/sources/selected_poems.json"
RESULTS_DIR = ROOT / "services/similarity-worker/eval/results"

BANDS = 32
ROWS = 4
NUM_HASHES = 128

THRESHOLD_INSPIRED = 0.20
THRESHOLD_SIMILAR = 0.50
THRESHOLD_PLAGIARISM = 0.80

MIN_SHINGLE_FOR_PLAGIARISM = 15
MIN_WHOLE_JACCARD_FOR_PLAGIARISM = 0.80

LEVELS = [
    "original",
    "inspired",
    "similar",
    "suspected_plagiarism",
]


# ============================================================
# LOAD MODUL PRODUKSI
# ============================================================


def load_module(module_name, file_path):
    spec = importlib.util.spec_from_file_location(module_name, file_path)

    if spec is None or spec.loader is None:
        raise ImportError(f"Tidak dapat memuat modul: {file_path}")

    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)

    return module


fingerprint = load_module(
    "evaluation_fingerprint",
    ROOT / "services/fingerprint-worker/src/app/fingerprint.py",
)

similarity = load_module(
    "evaluation_similarity",
    ROOT / "services/similarity-worker/src/app/similarity.py",
)


# ============================================================
# PERHITUNGAN SKOR SESUAI PROCESSOR PRODUKSI
# ============================================================


def estimasi_containment(jaccard, jumlah_a, jumlah_b):
    if jumlah_a <= 0 or jumlah_b <= 0:
        return 0.0

    intersection = jaccard * (jumlah_a + jumlah_b) / (1 + jaccard)

    intersection = min(
        intersection,
        jumlah_a,
        jumlah_b,
    )

    return min(1.0, intersection / jumlah_a)


def hitung_perbandingan(a, b):
    jaccard = similarity.estimasi_jaccard(
        a["signature"],
        b["signature"],
    )

    containment = estimasi_containment(
        jaccard,
        a["shingle_count"],
        b["shingle_count"],
    )

    score = similarity.hitung_skor(
        jaccard,
        containment,
    )

    return {
        "jaccard": jaccard,
        "containment": containment,
        "score": score,
    }


def tentukan_level(score, shingle_count):
    return similarity.tentukan_level(
        score,
        shingle_count,
        THRESHOLD_INSPIRED,
        THRESHOLD_SIMILAR,
        THRESHOLD_PLAGIARISM,
    )


# ============================================================
# LSH SESUAI DATABASE PRODUKSI
# ============================================================


def get_buckets(signature):
    return set(
        similarity.buat_bucket_lsh(
            signature,
            BANDS,
            ROWS,
        )
    )


def lsh_match(signature_a, signature_b):
    return bool(get_buckets(signature_a) & get_buckets(signature_b))


# ============================================================
# ATURAN KLASIFIKASI PLAGIARISME
# ============================================================


def apply_plagiarism_validation(
    prediction,
    whole_jaccard,
    shingle_count,
):
    """
    Validasi tambahan untuk prediksi suspected_plagiarism.

    Plagiarisme harus memenuhi:
    1. Prediksi awal mencapai threshold plagiarism.
    2. Jumlah shingle minimal 15.
    3. Jaccard seluruh puisi minimal 0.80.

    Jika syarat Jaccard seluruh puisi tidak terpenuhi,
    prediksi diturunkan menjadi similar.
    """

    if prediction != "suspected_plagiarism":
        return prediction

    if shingle_count < MIN_SHINGLE_FOR_PLAGIARISM:
        return "similar"

    if whole_jaccard < MIN_WHOLE_JACCARD_FOR_PLAGIARISM:
        return "similar"

    return "suspected_plagiarism"


# ============================================================
# SIMULASI PROSES KANDIDAT SESUAI PROCESSOR
# ============================================================


def evaluate_pair(source_fp, candidate_fp):

    # --------------------------------------------------------
    # WHOLE MATCH
    # --------------------------------------------------------

    whole_match = lsh_match(
        candidate_fp["signature"],
        source_fp["signature"],
    )

    whole_comparison = hitung_perbandingan(
        candidate_fp,
        source_fp,
    )

    # --------------------------------------------------------
    # STANZA MATCH
    #
    # Source    = puisi yang sudah terdaftar.
    # Candidate = puisi baru yang sedang diperiksa.
    #
    # Stanza source harus ditemukan melalui LSH.
    # Stanza tersebut kemudian dibandingkan dengan seluruh
    # stanza candidate, sesuai processor.py.
    # --------------------------------------------------------

    matched_source_stanzas = []
    stanza_scores = []

    candidate_stanzas = candidate_fp["stanza_signatures"]
    source_stanzas = source_fp["stanza_signatures"]

    candidate_buckets = [get_buckets(stanza["signature"]) for stanza in candidate_stanzas]

    for source_stanza in source_stanzas:
        source_buckets = get_buckets(source_stanza["signature"])

        if not source_buckets:
            continue

        # Cari apakah stanza source cocok dengan salah satu
        # stanza candidate melalui LSH.
        matched = any(bool(source_buckets & buckets) for buckets in candidate_buckets)

        if not matched:
            continue

        matched_source_stanzas.append(source_stanza["stanza"])

        # Sesuai processor.py:
        # bandingkan stanza source yang ditemukan dengan
        # seluruh stanza candidate.
        comparisons = []

        for candidate_stanza in candidate_stanzas:
            if candidate_stanza["shingle_count"] <= 0:
                continue

            comparison = hitung_perbandingan(
                candidate_stanza,
                source_stanza,
            )

            comparisons.append(comparison)

        if comparisons:
            best = max(
                comparisons,
                key=lambda item: item["score"],
            )

            stanza_scores.append(best)

    # --------------------------------------------------------
    # SKOR PIPELINE
    # --------------------------------------------------------

    eligible_scores = []

    if whole_match:
        eligible_scores.append(whole_comparison)

    eligible_scores.extend(stanza_scores)

    if eligible_scores:
        pipeline_best = max(
            eligible_scores,
            key=lambda item: item["score"],
        )
    else:
        pipeline_best = {
            "jaccard": 0.0,
            "containment": 0.0,
            "score": 0.0,
        }

    # --------------------------------------------------------
    # ORACLE
    #
    # Pembanding tanpa pembatasan LSH.
    # --------------------------------------------------------

    oracle_comparisons = [whole_comparison]

    for candidate_stanza in candidate_stanzas:
        for source_stanza in source_stanzas:
            if candidate_stanza["shingle_count"] <= 0 or source_stanza["shingle_count"] <= 0:
                continue

            oracle_comparisons.append(
                hitung_perbandingan(
                    candidate_stanza,
                    source_stanza,
                )
            )

    oracle_best = max(
        oracle_comparisons,
        key=lambda item: item["score"],
    )

    # --------------------------------------------------------
    # PREDIKSI
    # --------------------------------------------------------

    candidate_shingles = candidate_fp["shingle_count"]

    detected_by_lsh = whole_match or bool(matched_source_stanzas)

    oracle_prediction = tentukan_level(
        oracle_best["score"],
        candidate_shingles,
    )

    pipeline_prediction_before_gate = tentukan_level(
        pipeline_best["score"],
        candidate_shingles,
    )

    pipeline_prediction = apply_plagiarism_validation(
        pipeline_prediction_before_gate,
        whole_comparison["jaccard"],
        candidate_shingles,
    )

    return {
        "whole_lsh_match": whole_match,
        "matched_source_stanzas": matched_source_stanzas,
        "stanza_lsh_match": bool(matched_source_stanzas),
        "detected_by_lsh": detected_by_lsh,
        "jaccard_whole": whole_comparison["jaccard"],
        "containment_whole": whole_comparison["containment"],
        "score_whole": whole_comparison["score"],
        "oracle_score": oracle_best["score"],
        "pipeline_score": pipeline_best["score"],
        "pipeline_jaccard": pipeline_best["jaccard"],
        "pipeline_containment": pipeline_best["containment"],
        "oracle_prediction": oracle_prediction,
        "pipeline_prediction_before_gate": (pipeline_prediction_before_gate),
        "pipeline_prediction": pipeline_prediction,
        "plagiarism_jaccard_pass": (
            whole_comparison["jaccard"] >= MIN_WHOLE_JACCARD_FOR_PLAGIARISM
        ),
    }


# ============================================================
# METRIK EVALUASI
# ============================================================


def hitung_metrics(records, prediction_key):

    matrix = {actual: {predicted: 0 for predicted in LEVELS} for actual in LEVELS}

    for record in records:
        actual = record["expected_level"]
        predicted = record[prediction_key]

        matrix[actual][predicted] += 1

    metrics = {}

    for level in LEVELS:
        tp = matrix[level][level]

        fp = sum(matrix[actual][level] for actual in LEVELS if actual != level)

        fn = sum(matrix[level][predicted] for predicted in LEVELS if predicted != level)

        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0

        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0

        metrics[level] = {
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1_score": round(f1, 4),
            "support": sum(matrix[level].values()),
        }

    accuracy = sum(matrix[level][level] for level in LEVELS) / len(records) if records else 0.0

    return {
        "accuracy": round(accuracy, 4),
        "per_class": metrics,
        "confusion_matrix": matrix,
    }


# ============================================================
# LOAD JSON
# ============================================================


def load_json(path):
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


# ============================================================
# MAIN EVALUATION
# ============================================================


def main():

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    pairs = load_json(DATASET_PATH)
    poems = load_json(POEMS_PATH)

    if not pairs:
        raise ValueError("Dataset evaluasi kosong.")

    poem_map = {poem["poem_id"]: poem for poem in poems}

    fingerprint_cache = {}

    def get_fingerprint(text):

        if text not in fingerprint_cache:
            fingerprint_cache[text] = fingerprint.proses_fingerprint(
                text,
                jumlah_hash=NUM_HASHES,
                seed=42,
                ukuran_shingle=3,
            )

        return fingerprint_cache[text]

    results = []

    # --------------------------------------------------------
    # EVALUASI SETIAP PASANGAN
    # --------------------------------------------------------

    for pair in pairs:
        source_id = pair["source_id"]

        if source_id not in poem_map:
            raise ValueError(f"Source tidak ditemukan: {source_id}")

        source_text = poem_map[source_id]["text"]
        candidate_text = pair["candidate_text"]

        source_fp = get_fingerprint(source_text)
        candidate_fp = get_fingerprint(candidate_text)

        evaluation = evaluate_pair(
            source_fp,
            candidate_fp,
        )

        results.append(
            {
                "pair_id": pair["pair_id"],
                "source_id": source_id,
                "category": pair["category"],
                "expected_level": pair["expected_level"],
                "source_shingle_count": source_fp["shingle_count"],
                "candidate_shingle_count": candidate_fp["shingle_count"],
                "jaccard_whole": round(evaluation["jaccard_whole"], 4),
                "containment_whole": round(evaluation["containment_whole"], 4),
                "score_whole": round(evaluation["score_whole"], 4),
                "whole_lsh_match": evaluation["whole_lsh_match"],
                "stanza_lsh_match": evaluation["stanza_lsh_match"],
                "matched_source_stanzas": json.dumps(evaluation["matched_source_stanzas"]),
                "detected_by_lsh": evaluation["detected_by_lsh"],
                "oracle_score": round(evaluation["oracle_score"], 4),
                "pipeline_score": round(evaluation["pipeline_score"], 4),
                "pipeline_jaccard": round(evaluation["pipeline_jaccard"], 4),
                "pipeline_containment": round(evaluation["pipeline_containment"], 4),
                "plagiarism_jaccard_pass": (evaluation["plagiarism_jaccard_pass"]),
                "oracle_prediction": (evaluation["oracle_prediction"]),
                "pipeline_prediction_before_gate": (evaluation["pipeline_prediction_before_gate"]),
                "pipeline_prediction": (evaluation["pipeline_prediction"]),
            }
        )

    # --------------------------------------------------------
    # METRIK
    # --------------------------------------------------------

    oracle_metrics = hitung_metrics(
        results,
        "oracle_prediction",
    )

    pipeline_metrics_before_gate = hitung_metrics(
        results,
        "pipeline_prediction_before_gate",
    )

    pipeline_metrics = hitung_metrics(
        results,
        "pipeline_prediction",
    )

    lsh_detection_rate = sum(item["detected_by_lsh"] for item in results) / len(results)

    # --------------------------------------------------------
    # SIMPAN CSV
    # --------------------------------------------------------

    csv_path = RESULTS_DIR / "evaluation_results.csv"

    with csv_path.open(
        "w",
        newline="",
        encoding="utf-8-sig",
    ) as file:
        writer = csv.DictWriter(
            file,
            fieldnames=list(results[0].keys()),
        )

        writer.writeheader()
        writer.writerows(results)

    # --------------------------------------------------------
    # SIMPAN JSON
    # --------------------------------------------------------

    summary = {
        "total_pairs": len(results),
        "evaluation_assumption": (
            "Each source poem is assumed to be registered before its candidate poem."
        ),
        "thresholds": {
            "inspired": THRESHOLD_INSPIRED,
            "similar": THRESHOLD_SIMILAR,
            "suspected_plagiarism": THRESHOLD_PLAGIARISM,
            "minimum_shingles": MIN_SHINGLE_FOR_PLAGIARISM,
            "minimum_whole_jaccard_for_plagiarism": (MIN_WHOLE_JACCARD_FOR_PLAGIARISM),
        },
        "lsh_detection_rate": round(lsh_detection_rate, 4),
        "oracle_metrics": oracle_metrics,
        "pipeline_metrics_before_gate": (pipeline_metrics_before_gate),
        "pipeline_metrics": pipeline_metrics,
        "category_counts": dict(Counter(item["category"] for item in results)),
    }

    json_path = RESULTS_DIR / "evaluation_summary.json"

    with json_path.open("w", encoding="utf-8") as file:
        json.dump(
            summary,
            file,
            indent=2,
            ensure_ascii=False,
        )

    # --------------------------------------------------------
    # OUTPUT
    # --------------------------------------------------------

    print("\n========== EVALUATION SUMMARY ==========")

    print(f"Total pasangan     : {len(results)}")
    print(f"LSH detection rate : {lsh_detection_rate:.4f}")

    for name, metrics in [
        ("ORACLE", oracle_metrics),
        ("PIPELINE BEFORE GATE", pipeline_metrics_before_gate),
        ("PIPELINE AFTER GATE", pipeline_metrics),
    ]:
        print(f"\n--- {name} ---")
        print(f"Accuracy: {metrics['accuracy']:.4f}")

        for level, values in metrics["per_class"].items():
            print(
                f"{level:24} "
                f"P={values['precision']:.4f} "
                f"R={values['recall']:.4f} "
                f"F1={values['f1_score']:.4f} "
                f"N={values['support']}"
            )

    plagiarism = pipeline_metrics["per_class"]["suspected_plagiarism"]

    print("\n--- PLAGIARISM VALIDATION ---")

    print(f"Precision : {plagiarism['precision']:.4f}")
    print(f"Recall    : {plagiarism['recall']:.4f}")

    print(f"Target precision >= 0.90: {plagiarism['precision'] >= 0.90}")

    print(f"Minimum whole Jaccard: {MIN_WHOLE_JACCARD_FOR_PLAGIARISM:.2f}")

    print("\nFile hasil:")
    print(csv_path)
    print(json_path)


if __name__ == "__main__":
    main()
