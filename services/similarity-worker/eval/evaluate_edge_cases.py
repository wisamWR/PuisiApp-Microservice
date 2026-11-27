import csv
import importlib.util
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]

SOURCE_FILE = ROOT / "services/similarity-worker/eval/sources/edge_cases.json"
RESULT_DIR = ROOT / "services/similarity-worker/eval/results"

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


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)

    if spec is None or spec.loader is None:
        raise ImportError(f"Tidak dapat memuat modul: {path}")

    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)

    return module


fingerprint = load_module(
    "edge_fingerprint",
    ROOT / "services/fingerprint-worker/src/app/fingerprint.py",
)

similarity = load_module(
    "edge_similarity",
    ROOT / "services/similarity-worker/src/app/similarity.py",
)


# ============================================================
# CONTAINMENT SESUAI PROCESSOR PRODUKSI
# ============================================================


def estimasi_containment(jaccard, jumlah_a, jumlah_b):
    if jumlah_a <= 0 or jumlah_b <= 0:
        return 0.0

    intersection = jaccard * (jumlah_a + jumlah_b) / (1 + jaccard)

    intersection = min(intersection, jumlah_a, jumlah_b)

    return min(1.0, intersection / jumlah_a)


def compare(candidate, source):
    jaccard = similarity.estimasi_jaccard(
        candidate["signature"],
        source["signature"],
    )

    containment = estimasi_containment(
        jaccard,
        candidate["shingle_count"],
        source["shingle_count"],
    )

    score = similarity.hitung_skor(jaccard, containment)

    return jaccard, containment, score


# ============================================================
# LSH DETECTION
# ============================================================


def lsh_match(signature_a, signature_b):
    buckets_a = set(
        similarity.buat_bucket_lsh(
            signature_a,
            BANDS,
            ROWS,
        )
    )

    buckets_b = set(
        similarity.buat_bucket_lsh(
            signature_b,
            BANDS,
            ROWS,
        )
    )

    return bool(buckets_a & buckets_b)


def stanza_lsh_match(candidate, source):
    for stanza_a in candidate["stanza_signatures"]:
        for stanza_b in source["stanza_signatures"]:
            if lsh_match(
                stanza_a["signature"],
                stanza_b["signature"],
            ):
                return True

    return False


# ============================================================
# VALIDASI PLAGIARISME
# ============================================================


def apply_plagiarism_validation(
    prediction,
    whole_jaccard,
    shingle_count,
):
    if prediction != "suspected_plagiarism":
        return prediction

    if shingle_count < MIN_SHINGLE_FOR_PLAGIARISM:
        return "similar"

    if whole_jaccard < MIN_WHOLE_JACCARD_FOR_PLAGIARISM:
        return "similar"

    return "suspected_plagiarism"


# ============================================================
# METRICS
# ============================================================


def calculate_metrics(results, prediction_key):
    matrix = {actual: {predicted: 0 for predicted in LEVELS} for actual in LEVELS}

    for row in results:
        actual = row["expected_level"]
        predicted = row[prediction_key]
        matrix[actual][predicted] += 1

    correct = sum(matrix[level][level] for level in LEVELS)

    total = len(results)
    per_class = {}

    for level in LEVELS:
        tp = matrix[level][level]

        fp = sum(matrix[actual][level] for actual in LEVELS if actual != level)

        fn = sum(matrix[level][predicted] for predicted in LEVELS if predicted != level)

        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0

        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0

        per_class[level] = {
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1_score": round(f1, 4),
            "support": sum(matrix[level].values()),
        }

    return {
        "accuracy": round(correct / total, 4) if total else 0.0,
        "per_class": per_class,
        "confusion_matrix": matrix,
    }


# ============================================================
# MAIN EVALUATION
# ============================================================


