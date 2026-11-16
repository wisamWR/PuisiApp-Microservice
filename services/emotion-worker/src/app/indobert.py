from pathlib import Path
from typing import Any

EMOSI_URUT = ("senang", "sedih", "cinta", "marah", "takut")
LABEL_ID_KE_EMOSI = {
    0: "marah",
    1: "takut",
    2: "senang",
    3: "cinta",
    4: "sedih",
    "anger": "marah",
    "fear": "takut",
    "happy": "senang",
    "love": "cinta",
    "sadness": "sedih",
    "marah": "marah",
    "takut": "takut",
    "senang": "senang",
    "cinta": "cinta",
    "sedih": "sedih",
}


class PredictorIndoBERT:
    def __init__(self, model_dir: str | Path, device: str = "cpu") -> None:
        self.model_dir = str(model_dir)
        self.device = device
        self._tokenizer = None
        self._model = None

    def _muat_model(self) -> None:
        if self._model is not None:
            return
        try:
            import torch
            from transformers import AutoModelForSequenceClassification, AutoTokenizer
        except ImportError as exc:
            raise RuntimeError(
                "Dependensi ML belum terpasang. Jalankan: pip install -r services/emotion-worker/requirements-ml.txt"
            ) from exc

        path_lokal = Path(self.model_dir)
        if not path_lokal.exists():
            raise FileNotFoundError(
                f"Direktori bobot IndoBERT tidak ditemukan di {path_lokal}. Jalankan training/train_indobert.py terlebih dahulu."
            )

        self._torch = torch
        self._tokenizer = AutoTokenizer.from_pretrained(self.model_dir)
        self._model = AutoModelForSequenceClassification.from_pretrained(self.model_dir)
        self._model.to(self.device)
        self._model.eval()

    def _prediksi_baris(self, baris: str) -> dict[str, float]:
        self._muat_model()
        inputs = self._tokenizer(
            baris, return_tensors="pt", truncation=True, max_length=128, padding=True
        ).to(self.device)
        with self._torch.no_grad():
            logits = self._model(**inputs).logits[0]
            probs = self._torch.softmax(logits, dim=-1).cpu().tolist()

        id2label = getattr(self._model.config, "id2label", {}) or {}
        skor = {e: 0.0 for e in EMOSI_URUT}
        for idx, prob in enumerate(probs):
            raw_lbl = id2label.get(idx, id2label.get(str(idx), idx))
            key = LABEL_ID_KE_EMOSI.get(str(raw_lbl).lower(), LABEL_ID_KE_EMOSI.get(idx))
            if key in skor:
                skor[key] = round(float(prob), 4)
        return skor

    def analisis_puisi(self, teks: str) -> dict[str, Any]:
        baris_list = [b.strip() for b in str(teks or "").splitlines() if b.strip()]
        if not baris_list:
            netral = {e: 0.2 for e in EMOSI_URUT}
            return {"lines": [], "poem_scores": netral, "dominant": "senang", "model": "indobert-v1"}

        hasil_baris = []
        total_bobot = 0
        akumulasi = {e: 0.0 for e in EMOSI_URUT}

        for idx, baris in enumerate(baris_list):
            skor_baris = self._prediksi_baris(baris)
            bobot = max(1, len(baris.split()))
            total_bobot += bobot
            for e in EMOSI_URUT:
                akumulasi[e] += skor_baris[e] * bobot
            hasil_baris.append({"index": idx, "scores": skor_baris})

        poem_scores = {e: round(akumulasi[e] / total_bobot, 4) for e in EMOSI_URUT}
        dominant = max(EMOSI_URUT, key=lambda e: poem_scores[e])
        return {
            "lines": hasil_baris,
            "poem_scores": poem_scores,
            "dominant": dominant,
            "model": "indobert-v1",
        }
