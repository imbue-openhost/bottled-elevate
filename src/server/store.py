import json
import sqlite3
from collections.abc import Iterable
from contextlib import closing
from typing import Any

import attr

# A document is opaque JSON persisted verbatim — the server never inspects its shape.
JsonDoc = Any

# Collections stored per-record like any other, but excluded from the bulk hydrate so a page
# load doesn't pull tens of MB it won't use. The client fetches these by key on demand instead.
LARGE_COLLECTIONS: frozenset[str] = frozenset({"streams"})


@attr.s(auto_attribs=True, frozen=True)
class Record:
    key: str
    value: JsonDoc


class RecordStore:
    """Single-table key/value store: (collection, key) -> opaque JSON document, backed by sqlite.

    The browser app keeps an in-memory mirror for querying; this store is the durable source of
    truth. Every mutation is written through here, and a session hydrates its collections from here.
    """

    def __init__(self, db_path: str) -> None:
        self._db_path = db_path
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        return conn

    def _init_schema(self) -> None:
        with closing(self._connect()) as conn, conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS records (
                    collection TEXT NOT NULL,
                    key TEXT NOT NULL,
                    value TEXT NOT NULL,
                    updated_at REAL NOT NULL,
                    PRIMARY KEY (collection, key)
                )
                """
            )

    def hydrate(self) -> dict[str, list[JsonDoc]]:
        """Every record grouped by collection, minus the large collections (fetched on demand)."""
        sql = "SELECT collection, value FROM records"
        params: list[str] = []
        if LARGE_COLLECTIONS:
            placeholders = ",".join("?" * len(LARGE_COLLECTIONS))
            sql += f" WHERE collection NOT IN ({placeholders})"
            params = sorted(LARGE_COLLECTIONS)
        out: dict[str, list[JsonDoc]] = {}
        with closing(self._connect()) as conn:
            for collection, value in conn.execute(sql, params):
                out.setdefault(collection, []).append(json.loads(value))
        return out

    def get(self, collection: str, key: str) -> JsonDoc | None:
        with closing(self._connect()) as conn:
            row = conn.execute(
                "SELECT value FROM records WHERE collection = ? AND key = ?",
                (collection, key),
            ).fetchone()
        return json.loads(row[0]) if row is not None else None

    def upsert(self, collection: str, records: Iterable[Record], now: float) -> int:
        rows = [(collection, r.key, json.dumps(r.value), now) for r in records]
        with closing(self._connect()) as conn, conn:
            conn.executemany(
                """
                INSERT INTO records (collection, key, value, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT (collection, key)
                DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
                """,
                rows,
            )
        return len(rows)

    def delete(self, collection: str, keys: Iterable[str]) -> int:
        key_rows = [(collection, key) for key in keys]
        with closing(self._connect()) as conn, conn:
            conn.executemany("DELETE FROM records WHERE collection = ? AND key = ?", key_rows)
        return len(key_rows)

    def clear(self, collection: str) -> int:
        with closing(self._connect()) as conn, conn:
            cursor = conn.execute("DELETE FROM records WHERE collection = ?", (collection,))
            return cursor.rowcount
