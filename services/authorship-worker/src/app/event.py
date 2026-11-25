from event_lib import buat_event, uuidv5

NAMESPACE = "6ba7b811-9dad-11d1-80b4-00c04fd430c8"


def buat_event_authorship(event_sumber: dict, catatan: dict, settings) -> dict:
    poem_id = catatan["poem_id"]
    version = catatan["version"]

    return buat_event(
        event_type="authorship.recorded",
        aggregate_id=poem_id,
        aggregate_version=version,
        payload=catatan,
        event_id=uuidv5(
            f"puisiapp:authorship-worker:{event_sumber['event_id']}",
            NAMESPACE,
        ),
        correlation_id=event_sumber["correlation_id"],
        causation_id=event_sumber["event_id"],
        traceparent=event_sumber.get("traceparent"),
        producer=settings.service_name,
    )
