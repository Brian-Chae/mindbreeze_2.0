"""SDD-220 TS31 — 운영에서 API 문서 비노출. lifespan·DB 연결은 실행하지 않는다.

app.main 을 reload 하지 않는다: reload 하면 `from app.main import app` 을 쥔 다른 테스트 모듈의
dependency_overrides 가 갈라져 순서 의존 실패가 난다. 같은 설정 함수로 만든 독립 앱을 검증한다.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.main import docs_urls


@pytest.mark.parametrize("environment,expected", [("production", 404), ("development", 200)])
def test_docs_visibility(environment, expected):
    probe = FastAPI(**docs_urls(environment))

    @probe.get("/health")
    def _health():
        return {"status": "ok"}

    client = TestClient(probe)
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == expected
    if expected == 404:
        assert probe.docs_url is None and probe.redoc_url is None and probe.openapi_url is None
    assert client.get("/health").status_code == 200


def test_main_app_uses_docs_urls():
    """실제 앱이 같은 설정 함수를 쓰는지(기본 environment=production → 비노출) 확인한다."""
    from app.config import settings
    from app.main import app

    assert app.docs_url == docs_urls(settings.environment)["docs_url"]
    assert app.openapi_url == docs_urls(settings.environment)["openapi_url"]
