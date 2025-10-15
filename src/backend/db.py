from __future__ import annotations
import sqlite3, threading
from contextlib import contextmanager
from typing import Iterator, Any, Dict
from .config import Settings

_lock = threading.Lock()

def _row_factory(cursor, row) -> Dict[str, Any]:
    return {col[0]: row[idx] for idx, col in enumerate(cursor.description)}

def _apply_pragmas(con: sqlite3.Connection) -> None:
    con.execute("PRAGMA journal_mode=WAL;")
    con.execute("PRAGMA foreign_keys=ON;")
    con.execute("PRAGMA synchronous=NORMAL;")

@contextmanager
def get_connection() -> Iterator[sqlite3.Connection]:
    Settings.ensure_dirs()
    with _lock:
        con = sqlite3.connect(Settings.DB_PATH, timeout=30)
    try:
        con.row_factory = _row_factory
        _apply_pragmas(con)
        yield con
    finally:
        con.close()

def health_ok() -> bool:
    try:
        with get_connection() as con:
            con.execute("SELECT 1;")
        return True
    except Exception:
        return False

