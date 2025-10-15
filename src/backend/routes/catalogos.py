from __future__ import annotations
from flask import Blueprint, request
from typing import Any, Dict
from ..db import get_connection
from ..security import verify_access_token
from .admin import CATALOG_RESOURCES

bp = Blueprint("catalogos", __name__, url_prefix="/api/catalogos")
COOKIE_NAME = "spm_token"


def _require_auth() -> str | None:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        header = request.headers.get("Authorization", "")
        if header.startswith("Bearer "):
            token = header.split(" ", 1)[1].strip()
    if not token:
        return None
    try:
        payload = verify_access_token(token)
    except Exception:
        return None
    return payload.get("sub")


def _row_to_item(meta: Dict[str, Any], row: Dict[str, Any]) -> Dict[str, Any]:
    item = dict(row)
    for boolean_field in meta.get("bools", ()):  # type: ignore[arg-type]
        if boolean_field in item:
            item[boolean_field] = bool(item[boolean_field])
    return item


def _fetch_catalog(con, resource: str, *, include_inactive: bool = False):
    meta = CATALOG_RESOURCES.get(resource)
    if not meta:
        return None
    table = meta["table"]
    order_by = meta.get("order_by") or "id"
    rows = con.execute(f"SELECT * FROM {table} ORDER BY {order_by}").fetchall()
    items = []
    for row in rows:
        item = _row_to_item(meta, row)
        if not include_inactive and "activo" in meta.get("fields", ()):  # type: ignore[arg-type]
            if not item.get("activo", False):
                continue
        items.append(item)
    return items


@bp.get("")
def obtener_catalogos():
    uid = _require_auth()
    if not uid:
        return {"ok": False, "error": {"code": "NOAUTH", "message": "No autenticado"}}, 401
    include_inactive = request.args.get("include_inactive", "0").lower() in {"1", "true", "si", "sí"}
    data: Dict[str, Any] = {}
    with get_connection() as con:
        for resource in CATALOG_RESOURCES:
            items = _fetch_catalog(con, resource, include_inactive=include_inactive)
            data[resource] = items or []
    return {"ok": True, "data": data}


@bp.get("/<resource>")
def obtener_catalogo(resource: str):
    uid = _require_auth()
    if not uid:
        return {"ok": False, "error": {"code": "NOAUTH", "message": "No autenticado"}}, 401
    include_inactive = request.args.get("include_inactive", "0").lower() in {"1", "true", "si", "sí"}
    with get_connection() as con:
        items = _fetch_catalog(con, resource, include_inactive=include_inactive)
        if items is None:
            return {"ok": False, "error": {"code": "UNKNOWN", "message": "Recurso desconocido"}}, 404
    return {"ok": True, "items": items}

