from __future__ import annotations

import os
import uuid
from datetime import datetime
from typing import Any
from werkzeug.utils import secure_filename
from flask import Blueprint, jsonify, request, send_file

from ..db import get_connection
from ..config import Settings
from ..security import verify_access_token

bp = Blueprint("archivos", __name__, url_prefix="/api")

COOKIE_NAME = "spm_token"


def _get_auth_token() -> str | None:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        header = request.headers.get("Authorization", "")
        if header.startswith("Bearer "):
            token = header.split(" ", 1)[1].strip()
    return token or None


def _require_auth() -> str | None:
    token = _get_auth_token()
    if not token:
        return None
    try:
        payload = verify_access_token(token)
    except Exception:
        return None
    sub = payload.get("sub")
    return str(sub).strip() if sub else None


def _json_error(code: str, message: str, status: int = 400):
    return jsonify({"ok": False, "error": {"code": code, "message": message}}), status


def _allowed_file(filename: str) -> bool:
    """Verifica si el archivo tiene una extensión permitida."""
    if not filename or '.' not in filename:
        return False
    ext = filename.rsplit('.', 1)[1].lower()
    return ext in Settings.ALLOWED_EXTENSIONS


def _utcnow_iso() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


@bp.route("/archivos/upload/<int:solicitud_id>", methods=["POST"])
def upload_archivo(solicitud_id: int):
    """Subir un archivo adjunto a una solicitud."""
    user_id = _require_auth()
    if not user_id:
        return _json_error("auth_required", "Autenticación requerida", 401)

    if 'file' not in request.files:
        return _json_error("no_file", "No se proporcionó ningún archivo")

    file = request.files['file']
    if file.filename == '':
        return _json_error("no_file", "No se seleccionó ningún archivo")

    if not _allowed_file(file.filename):
        return _json_error("invalid_file", f"Tipo de archivo no permitido. Extensiones permitidas: {', '.join(Settings.ALLOWED_EXTENSIONS)}")

    try:
        with get_connection() as con:
            # Verificar que la solicitud existe y pertenece al usuario
            solicitud = con.execute(
                "SELECT id, id_usuario FROM solicitudes WHERE id = ?",
                (solicitud_id,)
            ).fetchone()
            
            if not solicitud:
                return _json_error("not_found", "Solicitud no encontrada", 404)
            
            if solicitud['id_usuario'].lower() != user_id.lower():
                return _json_error("forbidden", "No tienes permisos para adjuntar archivos a esta solicitud", 403)

            # Generar nombre único para el archivo
            original_filename = secure_filename(file.filename)
            file_extension = original_filename.rsplit('.', 1)[1].lower() if '.' in original_filename else ''
            unique_filename = f"{uuid.uuid4().hex}.{file_extension}" if file_extension else uuid.uuid4().hex
            
            # Guardar archivo
            os.makedirs(Settings.UPLOADS_DIR, exist_ok=True)
            file_path = os.path.join(Settings.UPLOADS_DIR, unique_filename)
            file.save(file_path)
            
            # Obtener tamaño del archivo
            file_size = os.path.getsize(file_path)

            created_at = _utcnow_iso()
            
            # Guardar en base de datos
            cursor = con.execute(
                """
                INSERT INTO archivos_adjuntos 
                (solicitud_id, nombre_archivo, nombre_original, tipo_mime, tamano_bytes, ruta_archivo, usuario_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    solicitud_id,
                    unique_filename,
                    original_filename,
                    file.content_type or 'application/octet-stream',
                    file_size,
                    file_path,
                    user_id,
                    created_at,
                )
            )
            
            archivo_id = cursor.lastrowid
            con.commit()
            
            return jsonify({
                "ok": True,
                "archivo": {
                    "id": archivo_id,
                    "nombre_original": original_filename,
                    "tamano_bytes": file_size,
                    "tipo_mime": file.content_type,
                    "created_at": created_at,
                }
            })
            
    except Exception as e:
        # Si hay error, eliminar el archivo físico si fue creado
        try:
            if 'file_path' in locals() and os.path.exists(file_path):
                os.unlink(file_path)
        except:
            pass
        return _json_error("upload_error", f"Error al subir archivo: {str(e)}", 500)


@bp.route("/archivos/solicitud/<int:solicitud_id>", methods=["GET"])
def listar_archivos(solicitud_id: int):
    """Listar archivos adjuntos de una solicitud."""
    user_id = _require_auth()
    if not user_id:
        return _json_error("auth_required", "Autenticación requerida", 401)

    try:
        with get_connection() as con:
            # Verificar que la solicitud existe y el usuario tiene acceso
            solicitud = con.execute(
                "SELECT id, id_usuario FROM solicitudes WHERE id = ?",
                (solicitud_id,)
            ).fetchone()
            
            if not solicitud:
                return _json_error("not_found", "Solicitud no encontrada", 404)
            
            # Solo el dueño de la solicitud puede ver los archivos
            if solicitud['id_usuario'].lower() != user_id.lower():
                return _json_error("forbidden", "No tienes permisos para ver los archivos de esta solicitud", 403)

            # Obtener archivos
            archivos = con.execute(
                """
                SELECT id, nombre_original, tipo_mime, tamano_bytes, created_at
                FROM archivos_adjuntos 
                WHERE solicitud_id = ?
                ORDER BY created_at DESC
                """,
                (solicitud_id,)
            ).fetchall()
            
            return jsonify({
                "ok": True,
                "archivos": [dict(archivo) for archivo in archivos]
            })
            
    except Exception as e:
        return _json_error("list_error", f"Error al listar archivos: {str(e)}", 500)


@bp.route("/archivos/download/<int:archivo_id>", methods=["GET"])
def descargar_archivo(archivo_id: int):
    """Descargar un archivo adjunto."""
    user_id = _require_auth()
    if not user_id:
        return _json_error("auth_required", "Autenticación requerida", 401)

    try:
        with get_connection() as con:
            # Obtener información del archivo y verificar permisos
            archivo = con.execute(
                """
                SELECT a.*, s.id_usuario as solicitud_usuario
                FROM archivos_adjuntos a
                JOIN solicitudes s ON a.solicitud_id = s.id
                WHERE a.id = ?
                """,
                (archivo_id,)
            ).fetchone()
            
            if not archivo:
                return _json_error("not_found", "Archivo no encontrado", 404)
            
            # Solo el dueño de la solicitud puede descargar archivos
            if archivo['solicitud_usuario'].lower() != user_id.lower():
                return _json_error("forbidden", "No tienes permisos para descargar este archivo", 403)
            
            # Verificar que el archivo físico existe
            if not os.path.exists(archivo['ruta_archivo']):
                return _json_error("file_not_found", "Archivo físico no encontrado", 404)
            
            return send_file(
                archivo['ruta_archivo'],
                as_attachment=True,
                download_name=archivo['nombre_original'],
                mimetype=archivo['tipo_mime']
            )
            
    except Exception as e:
        return _json_error("download_error", f"Error al descargar archivo: {str(e)}", 500)


@bp.route("/archivos/delete/<int:archivo_id>", methods=["DELETE"])
def eliminar_archivo(archivo_id: int):
    """Eliminar un archivo adjunto."""
    user_id = _require_auth()
    if not user_id:
        return _json_error("auth_required", "Autenticación requerida", 401)

    try:
        with get_connection() as con:
            # Obtener información del archivo y verificar permisos
            archivo = con.execute(
                """
                SELECT a.*, s.id_usuario as solicitud_usuario
                FROM archivos_adjuntos a
                JOIN solicitudes s ON a.solicitud_id = s.id
                WHERE a.id = ?
                """,
                (archivo_id,)
            ).fetchone()
            
            if not archivo:
                return _json_error("not_found", "Archivo no encontrado", 404)
            
            # Solo el dueño de la solicitud puede eliminar archivos
            if archivo['solicitud_usuario'].lower() != user_id.lower():
                return _json_error("forbidden", "No tienes permisos para eliminar este archivo", 403)
            
            # Eliminar registro de la base de datos
            con.execute("DELETE FROM archivos_adjuntos WHERE id = ?", (archivo_id,))
            con.commit()
            
            # Eliminar archivo físico
            try:
                if os.path.exists(archivo['ruta_archivo']):
                    os.unlink(archivo['ruta_archivo'])
            except Exception:
                pass  # No fallar si no se puede eliminar el archivo físico
            
            return jsonify({"ok": True, "message": "Archivo eliminado correctamente"})
            
    except Exception as e:
        return _json_error("delete_error", f"Error al eliminar archivo: {str(e)}", 500)