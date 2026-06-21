from pathlib import Path

from server.store import Record
from server.store import RecordStore


def _store(tmp_path: Path) -> RecordStore:
    return RecordStore(str(tmp_path / "main.db"))


def test_upsert_then_get(tmp_path: Path) -> None:
    store = _store(tmp_path)
    store.upsert("activities", [Record(key="a:1", value={"id": "a:1", "name": "Ride"})], now=1.0)
    assert store.get("activities", "a:1") == {"id": "a:1", "name": "Ride"}
    assert store.get("activities", "missing") is None


def test_upsert_overwrites_same_key(tmp_path: Path) -> None:
    store = _store(tmp_path)
    store.upsert("userSettings", [Record(key="singleton", value={"mapToken": ""})], now=1.0)
    store.upsert("userSettings", [Record(key="singleton", value={"mapToken": "pk.abc"})], now=2.0)
    assert store.get("userSettings", "singleton") == {"mapToken": "pk.abc"}


def test_hydrate_groups_by_collection(tmp_path: Path) -> None:
    store = _store(tmp_path)
    store.upsert(
        "activities", [Record(key="a:1", value={"id": "a:1"}), Record(key="a:2", value={"id": "a:2"})], now=1.0
    )
    store.upsert("athlete", [Record(key="singleton", value={"gender": "men"})], now=1.0)
    hydrated = store.hydrate()
    assert {a["id"] for a in hydrated["activities"]} == {"a:1", "a:2"}
    assert hydrated["athlete"] == [{"gender": "men"}]


def test_hydrate_excludes_large_collections(tmp_path: Path) -> None:
    store = _store(tmp_path)
    store.upsert("activities", [Record(key="a:1", value={"id": "a:1"})], now=1.0)
    store.upsert("streams", [Record(key="a:1", value={"activityId": "a:1", "deflatedStreams": "xxx"})], now=1.0)
    hydrated = store.hydrate()
    assert "activities" in hydrated
    assert "streams" not in hydrated
    # ...but a large-collection record is still individually fetchable.
    assert store.get("streams", "a:1") == {"activityId": "a:1", "deflatedStreams": "xxx"}


def test_delete_keys(tmp_path: Path) -> None:
    store = _store(tmp_path)
    store.upsert("activities", [Record(key="a:1", value={}), Record(key="a:2", value={})], now=1.0)
    assert store.delete("activities", ["a:1"]) == 1
    assert store.get("activities", "a:1") is None
    assert store.get("activities", "a:2") is not None


def test_clear_collection(tmp_path: Path) -> None:
    store = _store(tmp_path)
    store.upsert("activities", [Record(key="a:1", value={}), Record(key="a:2", value={})], now=1.0)
    store.upsert("athlete", [Record(key="singleton", value={})], now=1.0)
    assert store.clear("activities") == 2
    assert store.hydrate().get("activities", []) == []
    assert store.get("athlete", "singleton") is not None


def test_store_survives_reopen(tmp_path: Path) -> None:
    store = _store(tmp_path)
    store.upsert("activities", [Record(key="a:1", value={"id": "a:1"})], now=1.0)
    reopened = _store(tmp_path)
    assert reopened.get("activities", "a:1") == {"id": "a:1"}