def main():
    RESULT_DIR.mkdir(parents=True, exist_ok=True)

    with SOURCE_FILE.open(encoding="utf-8") as file:
        cases = json.load(file)

    if not cases:
        raise ValueError("Dataset edge cases kosong.")

    results = []

    print("\n========== EDGE CASE EVALUATION ==========")

    for case in cases:
        source = fingerprint.proses_fingerprint(
            case["source_text"],
            jumlah_hash=NUM_HASHES,
            seed=42,
            ukuran_shingle=3,
        )

        candidate = fingerprint.proses_fingerprint(
            case["candidate_text"],
            jumlah_hash=NUM_HASHES,
            seed=42,
            ukuran_shingle=3,
        )

        # A = kandidat baru, B = sumber
        jaccard, containment, score = compare(
            candidate,
            source,
        )

        candidate_shingles = candidate["shingle_count"]

        # Prediksi tanpa penyaringan LSH
        oracle_prediction = similarity.tentukan_level(
            score,
            candidate_shingles,
            THRESHOLD_INSPIRED,
            THRESHOLD_SIMILAR,
            THRESHOLD_PLAGIARISM,
        )

        # Periksa LSH seluruh puisi
        whole_match = lsh_match(
            candidate["signature"],
            source["signature"],
        )

        # Periksa LSH antarbait
        stanza_match = stanza_lsh_match(
            candidate,
            source,
        )

        detected_by_lsh = whole_match or stanza_match

        # Prediksi sebelum validasi tambahan
        pipeline_prediction_before_gate = (
            similarity.tentukan_level(
                score,
                candidate_shingles,
                THRESHOLD_INSPIRED,
                THRESHOLD_SIMILAR,
                THRESHOLD_PLAGIARISM,
            )
            if detected_by_lsh
            else "original"
        )

        # Prediksi setelah validasi Jaccard seluruh puisi
        pipeline_prediction = apply_plagiarism_validation(
            pipeline_prediction_before_gate,
            jaccard,
            candidate_shingles,
        )

        result = {
            "case_id": case["case_id"],
            "category": case["category"],
            "expected_level": case["expected_level"],
            "oracle_prediction": oracle_prediction,
            "pipeline_prediction_before_gate": (pipeline_prediction_before_gate),
            "pipeline_prediction": pipeline_prediction,
            "source_shingle_count": source["shingle_count"],
            "candidate_shingle_count": candidate_shingles,
            "jaccard": round(jaccard, 4),
            "containment": round(containment, 4),
            "score": round(score, 4),
            "whole_lsh_match": whole_match,
            "stanza_lsh_match": stanza_match,
            "detected_by_lsh": detected_by_lsh,
            "plagiarism_jaccard_pass": (jaccard >= MIN_WHOLE_JACCARD_FOR_PLAGIARISM),
            "purpose": case["purpose"],
        }

        results.append(result)

        print(
            f"{case['case_id']:12} "
            f"expected={case['expected_level']:22} "
            f"before={pipeline_prediction_before_gate:22} "
            f"after={pipeline_prediction:22} "
            f"shingles={candidate_shingles:3} "
            f"jaccard={jaccard:.4f} "
            f"LSH={detected_by_lsh}"
        )

    # ========================================================
    # METRICS DAN RINGKASAN
    # ========================================================

    oracle_metrics = calculate_metrics(
        results,
        "oracle_prediction",
    )

    before_metrics = calculate_metrics(
        results,
        "pipeline_prediction_before_gate",
    )

    pipeline_metrics = calculate_metrics(
        results,
        "pipeline_prediction",
    )

    short_cases = [
        row for row in results if row["candidate_shingle_count"] < MIN_SHINGLE_FOR_PLAGIARISM
    ]

    category_counts = Counter(row["category"] for row in results)

    summary = {
        "total_cases": len(results),
        "thresholds": {
            "inspired": THRESHOLD_INSPIRED,
            "similar": THRESHOLD_SIMILAR,
            "suspected_plagiarism": THRESHOLD_PLAGIARISM,
            "minimum_shingles": MIN_SHINGLE_FOR_PLAGIARISM,
            "minimum_whole_jaccard": (MIN_WHOLE_JACCARD_FOR_PLAGIARISM),
        },
        "category_counts": dict(category_counts),
        "short_cases_below_15": len(short_cases),
        "short_case_ids": [row["case_id"] for row in short_cases],
        "lsh_detected": sum(row["detected_by_lsh"] for row in results),
        "oracle_metrics": oracle_metrics,
        "pipeline_metrics_before_gate": before_metrics,
        "pipeline_metrics": pipeline_metrics,
        "results": results,
    }

    # ========================================================
    # SAVE CSV
    # ========================================================

    csv_path = RESULT_DIR / "edge_case_results.csv"

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

    # ========================================================
    # SAVE JSON
    # ========================================================

    json_path = RESULT_DIR / "edge_case_summary.json"

    with json_path.open("w", encoding="utf-8") as file:
        json.dump(
            summary,
            file,
            indent=2,
            ensure_ascii=False,
        )

    # ========================================================
    # PRINT SUMMARY
    # ========================================================

    print("\n========== SUMMARY ==========")
    print(f"Total cases       : {len(results)}")
    print(f"Short cases < 15  : {len(short_cases)}")
    print(f"LSH detected      : {summary['lsh_detected']}")

    for name, metrics in [
        ("ORACLE", oracle_metrics),
        ("PIPELINE BEFORE GATE", before_metrics),
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

    print("\nFile hasil:")
    print(csv_path)
    print(json_path)


if __name__ == "__main__":
    main()
