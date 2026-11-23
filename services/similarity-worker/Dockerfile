
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080 \
    PYTHONPATH=/app/services/similarity-worker/src:/app/libs/python

WORKDIR /app

COPY services/similarity-worker/ /app/services/similarity-worker/
COPY libs/python/ /app/libs/python/
COPY contracts/ /app/contracts/

RUN pip install --no-cache-dir --default-timeout=300 --retries=5 setuptools==75.1.0 \
    && pip install --no-cache-dir --default-timeout=300 --retries=5 --no-build-isolation \
    /app/libs/python \
    /app/services/similarity-worker

RUN useradd --create-home appuser \
    && chown -R appuser:appuser /app

USER appuser

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=3)"

CMD ["python", "-m", "app.main"]
