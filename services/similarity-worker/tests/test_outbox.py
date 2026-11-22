from app.outbox import simpan_outbox


class FakeCursor:
    def __init__(self):
        self.query = None
        self.params = None

    def execute(self, query, params):
        self.query = query
        self.params = params


def test_simpan_outbox_menggunakan_kolom_yang_benar():
    cur = FakeCursor()
    event = {
        "event_id": "11111111-1111-4111-8111-111111111111",
        "aggregate_type": "poem",
        "aggregate_id": "22222222-2222-4222-8222-222222222222",
        "event_type": "poem.similarity.scored",
        "occurred_at": "2026-11-22T00:00:00Z",
        "payload": {
            "poem_id": "22222222-2222-4222-8222-222222222222",
            "score": 0.95,
            "level": "suspected_plagiarism",
            "comparisons": [],
        },
    }

    simpan_outbox(cur, event)

    assert "INSERT INTO outbox" in cur.query
    assert "event_id" in cur.query
    assert "aggregate_type" in cur.query
    assert "aggregate_id" in cur.query
    assert "event_type" in cur.query
    assert "payload" in cur.query
    assert cur.params[:4] == (
        event["event_id"],
        event["aggregate_type"],
        event["aggregate_id"],
        event["event_type"],
    )


def test_simpan_outbox_menyimpan_amplop_utuh():
    # outbox-relay meneruskan kolom payload apa adanya; konsumen butuh amplop.
    cur = FakeCursor()
    event = {
        "event_id": "11111111-1111-4111-8111-111111111111",
        "aggregate_id": "22222222-2222-4222-8222-222222222222",
        "event_type": "poem.similarity.scored",
        "occurred_at": "2026-11-22T00:00:00Z",
        "payload": {"poem_id": "22222222-2222-4222-8222-222222222222"},
    }

    simpan_outbox(cur, event)

    assert cur.params[4].adapted == event
    assert cur.params[5] == event["occurred_at"]
