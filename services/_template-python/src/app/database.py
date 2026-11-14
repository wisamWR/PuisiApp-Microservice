from pathlib import Path

import psycopg

from app.config import load_settings

ADVISORY_LOCK_KEY = 734215001


def get_connection():
    settings = load_settings()

    if not settings.database_url:
        raise RuntimeError("DATABASE_URL belum dikonfigurasi")

    return psycopg.connect(settings.database_url)


def run_migrations(create_publication: bool = False) -> list[str]:
    settings = load_settings()

    if not settings.database_url:
        raise RuntimeError("DATABASE_URL belum dikonfigurasi")

    migration_dir = Path(__file__).resolve().parents[2] / "migrations"
    migration_files = sorted(migration_dir.glob("*.sql"))
    executed = []

    # Autocommit diperlukan agar advisory lock dan CREATE PUBLICATION
    # dapat dijalankan di luar transaction block.
    with psycopg.connect(
        settings.database_url,
        autocommit=True,
    ) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT pg_advisory_lock(%s)",
                (ADVISORY_LOCK_KEY,),
            )

            try:
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS schema_migrasi (
                        nama TEXT PRIMARY KEY,
                        dijalankan_at TIMESTAMPTZ NOT NULL DEFAULT now()
                    )
                """)

                cursor.execute("SELECT nama FROM schema_migrasi")
                applied = {row[0] for row in cursor.fetchall()}

                for migration_file in migration_files:
                    name = migration_file.name

                    if name in applied:
                        continue

                    sql = migration_file.read_text(encoding="utf-8-sig")

                    with connection.transaction():
                        cursor.execute(sql)
                        cursor.execute(
                            "INSERT INTO schema_migrasi (nama) VALUES (%s)",
                            (name,),
                        )

                    executed.append(name)

                if create_publication:
                    cursor.execute(
                        "SELECT to_regclass('public.outbox')"
                    )

                    if cursor.fetchone()[0] is None:
                        raise RuntimeError(
                            "Tabel public.outbox belum tersedia"
                        )

                    cursor.execute("""
                        SELECT EXISTS (
                            SELECT 1
                            FROM pg_publication
                            WHERE pubname = 'outbox_pub'
                        )
                    """)

                    if not cursor.fetchone()[0]:
                        cursor.execute("""
                            CREATE PUBLICATION outbox_pub
                            FOR TABLE public.outbox
                            WITH (publish = 'insert')
                        """)

            finally:
                cursor.execute(
                    "SELECT pg_advisory_unlock(%s)",
                    (ADVISORY_LOCK_KEY,),
                )

    return executed
