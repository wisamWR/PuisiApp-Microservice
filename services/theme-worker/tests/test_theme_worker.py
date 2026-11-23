from pathlib import Path
from unittest.mock import MagicMock

from event_lib import buat_event, exchange_untuk, validasi_event
from pymongo.errors import DuplicateKeyError

from app.leksikon_tema import ekstrak_tema, muat_konfigurasi_tema
from app.mongo_store import StoreMongoTema
from app.worker import buat_handler_tema

THEMES_PATH = Path(__file__).resolve().parents[1] / "data" / "themes.yaml"


class FakeCollection:
    def __init__(self):
        self.docs = []

    def create_index(self, *args, **kwargs):
        return None

    def find_one(self, filt, projection=None, sort=None):
        cocok = [d for d in self.docs if all(d.get(k) == v for k, v in filt.items())]
        if not cocok:
            return None
        if sort:
            key, direction = sort[0]
            cocok.sort(key=lambda x: x.get(key, 0), reverse=(direction < 0))
        return dict(cocok[0])

    def insert_one(self, doc):
        if any(d.get("event_id") == doc.get("event_id") for d in self.docs if "event_id" in doc):
            raise DuplicateKeyError("duplikat")
        self.docs.append(dict(doc))

    def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if all(d.get(k) == v for k, v in filt.items()):
                d.update(update.get("$set", {}))
                return
        if upsert:
            baru = dict(filt)
            baru.update(update.get("$set", {}))
            self.docs.append(baru)


class FakeDB:
    def __init__(self):
        self.cols = {"processed_events": FakeCollection(), "poem_themes": FakeCollection()}

    def __getitem__(self, name):
        return self.cols[name]


def test_ekstraksi_tema_utama_pendamping_dan_lainnya():
    konfig = muat_konfigurasi_tema(THEMES_PATH)

    hasil_rindu = ekstrak_tema("Rindu ini menanti jumpa dan berpelukan di senja", konfig)
    assert hasil_rindu["primary"] == "rindu"
    assert "rindu" in hasil_rindu["themes"]

    hasil_kosong = ekstrak_tema("Meja kayu berdiri di pojok ruangan", konfig)
    assert hasil_kosong["primary"] == "lainnya"
    assert hasil_kosong["themes"] == ["lainnya"]


def test_perubahan_themes_yaml_mengubah_hasil_tanpa_ubah_kode(tmp_path: Path):
    yaml_custom = tmp_path / "themes.yaml"
    yaml_custom.write_text(
        """
ambang:
  minimum: 0.1
  pendamping: 0.5
  cadangan: lainnya
tema:
  alam:
    pelangi: 5.0
  religius:
    syukur: 1.0
""",
        encoding="utf-8",
    )
    konfig = muat_konfigurasi_tema(yaml_custom)
    hasil = ekstrak_tema("Pelangi muncul setelah hujan", konfig)
    assert hasil["primary"] == "alam"
    assert hasil["themes"] == ["alam"]


def test_worker_menyimpan_ke_theme_db_menerbitkan_event_dan_idempoten():
    konfig = muat_konfigurasi_tema(THEMES_PATH)
    db = FakeDB()
    store = StoreMongoTema(db)
    publisher = MagicMock()
    handler = buat_handler_tema(
        store=store,
        publisher=publisher,
        konfigurasi=konfig,
        service_name="theme-worker",
    )

    evt = buat_event(
        "poem.submitted",
        aggregate_id="poem-201",
        aggregate_version=1,
        payload={
            "poem_id": "poem-201",
            "version": 1,
            "title": "Doa di Malam Sepi",
            "content": "Dalam sepi malam aku berdoa memohon ampunan dan iman kepada Tuhan",
        },
        producer="poem-create-service",
    )

    assert store.proses(evt, handler) == "diproses"
    assert len(db["poem_themes"].docs) == 1
    doc = db["poem_themes"].docs[0]
    assert doc["poem_id"] == "poem-201"
    assert doc["primary"] in {"religius", "kesepian"}
    assert isinstance(doc["scores"], dict)

    publisher.terbitkan.assert_called_once()
    published_event = publisher.terbitkan.call_args.args[0]
    validasi_event(published_event)
    assert published_event["event_type"] == "poem.themes.extracted"
    assert exchange_untuk(published_event["event_type"]) == "analysis.events"
    assert published_event["payload"]["poem_id"] == "poem-201"
    assert len(published_event["payload"]["themes"]) >= 1

    # Duplikat tidak boleh diproses ulang atau menerbitkan event kedua
    assert store.proses(evt, handler) == "duplikat"
    assert len(db["poem_themes"].docs) == 1
    assert publisher.terbitkan.call_count == 1
