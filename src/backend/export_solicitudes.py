from __future__ import annotations

import csv
import os
import sqlite3

from .config import Settings


def _fetch_rows() -> list[sqlite3.Row]:
    Settings.ensure_dirs()
    with sqlite3.connect(Settings.DB_PATH) as con:
        con.row_factory = sqlite3.Row
        return con.execute("SELECT * FROM solicitudes ORDER BY id").fetchall()


def export_solicitudes(csv_path: str | None = None) -> str:
    rows = _fetch_rows()
    if not csv_path:
        base_dir = getattr(Settings, "BASE_DIR", Settings.DATA_DIR)
        csv_path = os.path.join(base_dir, "data", "solicitudes_export.csv")
    os.makedirs(os.path.dirname(csv_path), exist_ok=True)

    fieldnames = rows[0].keys() if rows else []
    with open(csv_path, "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(dict(row))
    return csv_path


if __name__ == "__main__":
    output_path = export_solicitudes()
    print(f"Archivo generado: {output_path}")
