from collections.abc import Iterator
from pathlib import Path

import pytest
from litestar import Litestar
from litestar.datastructures import State
from litestar.di import Provide
from litestar.testing import TestClient

from server.store import RecordStore
from server.store_controller import StoreController
from server.store_controller import provide_record_store


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient[Litestar]]:
    store = RecordStore(str(tmp_path / "main.db"))
    app = Litestar(
        route_handlers=[StoreController],
        state=State({"record_store": store}),
        dependencies={"record_store": Provide(provide_record_store, sync_to_thread=False)},
    )
    with TestClient(app=app) as test_client:
        yield test_client


def test_upsert_and_hydrate_roundtrip(client: TestClient[Litestar]) -> None:
    resp = client.post(
        "/api/store/activities",
        json={"records": [{"key": "a:1", "value": {"id": "a:1", "type": "Ride"}}]},
    )
    assert resp.status_code == 201
    assert resp.json() == {"count": 1}

    hydrate = client.get("/api/store")
    assert hydrate.status_code == 200
    assert hydrate.json() == {"activities": [{"id": "a:1", "type": "Ride"}]}


def test_get_one_returns_value_or_null(client: TestClient[Litestar]) -> None:
    client.post("/api/store/streams", json={"records": [{"key": "a:1", "value": {"deflatedStreams": "z"}}]})

    found = client.get("/api/store/streams/a:1")
    assert found.json() == {"value": {"deflatedStreams": "z"}}

    missing = client.get("/api/store/streams/nope")
    assert missing.json() == {"value": None}


def test_streams_excluded_from_hydrate(client: TestClient[Litestar]) -> None:
    client.post("/api/store/streams", json={"records": [{"key": "a:1", "value": {"deflatedStreams": "z"}}]})
    client.post("/api/store/activities", json={"records": [{"key": "a:1", "value": {"id": "a:1"}}]})
    assert set(client.get("/api/store").json().keys()) == {"activities"}


def test_delete_and_clear(client: TestClient[Litestar]) -> None:
    client.post(
        "/api/store/activities",
        json={"records": [{"key": "a:1", "value": {}}, {"key": "a:2", "value": {}}]},
    )

    deleted = client.post("/api/store/activities/delete", json={"keys": ["a:1"]})
    assert deleted.json() == {"count": 1}

    cleared = client.request("DELETE", "/api/store/activities")
    assert cleared.status_code == 200
    assert cleared.json() == {"count": 1}
    assert client.get("/api/store").json() == {}
