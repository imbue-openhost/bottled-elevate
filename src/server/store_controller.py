import time
from typing import cast

import attr
from litestar import Controller
from litestar import delete
from litestar import get
from litestar import post
from litestar.datastructures import State

from server.store import JsonDoc
from server.store import Record
from server.store import RecordStore


@attr.s(auto_attribs=True, frozen=True)
class RecordInput:
    key: str
    value: JsonDoc


@attr.s(auto_attribs=True, frozen=True)
class UpsertRequest:
    records: list[RecordInput]


@attr.s(auto_attribs=True, frozen=True)
class DeleteRequest:
    keys: list[str]


@attr.s(auto_attribs=True, frozen=True)
class RecordValue:
    value: JsonDoc | None


@attr.s(auto_attribs=True, frozen=True)
class MutationResult:
    count: int


def provide_record_store(state: State) -> RecordStore:
    return cast(RecordStore, state.record_store)


class StoreController(Controller):
    path = "/api/store"

    @get(sync_to_thread=True)
    def hydrate(self, record_store: RecordStore) -> dict[str, list[JsonDoc]]:
        return record_store.hydrate()

    @get("/{collection:str}/{key:str}", sync_to_thread=True)
    def get_one(self, collection: str, key: str, record_store: RecordStore) -> RecordValue:
        return RecordValue(value=record_store.get(collection, key))

    @post("/{collection:str}", sync_to_thread=True)
    def upsert(self, collection: str, data: UpsertRequest, record_store: RecordStore) -> MutationResult:
        records = [Record(key=r.key, value=r.value) for r in data.records]
        return MutationResult(count=record_store.upsert(collection, records, time.time()))

    @post("/{collection:str}/delete", sync_to_thread=True)
    def delete_keys(self, collection: str, data: DeleteRequest, record_store: RecordStore) -> MutationResult:
        return MutationResult(count=record_store.delete(collection, data.keys))

    @delete("/{collection:str}", sync_to_thread=True, status_code=200)
    def clear(self, collection: str, record_store: RecordStore) -> MutationResult:
        return MutationResult(count=record_store.clear(collection))
