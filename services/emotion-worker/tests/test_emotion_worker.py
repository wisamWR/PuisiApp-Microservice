from pathlib import Path
from unittest.mock import MagicMock

from event_lib import buat_event, exchange_untuk, validasi_event
from pymongo.errors import DuplicateKeyError

from app.leksikon import EMOSI_URUTAN, SKOR_NETRAL, analisis_puisi, muat_kamus
from app.mongo_store import StoreMongoEmosi
from app.worker import buat_handler_emosi

LEXICON_PATH = Path(__file__).resolve().parents[1] / "data" / "kamus_emosi.json"


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
        self.cols = {"processed_events": FakeCollection(), "poem_emotions": FakeCollection()}

    def __getitem__(self, name):
        return self.cols[name]


def test_kamus_lima_emosi_minimal_50_kata():
    kamus = muat_kamus(LEXICON_PATH)
    assert set(kamus.keys()) == set(EMOSI_URUTAN)
    for emosi, kata_set in kamus.items():
        assert len(kata_set) >= 50, f"Emosi {emosi} kurang dari 50 kata"


def test_analisis_baris_netral_stemming_dan_bobot_panjang():
    kamus = muat_kamus(LEXICON_PATH)
    puisi = (
        "Meja kayu berdiri di sudut ruang\n"
        "Aku menangis pilu dalam kesepian hujan kelabu yang merana"
    )
    hasil = analisis_puisi(puisi, kamus)
    assert hasil["model"] == "lexicon-v1"
    assert hasil["lines"][0]["scores"] == SKOR_NETRAL
    assert hasil["lines"][1]["scores"]["sedih"] > 0.8
    assert hasil["dominant"] == "sedih"


def test_worker_menerbitkan_event_valid_dan_idempoten_terhadap_duplikat():
    kamus = muat_kamus(LEXICON_PATH)
    db = FakeDB()
    store = StoreMongoEmosi(db)
    publisher = MagicMock()
    handler = buat_handler_emosi(
        store=store,
        publisher=publisher,
        kamus=kamus,
        service_name="emotion-worker",
    )

    evt = buat_event(
        "poem.submitted",
        aggregate_id="poem-101",
        aggregate_version=1,
        payload={
            "poem_id": "poem-101",
            "version": 1,
            "title": "Mentari Pagi",
            "content": "Mentari pagi bersinar cerah\nHati gembira penuh tawa bahagia",
        },
        producer="poem-create-service",
    )

    assert store.proses(evt, handler) == "diproses"
    assert len(db["poem_emotions"].docs) == 1
    publisher.terbitkan.assert_called_once()

    published_event = publisher.terbitkan.call_args.args[0]
    validasi_event(published_event)
    assert published_event["event_type"] == "poem.emotion.analyzed"
    assert exchange_untuk(published_event["event_type"]) == "analysis.events"
    assert published_event["payload"]["poem_id"] == "poem-101"
    assert isinstance(published_event["payload"]["emotions"], list)
    assert len(published_event["payload"]["emotions"]) > 0
    assert all(
        {"line_number", "label", "score"} == set(item.keys())
        for item in published_event["payload"]["emotions"]
    )

    assert store.proses(evt, handler) == "duplikat"
    assert len(db["poem_emotions"].docs) == 1
    assert publisher.terbitkan.call_count == 1


def test_sepuluh_puisi_contoh_label_masuk_akal():
    kamus = muat_kamus(LEXICON_PATH)
    sampel = [
        ("Mentari pagi cerah membawa tawa bahagia dan syukur", "senang"),
        ("Bunga mekar indah di taman penuh cahaya dan sorak kemenangan", "senang"),
        ("Hujan gerimis jatuh bersama tangis duka dan luka perpisahan", "sedih"),
        ("Sendiri dalam sepi sunyi kenangan silam yang rapuh dan hampa", "sedih"),
        ("Rindu ini memeluk kalbu dalam janji cinta kasih yang setia", "cinta"),
        ("Tatap mesra kekasih pujaan hati membawa doa tulus abadi", "cinta"),
        ("Amarah membara membakar dada atas dusta dan pengkhianatan kejam", "marah"),
        ("Badai petir mengamuk saat kebencian meledak melawan kezaliman", "marah"),
        ("Malam kelam gulita membuat tubuh gemetar ketakutan di tepi jurang", "takut"),
        ("Bayangan ancaman maut mengejar langkah yang panik dan cemas", "takut"),
    ]
    for teks, harapan in sampel:
        hasil = analisis_puisi(teks, kamus)
        assert hasil["dominant"] == harapan, f"Gagal pada '{teks}': dapat {hasil['dominant']}"
