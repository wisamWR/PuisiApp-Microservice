FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080 \
    CONTRACTS_DIR=/app/contracts \
    LEXICON_PATH=/app/services/emotion-worker/data/kamus_emosi.json

WORKDIR /app

COPY contracts /app/contracts
COPY libs/python /app/libs/python
RUN pip install --no-cache-dir -r /app/libs/python/requirements.txt \
    && pip install --no-cache-dir --no-deps /app/libs/python

COPY services/emotion-worker /app/services/emotion-worker
RUN pip install --no-cache-dir -r /app/services/emotion-worker/requirements.txt \
    && pip install --no-cache-dir --no-deps /app/services/emotion-worker

RUN useradd --create-home appuser \
    && chown -R appuser:appuser /app

USER appuser

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=3)"

CMD ["python", "-m", "app.main"]
