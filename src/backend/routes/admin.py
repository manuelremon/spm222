from __future__ import annotations
import sqlite3
from flask import Blueprint, request
from typing import Any, Dict, List, Optional
from ..db import get_connection
from ..security import verify_access_token, hash_password
from ..routes.solicitudes import STATUS_PENDING, STATUS_CANCEL_PENDING, STATUS_CANCEL_REJECTED

bp = Blueprint("admin", __name__, url_prefix="/api/admin")
COOKIE_NAME = "spm_token"

CATALOG_RESOURCES: Dict[str, Dict[str, Any]] = {
    "centros": {
        "table": "catalog_centros",
        "fields": ("codigo", "nombre", "descripcion", "notas", "activo"),
        "required": ("codigo",),
        "defaults": {"activo": 1},
        "bools": ("activo",),
        "order_by": "codigo COLLATE NOCASE",
    },
    "almacenes": {
        "table": "catalog_almacenes",
        "fields": ("codigo", "nombre", "centro_codigo", "descripcion", "activo"),
        "required": ("codigo",),
        "defaults": {"activo": 1},
        "bools": ("activo",),
        "order_by": "codigo COLLATE NOCASE",
    },
    "roles": {
        "table": "catalog_roles",
        "fields": ("nombre", "descripcion", "activo"),
        "required": ("nombre",),
        "defaults": {"activo": 1},
        "bools": ("activo",),
        "order_by": "nombre COLLATE NOCASE",
    },
    "puestos": {
        "table": "catalog_puestos",
        "fields": ("nombre", "descripcion", "activo"),
        "required": ("nombre",),
        "defaults": {"activo": 1},
        "bools": ("activo",),
        "order_by": "nombre COLLATE NOCASE",
    },
    "sectores": {
        "table": "catalog_sectores",
        "fields": ("nombre", "descripcion", "activo"),
        "required": ("nombre",),
        "defaults": {"activo": 1},
        "bools": ("activo",),
        "order_by": "nombre COLLATE NOCASE",
    },
}


def _extract_uid() -> str | None:
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


def _require_admin(con) -> tuple[Dict[str, Any] | None, Dict[str, Any] | None]:
    uid = _extract_uid()
    if not uid:
        return None, {"status": 401, "body": {"ok": False, "error": {"code": "NOAUTH", "message": "No autenticado"}}}
    row = con.execute(
        "SELECT id_spm, nombre, apellido, rol FROM usuarios WHERE lower(id_spm)=?",
        (uid.lower(),),
    ).fetchone()
    if not row:
        return None, {"status": 401, "body": {"ok": False, "error": {"code": "NOUSER", "message": "Usuario no encontrado"}}}
    role = (row.get("rol") or "").lower()
    if "admin" not in role:
        return None, {"status": 403, "body": {"ok": False, "error": {"code": "FORBIDDEN", "message": "Acceso restringido a administradores"}}}
    return row, None


def _split_centros(value: str | None) -> List[str]:
    if not value:
        return []
    return [part.strip() for part in value.replace(";", ",").replace("\n", ",").split(",") if part.strip()]


def _normalize_centros_payload(value) -> str | None:
    if value is None:
        return None
    result: List[str] = []
    if isinstance(value, (list, tuple, set)):
        for item in value:
            if item is None:
                continue
            text = str(item).strip()
            if text:
                result.append(text)
    else:
        result.extend(_split_centros(str(value)))
    return ",".join(result) if result else None


def _row_to_user(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": row["id_spm"],
        "nombre": row["nombre"],
        "apellido": row.get("apellido"),
        "rol": row.get("rol"),
        "mail": row.get("mail"),
        "sector": row.get("sector"),
        "posicion": row.get("posicion"),
        "centros": _split_centros(row.get("centros")),
        "jefe": row.get("jefe"),
        "gerente1": row.get("gerente1"),
        "gerente2": row.get("gerente2"),
        "aprobadores": [
            value
            for value in (
                row.get("jefe"),
                row.get("gerente1"),
                row.get("gerente2"),
            )
            if value
        ],
    }


def _catalog_meta(resource: str) -> Optional[Dict[str, Any]]:
    return CATALOG_RESOURCES.get(resource)


def _coerce_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        normalized = value.strip().lower()
        return normalized in {"1", "true", "si", "sí", "on", "yes", "activo"}
    return False


