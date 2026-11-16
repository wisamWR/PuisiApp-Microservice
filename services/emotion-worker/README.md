# emotion-worker (Kelompok 5 - Mood)

Worker analisis emosi per baris puisi berbasis leksikon 5 emosi (`senang`, `sedih`, `cinta`, `marah`, `takut`). Keluaran menggunakan format yang sama persis dengan rencana model IndoBERT (`poem.emotion.analyzed`, `model: "lexicon-v1"`).

## Pengujian Lokal
```bash
pip install -r libs/python/requirements-dev.txt -r services/emotion-worker/requirements.txt
PYTHONPATH=libs/python:services/emotion-worker/src pytest -v services/emotion-worker/tests

