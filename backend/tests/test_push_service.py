"""SDD-190 — FCM 발송기 단위 QA.

verify.md: TS3(메시지 형태), TS4(오류 분류·토큰 무효), TS6(미설정 시 무발송)
+ Edge(한글 payload 인코딩) + Security Review(토큰 값 비식별).

실제 네트워크·자격증명은 쓰지 않는다 — httpx.MockTransport + google-auth 모킹.
"""

import json

import httpx
import pytest

from app.services import push_service


@pytest.fixture(autouse=True)
def _reset_fcm_settings():
    """테스트마다 FCM 설정·Credentials 캐시를 초기화한다(설정 누수 방지)."""
    from app.config import settings

    saved = (settings.fcm_project_id, settings.fcm_service_account_json)
    settings.fcm_project_id = ""
    settings.fcm_service_account_json = ""
    push_service.reset_credentials_cache()
    yield
    settings.fcm_project_id, settings.fcm_service_account_json = saved
    push_service.reset_credentials_cache()


def _configure(monkeypatch):
    """프로젝트 ID + 서비스 계정 JSON 문자열을 설정하고 액세스 토큰 발급을 모킹한다."""
    from app.config import settings

    settings.fcm_project_id = "mb-test-project"
    settings.fcm_service_account_json = json.dumps({"type": "service_account"})
    monkeypatch.setattr(push_service, "_get_access_token", lambda: "test-access-token")


def _mock_client(monkeypatch, handler):
    """httpx.Client 를 MockTransport 로 바꿔 실제 요청을 막는다."""
    real_client = httpx.Client

    def _factory(*args, **kwargs):
        kwargs.pop("timeout", None)
        return real_client(transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(push_service.httpx, "Client", _factory)


# ── TS6: 미설정 ────────────────────────────────────────────────


def test_TS6_미설정이면_발송_시도_없이_실패를_돌려준다(monkeypatch):
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, json={})

    _mock_client(monkeypatch, handler)

    assert push_service.is_configured() is False
    result = push_service.send_to_token("tok-abcdefgh", title="알림", body="확인", data={})
    assert result.ok is False
    assert result.token_invalid is False
    assert calls == []  # HTTP 호출 자체가 없다


def test_TS6_프로젝트_ID만_있으면_여전히_미설정(monkeypatch):
    from app.config import settings

    settings.fcm_project_id = "mb-test-project"
    assert push_service.is_configured() is False


# ── TS3: 메시지 형태 ────────────────────────────────────────────


def test_TS3_FCM_v1_엔드포인트와_메시지_형태가_규격을_따른다(monkeypatch):
    _configure(monkeypatch)
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("Authorization")
        seen["body"] = json.loads(request.content.decode("utf-8"))
        return httpx.Response(200, json={"name": "projects/mb-test-project/messages/1"})

    _mock_client(monkeypatch, handler)

    result = push_service.send_to_token(
        "tok-abcdefghij",
        title="새 알림이 있어요",
        body="앱에서 확인해 주세요",
        data={"deeplink": "/app/ai", "message_id": "mid-1"},
    )

    assert result.ok is True
    assert seen["url"] == "https://fcm.googleapis.com/v1/projects/mb-test-project/messages:send"
    assert seen["auth"] == "Bearer test-access-token"
    message = seen["body"]["message"]
    assert message["token"] == "tok-abcdefghij"
    # Edge: 한글 본문이 그대로 전달된다(JSON UTF-8 인코딩)
    assert message["notification"] == {"title": "새 알림이 있어요", "body": "앱에서 확인해 주세요"}
    # data 값은 모두 문자열
    assert message["data"] == {"deeplink": "/app/ai", "message_id": "mid-1"}
    assert all(isinstance(v, str) for v in message["data"].values())