def _clean_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _normalize_catalog_payload(meta: Dict[str, Any], payload: Dict[str, Any], *, is_update: bool) -> Dict[str, Any]:
    cleaned: Dict[str, Any] = {}
    fields = meta.get("fields", ())
    defaults = meta.get("defaults", {})
    for field in fields:
        if field == "activo":
            if field in payload:
                cleaned[field] = 1 if _coerce_bool(payload[field]) else 0
            elif not is_update:
                cleaned[field] = defaults.get(field, 1)
            continue
        if field not in payload and is_update:
            continue
        value = payload.get(field, defaults.get(field))
        cleaned[field] = _clean_text(value)
    if not is_update:
        for required_field in meta.get("required", ()):  # type: ignore[arg-type]
            if not cleaned.get(required_field):
                raise ValueError(f"El campo '{required_field}' es obligatorio")
        for field, default_value in defaults.items():
            cleaned.setdefault(field, default_value)
    return cleaned


def _row_to_catalog_item(meta: Dict[str, Any], row: Dict[str, Any]) -> Dict[str, Any]:
    if not row:
        return {}
    data = dict(row)
    for boolean_field in meta.get("bools", ()):  # type: ignore[arg-type]
        if boolean_field in data:
            data[boolean_field] = bool(data[boolean_field])
    return data


@bp.get("/summary")
def resumen():
    with get_connection() as con:
        _, error = _require_admin(con)
        if error:
            return error["body"], error["status"]
        stats = con.execute(
            """
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN status IN (?, ?) THEN 1 ELSE 0 END) AS pendientes,
                SUM(CASE WHEN status='finalizada' THEN 1 ELSE 0 END) AS finalizadas,
                SUM(CASE WHEN status='cancelada' THEN 1 ELSE 0 END) AS canceladas,
                SUM(CASE WHEN status='draft' THEN 1 ELSE 0 END) AS borradores
            FROM solicitudes
            """,
            (STATUS_PENDING, STATUS_CANCEL_PENDING),
        ).fetchone()
        roles = con.execute(
            "SELECT rol, COUNT(*) AS cantidad FROM usuarios GROUP BY rol ORDER BY cantidad DESC"
        ).fetchall()
        top_centros = con.execute(
            """
            SELECT centro, COUNT(*) AS total, SUM(total_monto) AS monto
              FROM solicitudes
             WHERE centro IS NOT NULL AND trim(centro) <> ''
          GROUP BY centro
          ORDER BY total DESC
          LIMIT 6
            """
        ).fetchall()
        recientes = con.execute(
            """
            SELECT s.id, s.status, s.total_monto, s.created_at, s.centro,
                   u.nombre || ' ' || u.apellido AS solicitante
              FROM solicitudes s
              LEFT JOIN usuarios u ON lower(u.id_spm)=lower(s.id_usuario)
          ORDER BY datetime(s.created_at) DESC, s.id DESC
             LIMIT 6
            """
        ).fetchall()
        materiales = con.execute("SELECT COUNT(*) AS total FROM materiales").fetchone()
        usuarios = con.execute("SELECT COUNT(*) AS total FROM usuarios").fetchone()
    return {
        "ok": True,
        "totals": {
            "solicitudes": stats["total"] if stats else 0,
            "pendientes": stats["pendientes"] if stats else 0,
            "finalizadas": stats["finalizadas"] if stats else 0,
            "canceladas": stats["canceladas"] if stats else 0,
            "borradores": stats["borradores"] if stats else 0,
            "usuarios": usuarios["total"] if usuarios else 0,
            "materiales": materiales["total"] if materiales else 0,
        },
        "roles": roles,
        "top_centros": top_centros,
        "recientes": recientes,
    }


def _safe_limit(raw_value: str | None, default: int = 100, maximum: int = 200) -> int:
    try:
        value = int(raw_value) if raw_value is not None else default
    except (TypeError, ValueError):
        value = default
    if value < 1:
        return 1
    if value > maximum:
        return maximum
    return value


@bp.get("/usuarios")
def administrar_usuarios():
    q = (request.args.get("q") or "").strip().lower()
    limit = _safe_limit(request.args.get("limit"), 100, 200)
    with get_connection() as con:
        _, error = _require_admin(con)
        if error:
            return error["body"], error["status"]
        filters: list[str] = []
        params: list[Any] = []
        if q:
            like = f"%{q}%"
            filters.append(
                "(" "lower(id_spm) LIKE ? OR lower(nombre) LIKE ? OR lower(apellido) LIKE ? "
                "OR lower(COALESCE(rol,'')) LIKE ? OR lower(COALESCE(centros,'')) LIKE ?" ")"
            )
            params.extend([like, like, like, like, like])
        where = " AND ".join(filters) if filters else "1=1"
        total = con.execute(
            f"SELECT COUNT(*) AS total FROM usuarios WHERE {where}",
            params,
        ).fetchone()["total"]
        rows = con.execute(
            f"""
                SELECT id_spm, nombre, apellido, rol, mail, sector, posicion, centros, jefe, gerente1, gerente2
              FROM usuarios
             WHERE {where}
          ORDER BY nombre COLLATE NOCASE, apellido COLLATE NOCASE
             LIMIT ?
            """,
            (*params, limit),
        ).fetchall()
    items = [_row_to_user(row) for row in rows]
    return {"ok": True, "total": total, "items": items}


