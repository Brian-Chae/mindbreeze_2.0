"""문서 노출만 검증하며 lifespan·DB 연결은 실행하지 않는다."""
import importlib
import pytest
from fastapi.testclient import TestClient

@pytest.mark.parametrize('environment,expected', [('production', 404), ('development', 200)])
def test_docs_visibility(monkeypatch, environment, expected):
    from app.config import settings
    import app.main as main
    monkeypatch.setattr(settings, 'environment', environment)
    module = importlib.reload(main)
    try:
        client = TestClient(module.app)
        for path in ('/docs', '/redoc', '/openapi.json'):
            assert client.get(path).status_code == expected
        if expected == 404:
            assert module.app.docs_url is None
            assert module.app.redoc_url is None
            assert module.app.openapi_url is None
        assert client.get('/health').status_code == 200
    finally:
        monkeypatch.undo()
        importlib.reload(main)