def test_TS3_data_값은_문자열로_강제된다():
    message = push_service.build_message(
        "tok", title="t", body="b", data={"message_id": 123, "deeplink": "/agent"}
    )["message"]
    assert message["data"] == {"message_id": "123", "deeplink": "/agent"}


# ── TS4: 오류 분류 ──────────────────────────────────────────────


@pytest.mark.parametrize(
    "status_code,fcm_status,expect_invalid",
    [
        (404, "NOT_FOUND", True),
        (404, "UNREGISTERED", True),
        (400, "INVALID_ARGUMENT", True),
        (500, "INTERNAL", False),
        (503, "UNAVAILABLE", False),
        (401, "UNAUTHENTICATED", False),
    ],
)
def test_TS4_응답_코드로_토큰_무효_여부를_분류한다(
    monkeypatch, status_code, fcm_status, expect_invalid
):
    _configure(monkeypatch)
    _mock_client(
        monkeypatch,
        lambda request: httpx.Response(status_code, json={"error": {"status": fcm_status}}),
    )

    result = push_service.send_to_token("tok-abcdefgh", title="t", body="b", data={})
    assert result.ok is False
    assert result.token_invalid is expect_invalid
    assert str(status_code) in (result.error or "")


def test_TS4_네트워크_오류는_재시도_대상으로_분류된다(monkeypatch):
    _configure(monkeypatch)

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("timeout")

    _mock_client(monkeypatch, handler)

    result = push_service.send_to_token("tok-abcdefgh", title="t", body="b", data={})
    assert result.ok is False
    assert result.token_invalid is False


# ── Security: 토큰 비식별 ───────────────────────────────────────


def test_Security_오류_사유와_로그에_토큰_전체값이_없다(monkeypatch, caplog):
    _configure(monkeypatch)
    _mock_client(
        monkeypatch,
        lambda request: httpx.Response(404, json={"error": {"status": "UNREGISTERED"}}),
    )
    token = "super-secret-device-token-0001"

    with caplog.at_level("WARNING"):
        result = push_service.send_to_token(token, title="t", body="b", data={})

    assert token not in (result.error or "")
    assert token not in caplog.text
    # 접두사 6자 + 길이 형식만 남는다
    assert push_service.mask_token(token) == f"super-…(len={len(token)})"
    assert push_service.mask_token(token) in caplog.text


def test_서비스_계정_설정은_JSON_문자열과_파일_경로를_모두_받는다(tmp_path):
    from app.config import settings

    info = {"type": "service_account", "project_id": "mb-test-project"}
    settings.fcm_service_account_json = json.dumps(info)
    assert push_service._service_account_info() == info

    key_file = tmp_path / "sa.json"
    key_file.write_text(json.dumps(info), encoding="utf-8")
    settings.fcm_service_account_json = str(key_file)
    assert push_service._service_account_info() == info

    settings.fcm_service_account_json = "/nonexistent/path.json"
    with pytest.raises(RuntimeError):
        push_service._service_account_info()


def test_액세스_토큰은_서비스_계정으로_발급되고_캐시된다(monkeypatch):
    """google-auth 발급 경로 — 실제 자격증명 없이 Credentials 생성만 모킹한다."""
    from google.oauth2 import service_account

    from app.config import settings

    settings.fcm_project_id = "mb-test-project"
    settings.fcm_service_account_json = json.dumps({"type": "service_account"})
    push_service.reset_credentials_cache()

    created: list[list[str]] = []

    class _FakeCredentials:
        valid = True
        token = "issued-access-token"

    def _from_info(info, scopes=None):
        created.append(list(scopes or []))
        return _FakeCredentials()

    monkeypatch.setattr(
        service_account.Credentials, "from_service_account_info", staticmethod(_from_info)
    )

    assert push_service._get_access_token() == "issued-access-token"
    # 두 번째 호출은 캐시된 Credentials 를 재사용한다
    assert push_service._get_access_token() == "issued-access-token"
    assert created == [[push_service.FCM_SCOPE]]
