from __future__ import annotations
from flask import Blueprint, request
from ..db import get_connection
from ..security import verify_access_token
from .solicitudes import STATUS_PENDING

bp = Blueprint("notificaciones", __name__, url_prefix="/api")

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


@bp.get("/notificaciones")
def listar_notificaciones():
    uid = _require_auth()
    if not uid:
        return {"ok": False, "error": {"code": "NOAUTH", "message": "No autenticado"}}, 401
    with get_connection() as con:
        rows = con.execute(
            """
            SELECT id, solicitud_id, mensaje, leido, created_at
            FROM notificaciones
            WHERE lower(destinatario_id)=?
            ORDER BY datetime(created_at) DESC, id DESC
            """,
            (uid.lower(),),
        ).fetchall()
        items = []
        unread = 0
        for row in rows:
            leido = bool(row.get("leido"))
            if not leido:
                unread += 1
            items.append(
                {
                    "id": row["id"],
                    "solicitud_id": row["solicitud_id"],
                    "mensaje": row["mensaje"],
                    "leido": leido,
                    "created_at": row["created_at"],
                }
            )
        pending_rows = con.execute(
            """
            SELECT id, centro, sector, justificacion, total_monto, created_at, status
              FROM solicitudes
             WHERE lower(aprobador_id)=? AND status=?
             ORDER BY datetime(created_at) DESC, id DESC
            """,
            (uid.lower(), STATUS_PENDING),
        ).fetchall()
        pendientes = [dict(r) for r in pending_rows]
    return {
        "ok": True,
        "unread": unread,
        "items": items,
        "pending": pendientes,
    }


@bp.post("/notificaciones/marcar")
def marcar_notificaciones():
    uid = _require_auth()
    if not uid:
        return {"ok": False, "error": {"code": "NOAUTH", "message": "No autenticado"}}, 401
    payload = request.get_json(silent=True) or {}
    ids = payload.get("ids") or []
    mark_all = bool(payload.get("mark_all"))
    cleaned_ids: list[int] = []
    for value in ids:
        try:
            cleaned_ids.append(int(value))
        except (TypeError, ValueError):
            continue
    with get_connection() as con:
        if mark_all or not cleaned_ids:
            con.execute(
                "UPDATE notificaciones SET leido=1 WHERE lower(destinatario_id)=?",
                (uid.lower(),),
            )
        else:
            placeholders = ",".join(["?"] * len(cleaned_ids))
            con.execute(
                f"UPDATE notificaciones SET leido=1 WHERE lower(destinatario_id)=? AND id IN ({placeholders})",
                (uid.lower(), *cleaned_ids),
            )
        con.commit()
        remaining = con.execute(
            "SELECT COUNT(*) AS c FROM notificaciones WHERE lower(destinatario_id)=? AND leido=0",
            (uid.lower(),),
        ).fetchone()["c"]
    return {"ok": True, "unread": remaining}