@bp.put("/usuarios/<user_id>")
def actualizar_usuario(user_id: str):
    payload = request.get_json(force=True, silent=False) or {}
    with get_connection() as con:
        _, error = _require_admin(con)
        if error:
            return error["body"], error["status"]
        existing = con.execute(
            """
                        SELECT id_spm, nombre, apellido, rol, mail, sector, posicion, centros, jefe, gerente1, gerente2
              FROM usuarios
             WHERE lower(id_spm)=?
            """,
            (user_id.lower(),),
        ).fetchone()
        if not existing:
            return {"ok": False, "error": {"code": "NOTFOUND", "message": "Usuario no encontrado"}}, 404

        updates: List[str] = []
        params: List[Any] = []

        def _set_column(column: str, value: Any) -> None:
            updates.append(f"{column}=?")
            params.append(value)

        simple_fields = ("nombre", "apellido", "rol", "sector", "posicion")
        for field in simple_fields:
            if field in payload:
                value = (payload.get(field) or "").strip() or None
                _set_column(field, value)

        if "mail" in payload:
            mail = (payload.get("mail") or "").strip().lower() or None
            _set_column("mail", mail)

        if "centros" in payload:
            centros_value = _normalize_centros_payload(payload.get("centros"))
            _set_column("centros", centros_value)

        for approver_field in ("jefe", "gerente1", "gerente2"):
            if approver_field in payload:
                identifier = (payload.get(approver_field) or "").strip().lower() or None
                _set_column(approver_field, identifier)

        if "password" in payload:
            password = (payload.get("password") or "").strip()
            if password:
                _set_column("contrasena", hash_password(password))

        if updates:
            params.append(existing["id_spm"])
            con.execute(
                f"UPDATE usuarios SET {', '.join(updates)} WHERE id_spm=?",
                params,
            )
            con.commit()
        refreshed = con.execute(
            """
                        SELECT id_spm, nombre, apellido, rol, mail, sector, posicion, centros, jefe, gerente1, gerente2
              FROM usuarios
             WHERE id_spm=?
            """,
            (existing["id_spm"],),
        ).fetchone()
    return {"ok": True, "usuario": _row_to_user(refreshed)}


@bp.get("/solicitudes")
def administrar_solicitudes():
    status_filter = (request.args.get("status") or "").strip().lower()
    q = (request.args.get("q") or "").strip().lower()
    limit = _safe_limit(request.args.get("limit"), 100, 200)
    filters: list[str] = []
    params: list[Any] = []
    if status_filter and status_filter != "todos":
        filters.append("lower(status)=?")
        params.append(status_filter)
    if q:
        if q.isdigit():
            filters.append("id=?")
            params.append(int(q))
        else:
            like = f"%{q}%"
            filters.append("(lower(id_usuario) LIKE ? OR lower(centro) LIKE ? OR lower(sector) LIKE ?)")
            params.extend([like, like, like])
    where = " AND ".join(filters) if filters else "1=1"
    with get_connection() as con:
        _, error = _require_admin(con)
        if error:
            return error["body"], error["status"]
        total = con.execute(
            f"SELECT COUNT(*) AS total FROM solicitudes WHERE {where}",
            params,
        ).fetchone()["total"]
        rows = con.execute(
            f"""
            SELECT s.id, s.id_usuario, s.status, s.total_monto, s.centro, s.sector,
                   s.created_at, s.updated_at, s.aprobador_id,
                   u.nombre || ' ' || u.apellido AS solicitante,
                   a.nombre || ' ' || a.apellido AS aprobador
              FROM solicitudes s
              LEFT JOIN usuarios u ON lower(u.id_spm)=lower(s.id_usuario)
              LEFT JOIN usuarios a ON lower(a.id_spm)=lower(s.aprobador_id)
             WHERE {where}
          ORDER BY datetime(s.created_at) DESC, s.id DESC
             LIMIT ?
            """,
            (*params, limit),
        ).fetchall()
    return {
        "ok": True,
        "total": total,
        "items": rows,
    }


