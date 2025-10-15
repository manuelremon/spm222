from __future__ import annotations
import json
from typing import List, Dict
import requests
from flask import Blueprint, request
from ..config import Settings
from ..security import verify_access_token

bp = Blueprint("chatbot", __name__, url_prefix="/api")
_COOKIE_NAME = "spm_token"
_ALLOWED_ROLES = {"user", "assistant", "system"}
_SYSTEM_PROMPT = (
    "Actuás como especialista de SPM, enfocado en la aplicacion web y los flujos de "
    "solicitudes de materiales industriales para Oil & Gas. Guiá al usuario sobre el uso "
    "del sitio, procesos de catalogo y buenas practicas con materiales criticos. "
    "Responde siempre en español y mantente dentro del dominio Oil & Gas y la aplicacion."
)


def _require_user() -> str | None:
    token = request.cookies.get(_COOKIE_NAME)
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


def _sanitize_history(raw: List[Dict[str, str]]) -> List[Dict[str, str]]:
    safe_messages: List[Dict[str, str]] = []
    for item in raw[-10:]:
        role = str(item.get("role", "")).lower()
        content = str(item.get("content", "")).strip()
        if not content or role not in _ALLOWED_ROLES:
            continue
        safe_messages.append({"role": role, "content": content})
    has_system = any(msg["role"] == "system" for msg in safe_messages)
    if not has_system:
        safe_messages.insert(0, {"role": "system", "content": _SYSTEM_PROMPT})
    return safe_messages


@bp.post("/chatbot")
def invoke_chatbot():
    user_sub = _require_user()
    if not user_sub:
        return {"ok": False, "error": {"code": "NOAUTH", "message": "No autenticado"}}, 401

    payload = request.get_json(silent=True) or {}
    message = str(payload.get("message", "")).strip()
    history_raw = payload.get("history") or []

    if not message:
        return {"ok": False, "error": {"code": "EMPTY", "message": "Ingresa un mensaje"}}, 400

    if len(message) > 4000:
        return {"ok": False, "error": {"code": "TOO_LONG", "message": "El mensaje es demasiado largo"}}, 400

    history = _sanitize_history(history_raw)
    history.append({"role": "user", "content": message})

    target = Settings.OLLAMA_ENDPOINT.rstrip("/") + "/api/chat"
    body = {
        "model": Settings.OLLAMA_MODEL,
        "messages": history,
        "stream": False,
    }

    try:
        upstream = requests.post(target, json=body, timeout=(5, 120))
    except requests.RequestException:
        return {
            "ok": False,
            "error": {"code": "OLLAMA_UNREACHABLE", "message": "No se pudo conectar con Ollama"},
        }, 502

    if upstream.status_code >= 400:
        try:
            detail = upstream.json()
            message_error = detail.get("error") or detail.get("message") or "Error de Ollama"
        except Exception:
            message_error = "Error de Ollama"
        return {
            "ok": False,
            "error": {"code": "OLLAMA_ERROR", "message": str(message_error)},
        }, 502

    try:
        response_json = upstream.json()
    except json.JSONDecodeError:
        return {
            "ok": False,
            "error": {"code": "INVALID_RESP", "message": "Respuesta invalida de Ollama"},
        }, 502

    content = str(response_json.get("message", {}).get("content", "")).strip()
    if not content:
        content = "No obtuve una respuesta del modelo."

    return {
        "ok": True,
        "message": {
            "role": "assistant",
            "content": content,
        },
    }
