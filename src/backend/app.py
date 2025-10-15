from __future__ import annotations
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from flask import Flask, jsonify, request, g
from flask import current_app
from flask_cors import CORS
import logging
from logging.handlers import RotatingFileHandler
from backend.config import Settings
from backend.db import health_ok
from backend.routes.auth import bp as auth_bp
from backend.routes.materiales import bp as mat_bp
from backend.routes.solicitudes import bp as sol_bp
from backend.routes.notificaciones import bp as notif_bp
from backend.routes.admin import bp as admin_bp
from backend.routes.presupuestos import bp as presup_bp
from backend.routes.chatbot import bp as chatbot_bp
from backend.routes.catalogos import bp as catalogos_bp
from backend.routes.archivos import bp as archivos_bp
from backend.init_db import build_db

def _setup_logging(app: Flask) -> None:
    Settings.ensure_dirs()
    handler = RotatingFileHandler(Settings.LOG_PATH, maxBytes=5_000_000, backupCount=3, encoding="utf-8")
    handler.setLevel(logging.INFO)
    formatter = logging.Formatter('%(asctime)s %(levelname)s %(message)s')
    handler.setFormatter(formatter)
    app.logger.addHandler(handler)
    app.logger.setLevel(logging.INFO)

def create_app() -> Flask:
    # Serve the frontend from ../frontend as the app's static folder
    FRONTEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))
    app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="")
    app.config["ENV"] = Settings.ENV
    app.config["DEBUG"] = Settings.DEBUG
    app.config["JSON_SORT_KEYS"] = False
    app.config["JSONIFY_PRETTYPRINT_REGULAR"] = Settings.DEBUG
    app.config["MAX_CONTENT_LENGTH"] = Settings.MAX_CONTENT_LENGTH

    _setup_logging(app)
    try:
        build_db(force=False)
    except Exception:
        app.logger.exception("Failed to initialize database")

    # Enable CORS for /api/* when developing the frontend separately.
    # Set env SPM_CORS_ORIGINS to a comma-separated list, e.g. "http://localhost:8080,http://127.0.0.1:5173"
    if Settings.CORS_ORIGINS:
        CORS(app, resources={r"/api/*": {"origins": Settings.CORS_ORIGINS}}, supports_credentials=True)

    @app.before_request
    def _attach_request_id():
        g.reqid = request.headers.get("X-Request-Id") or request.environ.get("FLASK_REQUEST_ID")

    @app.errorhandler(400)
    @app.errorhandler(404)
    @app.errorhandler(405)
    @app.errorhandler(422)
    def client_error(err):
        code = getattr(err, "code", 400)
        return jsonify({"ok": False, "error": {"code": "HTTP_" + str(code), "message": str(err)}}), code

    @app.errorhandler(Exception)
    def server_error(err):
        current_app.logger.exception("Unhandled error")
        return jsonify({"ok": False, "error": {"code": "SERVER_ERROR", "message": "Ocurrió un error inesperado"}}), 500

    # Register API blueprints
    app.register_blueprint(auth_bp)
    app.register_blueprint(mat_bp)
    app.register_blueprint(sol_bp)
    app.register_blueprint(notif_bp)
    app.register_blueprint(admin_bp)
    app.register_blueprint(presup_bp)
    app.register_blueprint(chatbot_bp)
    app.register_blueprint(catalogos_bp)
    app.register_blueprint(archivos_bp)

    @app.get("/api/health")
    def health():
        return {"ok": True, "db": health_ok()}

    # Frontend entry points
    @app.get("/")
    def index():
        return app.send_static_file("index.html")

    # Handy route for the single JS file
    @app.get("/app.js")
    def app_js():
        return app.send_static_file("app.js")

    return app

if __name__ == "__main__":
    app = create_app()
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=Settings.DEBUG)
