# Python Microservice Template

Template dasar untuk membuat layanan Python pada arsitektur PuisiApp Microservice.

## 1. Teknologi

- Python 3.11+
- HTTP Server
- PostgreSQL dengan Psycopg 3
- Pytest
- Ruff

## 2. Struktur Folder

```text
_template-python/
├── migrations/
│   ├── 001_processed_event.sql
│   └── 002_outbox.sql
├── src/
│   └── app/
│       ├── __init__.py
│       ├── config.py
│       ├── database.py
│       └── main.py
├── tests/
│   └── test_health.py
├── Dockerfile
└── pyproject.toml
```