@bp.get("/materiales")
def administrar_materiales():
    q = (request.args.get("q") or "").strip().lower()
    limit = _safe_limit(request.args.get("limit"), 100, 200)
    filters: list[str] = []
    params: list[Any] = []
    if q:
        like = f"%{q}%"
        filters.append("(lower(codigo) LIKE ? OR lower(descripcion) LIKE ?)")
        params.extend([like, like])
    where = " AND ".join(filters) if filters else "1=1"
    with get_connection() as con:
        _, error = _require_admin(con)
        if error:
            return error["body"], error["status"]
        total = con.execute(
            f"SELECT COUNT(*) AS total FROM materiales WHERE {where}",
            params,
        ).fetchone()["total"]
        rows = con.execute(
            f"""
            SELECT codigo, descripcion, descripcion_larga, unidad, precio_usd, centro, sector
              FROM materiales
             WHERE {where}
          ORDER BY descripcion COLLATE NOCASE
             LIMIT ?
            """,
            (*params, limit),
        ).fetchall()
    return {"ok": True, "total": total, "items": rows}


@bp.put("/materiales/<codigo>")
def actualizar_material(codigo: str):
    payload = request.get_json(force=True, silent=False) or {}
    descripcion = (payload.get("descripcion") or "").strip()
    descripcion_larga = payload.get("descripcion_larga") or None
    unidad = (payload.get("unidad") or "").strip() or None
    precio = payload.get("precio_usd")
    try:
        precio_value = float(precio)
    except (TypeError, ValueError):
        precio_value = None
    if not descripcion:
        return {"ok": False, "error": {"code": "INVALID", "message": "La descripción es obligatoria"}}, 400
    if precio_value is None or precio_value < 0:
        return {"ok": False, "error": {"code": "INVALID", "message": "El precio debe ser un número válido"}}, 400
    with get_connection() as con:
        _, error = _require_admin(con)
        if error:
            return error["body"], error["status"]
        existing = con.execute(
            "SELECT codigo FROM materiales WHERE codigo=?",
            (codigo,),
        ).fetchone()
        if not existing:
            return {"ok": False, "error": {"code": "NOTFOUND", "message": "Material no encontrado"}}, 404
        con.execute(
            """
            UPDATE materiales
               SET descripcion=?,
                   descripcion_larga=?,
                   unidad=?,
                   precio_usd=?
             WHERE codigo=?
            """,
            (descripcion, descripcion_larga, unidad, precio_value, codigo),
        )
        con.commit()
        row = con.execute(
            "SELECT codigo, descripcion, descripcion_larga, unidad, precio_usd, centro, sector FROM materiales WHERE codigo=?",
            (codigo,),
        ).fetchone()
    return {"ok": True, "material": row}


@bp.get("/centros")
def administrar_centros():
    with get_connection() as con:
        _, error = _require_admin(con)
        if error:
            return error["body"], error["status"]
        by_centro = con.execute(
            """
            SELECT centro, COUNT(*) AS total, SUM(total_monto) AS monto
              FROM solicitudes
             WHERE centro IS NOT NULL AND centro <> ''
          GROUP BY centro
          ORDER BY centro
            """
        ).fetchall()
        presupuestos = con.execute(
            """
            SELECT centro, sector, monto_usd, saldo_usd
              FROM presupuestos
          ORDER BY centro, sector
            """
        ).fetchall()
    return {"ok": True, "solicitudes": by_centro, "presupuestos": presupuestos}


@bp.get("/config")
def obtener_configuracion_general():
    with get_connection() as con:
        _, error = _require_admin(con)
        if error:
            return error["body"], error["status"]
        data: Dict[str, Any] = {}
        for resource, meta in CATALOG_RESOURCES.items():
            table = meta["table"]
            order_by = meta.get("order_by") or "id"
            rows = con.execute(f"SELECT * FROM {table} ORDER BY {order_by}").fetchall()
            data[resource] = [_row_to_catalog_item(meta, row) for row in rows]
    return {"ok": True, "data": data}


