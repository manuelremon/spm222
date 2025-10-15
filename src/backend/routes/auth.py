from __future__ import annotations
import json
from flask import Blueprint, request, jsonify, make_response
from ..db import get_connection
from ..schemas import (
    LoginRequest,
    RegisterRequest,
    UpdatePhoneRequest,
    AdditionalCentersRequest,
)
from ..security import verify_password, hash_password, create_access_token, verify_access_token

bp = Blueprint("auth", __name__, url_prefix="/api")
COOKIE_NAME = "spm_token"

def _cookie_args():
    return dict(httponly=True, samesite="Lax", secure=False)

@bp.post("/login")
def login():
    data = LoginRequest(**request.get_json(force=True))
    with get_connection() as con:
        # permitimos login por id_spm o por mail
        cur = con.execute(
            """
            SELECT id_spm, nombre, apellido, rol, contrasena, sector, centros, posicion,
                   mail, telefono, id_ypf, jefe, gerente1, gerente2
              FROM usuarios
             WHERE lower(id_spm)=lower(?) OR lower(mail)=lower(?)
            """,
            (data.id, data.id)
        )
        row = cur.fetchone()
        if not row or not verify_password(row["contrasena"], data.password):
            return jsonify({"ok": False, "error": {"code": "AUTH", "message": "Credenciales inválidas"}}), 401
        token = create_access_token(row["id_spm"])
        row_dict = dict(row)
        centros = []
        centros_raw = row_dict.get("centros")
        if isinstance(centros_raw, str) and centros_raw.strip():
            centros = [part.strip() for part in centros_raw.replace(";", ",").split(",") if part.strip()]
        resp = make_response({"ok": True, "usuario": {
            "id": row_dict.get("id_spm"),
            "nombre": row_dict.get("nombre"),
            "apellido": row_dict.get("apellido"),
            "rol": row_dict.get("rol"),
            "posicion": row_dict.get("posicion"),
            "sector": row_dict.get("sector"),
            "mail": row_dict.get("mail"),
            "telefono": row_dict.get("telefono"),
            "id_red": row_dict.get("id_ypf"),
            "jefe": row_dict.get("jefe"),
            "gerente1": row_dict.get("gerente1"),
            "gerente2": row_dict.get("gerente2"),
            "centros": centros,
        }})
        resp.set_cookie(COOKIE_NAME, token, **_cookie_args())
        return resp

@bp.post("/logout")
def logout():
    resp = make_response({"ok": True})
    resp.delete_cookie(COOKIE_NAME)
    return resp

@bp.post("/register")
def register():
    payload = RegisterRequest(**request.get_json(force=True))
    with get_connection() as con:
        try:
            mail = None
            if "@" in payload.id:
                mail = payload.id.lower()
            con.execute(
                "INSERT INTO usuarios (id_spm, nombre, apellido, rol, contrasena, mail) VALUES (?,?,?,?,?,?)",
                (payload.id, payload.nombre, payload.apellido, payload.rol, hash_password(payload.password), mail)
            )
            con.commit()
            return {"ok": True}, 201
        except Exception:
            con.rollback()
            return {"ok": False, "error": {"code":"DUP","message":"Usuario ya existe o datos inválidos"}}, 409

@bp.get("/me")
def me():
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return {"ok": False, "error": {"code": "NOAUTH", "message": "No autenticado"}}, 401
    try:
        data = verify_access_token(token)
    except Exception:
        return {"ok": False, "error": {"code": "BADTOKEN", "message": "Token inválido o expirado"}}, 401
    with get_connection() as con:
        cur = con.execute(
            """
            SELECT id_spm, nombre, apellido, rol, sector, centros, posicion,
                   mail, telefono, id_ypf, jefe, gerente1, gerente2
              FROM usuarios
             WHERE id_spm=?
            """,
            (data["sub"],),
        )
        row = cur.fetchone()
        if not row:
            return {"ok": False, "error": {"code": "NOUSER", "message": "Usuario no encontrado"}}, 404
        row_dict = dict(row)
        centros = []
        centros_raw = row_dict.get("centros")
        if isinstance(centros_raw, str) and centros_raw.strip():
            centros = [part.strip() for part in centros_raw.replace(";", ",").split(",") if part.strip()]
        payload = {
            "id": row_dict.get("id_spm"),
            "nombre": row_dict.get("nombre"),
            "apellido": row_dict.get("apellido"),
            "rol": row_dict.get("rol"),
            "posicion": row_dict.get("posicion"),
            "sector": row_dict.get("sector"),
            "mail": row_dict.get("mail"),
            "telefono": row_dict.get("telefono"),
            "id_red": row_dict.get("id_ypf"),
            "jefe": row_dict.get("jefe"),
            "gerente1": row_dict.get("gerente1"),
            "gerente2": row_dict.get("gerente2"),
            "centros": centros,
        }
        return {"ok": True, "usuario": payload}


def _require_user_id():
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None, ("NOAUTH", "No autenticado", 401)
    try:
        data = verify_access_token(token)
    except Exception:
        return None, ("BADTOKEN", "Token inválido o expirado", 401)
    return data.get("sub"), None


@bp.post("/me/telefono")
def update_phone():
    uid, error = _require_user_id()
    if error:
        code, msg, status = error
        return {"ok": False, "error": {"code": code, "message": msg}}, status
    payload = UpdatePhoneRequest(**request.get_json(force=True))
    with get_connection() as con:
        con.execute("UPDATE usuarios SET telefono=? WHERE id_spm=?", (payload.telefono, uid))
        con.commit()
    return {"ok": True, "telefono": payload.telefono}


@bp.post("/me/centros/solicitud")
def request_additional_centers():
    uid, error = _require_user_id()
    if error:
        code, msg, status = error
        return {"ok": False, "error": {"code": code, "message": msg}}, status
    payload = AdditionalCentersRequest(**request.get_json(force=True))
    content = {"centros": payload.centros, "motivo": payload.motivo}
    with get_connection() as con:
        con.execute(
            """
            INSERT INTO user_profile_requests (usuario_id, tipo, payload, estado)
            VALUES (?, ?, ?, 'pendiente')
            """,
            (uid, "centros", json.dumps(content)),
        )
        con.commit()
    return {"ok": True}
