from __future__ import annotations
import json
from flask import Blueprint, request, jsonify, make_response
from ..db import get_connection
from ..schemas import (
    LoginRequest,
    RegisterRequest,
    UpdatePhoneRequest,
    AdditionalCentersRequest,
    UpdateMailRequest,
)
from ..security import verify_password, hash_password, create_access_token, verify_access_token

bp = Blueprint("auth", __name__, url_prefix="/api")
COOKIE_NAME = "spm_token"

def _cookie_args():
    return dict(httponly=True, samesite="Lax", secure=False)

@bp.route("/login", methods=["POST", "OPTIONS"])
def login():
    if request.method == "OPTIONS":
        return "", 204
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

@bp.route("/logout", methods=["POST", "OPTIONS"])
def logout():
    if request.method == "OPTIONS":
        return "", 204
    resp = make_response({"ok": True})
    resp.delete_cookie(COOKIE_NAME)
    return resp

@bp.route("/register", methods=["POST", "OPTIONS"])
def register():
    if request.method == "OPTIONS":
        return "", 204
    payload = RegisterRequest(**request.get_json(force=True))
    with get_connection() as con:
        try:
            mail = None
            if "@" in payload.id:
                mail = payload.id.lower()
            con.execute(
                "INSERT INTO usuarios (id_spm, nombre, apellido, rol, contrasena, mail, estado_registro) VALUES (?,?,?,?,?,?,?)",
                (
                    payload.id,
                    payload.nombre,
                    payload.apellido,
                    payload.rol,
                    hash_password(payload.password),
                    mail,
                    "Pendiente",
                ),
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


@bp.route("/me/telefono", methods=["POST", "OPTIONS"])
def update_phone():
    if request.method == "OPTIONS":
        return "", 204
    uid, error = _require_user_id()
    if error:
        code, msg, status = error
        return {"ok": False, "error": {"code": code, "message": msg}}, status
    payload = UpdatePhoneRequest(**request.get_json(force=True))
    with get_connection() as con:
        con.execute("UPDATE usuarios SET telefono=? WHERE id_spm=?", (payload.telefono, uid))
        con.commit()
    return {"ok": True, "telefono": payload.telefono}


@bp.route("/me/mail", methods=["POST", "OPTIONS"])
def update_mail():
    if request.method == "OPTIONS":
        return "", 204
    uid, error = _require_user_id()
    if error:
        code, msg, status = error
        return {"ok": False, "error": {"code": code, "message": msg}}, status
    payload = UpdateMailRequest(**request.get_json(force=True))
    mail_value = payload.mail.strip().lower()
    with get_connection() as con:
        con.execute("UPDATE usuarios SET mail=? WHERE id_spm=?", (mail_value, uid))
        con.commit()
    return {"ok": True, "mail": mail_value}


@bp.route("/me/centros/solicitud", methods=["POST", "OPTIONS"])
def request_additional_centers():
    if request.method == "OPTIONS":
        return "", 204
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
        display_row = con.execute(
            "SELECT nombre, apellido FROM usuarios WHERE id_spm=?",
            (uid,),
        ).fetchone()
        display_name = None
        if display_row:
            nombre = (display_row["nombre"] or "").strip()
            apellido = (display_row["apellido"] or "").strip()
            display_name = " ".join(part for part in (nombre, apellido) if part)
        requester = display_name or uid
        mensaje = f"{requester} solicito acceso a los centros {payload.centros}"
        if payload.motivo:
            mensaje += f" (Motivo: {payload.motivo})"
        if len(mensaje) > 480:
            mensaje = mensaje[:477] + "..."
        admin_rows = con.execute(
            "SELECT id_spm FROM usuarios WHERE lower(COALESCE(rol,'')) LIKE ?",
            ("%admin%",),
        ).fetchall()
        notified = set()
        uid_lower = (uid or "").strip().lower()
        for row in admin_rows:
            dest = (row["id_spm"] or "").strip().lower()
            if not dest or dest == uid_lower or dest in notified:
                continue
            con.execute(
                "INSERT INTO notificaciones (destinatario_id, solicitud_id, mensaje, leido) VALUES (?,?,?,0)",
                (dest, None, mensaje),
            )
            notified.add(dest)
        con.commit()
    return {"ok": True}