@bp.get("/config/<resource>")
def obtener_configuracion_recurso(resource: str):
    meta = _catalog_meta(resource)
    if not meta:
        return {"ok": False, "error": {"code": "UNKNOWN", "message": "Recurso desconocido"}}, 404
    with get_connection() as con:
        _, error = _require_admin(con)
        if error:
            return error["body"], error["status"]
        table = meta["table"]
        order_by = meta.get("order_by") or "id"
        rows = con.execute(f"SELECT * FROM {table} ORDER BY {order_by}").fetchall()
        items = [_row_to_catalog_item(meta, row) for row in rows]
    return {"ok": True, "items": items}


@bp.post("/config/<resource>")
def crear_configuracion(resource: str):
    meta = _catalog_meta(resource)
    if not meta:
        return {"ok": False, "error": {"code": "UNKNOWN", "message": "Recurso desconocido"}}, 404
    payload = request.get_json(force=True, silent=False) or {}
    try:
        normalized = _normalize_catalog_payload(meta, payload, is_update=False)
    except ValueError as err:
        return {"ok": False, "error": {"code": "INVALID", "message": str(err)}}, 400
    with get_connection() as con:
        _, error = _require_admin(con)
        if error:
            return error["body"], error["status"]
        columns = list(normalized.keys())
        values = [normalized[col] for col in columns]
        placeholders = ",".join(["?"] * len(columns))
        table = meta["table"]
        try:
            cur = con.execute(
                f"INSERT INTO {table} ({','.join(columns)}) VALUES ({placeholders})",
                values,
            )
            con.commit()
        except sqlite3.IntegrityError:
            return {
                "ok": False,
                "error": {"code": "DUPLICATED", "message": "Ya existe un registro con los mismos datos"},
            }, 409
        row = con.execute(f"SELECT * FROM {table} WHERE id=?", (cur.lastrowid,)).fetchone()
    return {"ok": True, "item": _row_to_catalog_item(meta, row)}


@bp.put("/config/<resource>/<int:item_id>")
def actualizar_configuracion(resource: str, item_id: int):
    meta = _catalog_meta(resource)
    if not meta:
        return {"ok": False, "error": {"code": "UNKNOWN", "message": "Recurso desconocido"}}, 404
    payload = request.get_json(force=True, silent=False) or {}
    cleaned = _normalize_catalog_payload(meta, payload, is_update=True)
    if not cleaned:
        return {"ok": False, "error": {"code": "INVALID", "message": "No hay cambios para aplicar"}}, 400
    with get_connection() as con:
        _, error = _require_admin(con)
        if error:
            return error["body"], error["status"]
        table = meta["table"]
        existing = con.execute(f"SELECT id FROM {table} WHERE id=?", (item_id,)).fetchone()
        if not existing:
            return {"ok": False, "error": {"code": "NOTFOUND", "message": "Registro no encontrado"}}, 404
        updates = []
        params: List[Any] = []
        for column, value in cleaned.items():
            updates.append(f"{column}=?")
            params.append(value)
        updates.append("updated_at=CURRENT_TIMESTAMP")
        params.append(item_id)
        try:
            con.execute(
                f"UPDATE {table} SET {', '.join(updates)} WHERE id=?",
                params,
            )
            con.commit()
        except sqlite3.IntegrityError:
            return {
                "ok": False,
                "error": {"code": "DUPLICATED", "message": "Los valores generan un duplicado"},
            }, 409
        row = con.execute(f"SELECT * FROM {table} WHERE id=?", (item_id,)).fetchone()
    return {"ok": True, "item": _row_to_catalog_item(meta, row)}


@bp.delete("/config/<resource>/<int:item_id>")
def eliminar_configuracion(resource: str, item_id: int):
    meta = _catalog_meta(resource)
    if not meta:
        return {"ok": False, "error": {"code": "UNKNOWN", "message": "Recurso desconocido"}}, 404
    with get_connection() as con:
        _, error = _require_admin(con)
        if error:
            return error["body"], error["status"]
        table = meta["table"]
        cursor = con.execute(f"DELETE FROM {table} WHERE id=?", (item_id,))
        if cursor.rowcount == 0:
            return {"ok": False, "error": {"code": "NOTFOUND", "message": "Registro no encontrado"}}, 404
        con.commit()
    return {"ok": True}


@bp.get("/almacenes")
def administrar_almacenes():
    with get_connection() as con:
        _, error = _require_admin(con)
        if error:
            return error["body"], error["status"]
        rows = con.execute(
            """
            SELECT COALESCE(almacen_virtual, '') AS almacen, COUNT(*) AS total, SUM(total_monto) AS monto
              FROM solicitudes
          GROUP BY COALESCE(almacen_virtual, '')
          ORDER BY total DESC
            """
        ).fetchall()
    return {"ok": True, "items": rows}
