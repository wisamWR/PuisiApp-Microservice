FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080 \
    PYTHONPATH=/app/services/authorship-worker/src:/app/libs/python

WORKDIR /app

COPY services/authorship-worker/ /app/services/authorship-worker/
COPY libs/python/ /app/libs/python/
COPY contracts/ /app/contracts/

RUN pip install --no-cache-dir \
    /app/libs/python \
    /app/services/authorship-worker

RUN useradd --create-home appuser \
    && chown -R appuser:appuser /app

USER appuser

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=3)"

CMD ["python", "-m", "app.main"]
