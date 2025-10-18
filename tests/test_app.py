import pytest
from src.backend.app import create_app

def test_create_app():
    app = create_app()
    assert app is not None
    assert app.config['ENV'] == 'production'  # Según Settings default

def test_app_runs():
    app = create_app()
    with app.test_client() as client:
        response = client.get('/')  # Ruta raíz sirve frontend
        assert response.status_code == 200