from pathlib import Path

from app.config import load_settings
from app.indobert import PredictorIndoBERT


def test_load_settings_model_mode(monkeypatch):
    monkeypatch.setenv("MODEL", "indobert")
    monkeypatch.setenv("INDOBERT_MODEL_DIR", "/tmp/model-indobert-test")
    s = load_settings()
    assert s.model_mode == "indobert"
    assert s.indobert_model_dir == Path("/tmp/model-indobert-test")

    monkeypatch.setenv("MODEL", "tidak-valid")
    assert load_settings().model_mode == "lexicon"


def test_indobert_predictor_dengan_mock_scorer():
    pred = PredictorIndoBERT("/tmp/tidak-ada")
    pred._prediksi_baris = lambda baris: {
        "senang": 0.8 if "pagi" in baris else 0.1,
        "sedih": 0.05,
        "cinta": 0.1,
        "marah": 0.0,
        "takut": 0.05 if "pagi" in baris else 0.75,
    }
    hasil = pred.analisis_puisi("Mentari pagi cerah\nMalam gelap mencekam")
    assert hasil["model"] == "indobert-v1"
    assert hasil["dominant"] in ("senang", "takut")
    assert len(hasil["lines"]) == 2
