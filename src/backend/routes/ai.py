from __future__ import annotations

from flask import Blueprint, jsonify, request

from ..ai_service import AIService
from ..security import verify_access_token

bp = Blueprint("ai", __name__, url_prefix="/api/ai")

ai_service = AIService()

@bp.route("/suggest/solicitud/<int:sol_id>", methods=["GET"])
@verify_access_token(roles=["planner", "admin"])
def get_suggestions(sol_id: int, user_id: str):
    """Obtiene sugerencias IA para una solicitud."""
    if not AIService().get_suggestions_for_solicitud(sol_id):
        return jsonify({"error": "Solicitud no encontrada"}), 404

    suggestions = ai_service.get_suggestions_for_solicitud(sol_id)
    return jsonify({"suggestions": suggestions})

@bp.route("/suggest/accept", methods=["POST"])
@verify_access_token(roles=["planner", "admin"])
def accept_suggestion(user_id: str):
    """Acepta una sugerencia IA."""
    data = request.get_json()
    if not data:
        return jsonify({"ok": False, "error": "Datos requeridos"}), 400

    sol_id = data.get("solicitud_id")
    item_index = data.get("item_index")
    sug_type = data.get("type")
    payload = data.get("payload", {})

    if not all([sol_id, item_index is not None, sug_type]):
        return jsonify({"ok": False, "error": "Campos requeridos: solicitud_id, item_index, type"}), 400

    success = ai_service.apply_suggestion(sol_id, item_index, sug_type, payload, user_id)
    if success:
        return jsonify({"ok": True})
    else:
        return jsonify({"ok": False, "error": "Error aplicando sugerencia"}), 500

@bp.route("/suggest/reject", methods=["POST"])
@verify_access_token(roles=["planner", "admin"])
def reject_suggestion(user_id: str):
    """Rechaza una sugerencia IA."""
    data = request.get_json()
    if not data:
        return jsonify({"ok": False, "error": "Datos requeridos"}), 400

    sol_id = data.get("solicitud_id")
    item_index = data.get("item_index")
    sug_type = data.get("type")

    if not all([sol_id, item_index is not None, sug_type]):
        return jsonify({"ok": False, "error": "Campos requeridos: solicitud_id, item_index, type"}), 400

    success = ai_service.reject_suggestion(sol_id, item_index, sug_type, user_id)
    if success:
        return jsonify({"ok": True})
    else:
        return jsonify({"ok": False, "error": "Error rechazando sugerencia"}), 500