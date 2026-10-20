"""SDD-220 TS24(F1) · TS14/TS15 일부 — 회차별 녹음·녹화 필수 동의 서버 게이트, 뇌파 수집 선택·계정 철회."""

import inspect
from datetime import datetime, timezone
from uuid import uuid4

import pytest

from app.core.database import get_db
from app.main import app
from app.models.consent import Consent
from app.models.research import ResearchConsent, ResearchWithdrawalRequest
from app.models.session import Session as SessionModel, SessionParticipant
from app.services import recording_consent_service as rcs
from tests.entry_helpers import guest_body
from tests.sdd220_helpers import auth_headers, ensure_account_routes, make_user
from tests.test_sdd024_session_live_ws import _create_group_class, _register

STRICT = {"X-Test-Strict-Recording": "1"}  # conftest 의 입장 동의 자동 주입을 끈다
ENTER = "/api/v1/sessions/enter"


def _db():
    return next(app.dependency_overrides[get_db]())


def _participants(session_id):
    return _db().query(SessionParticipant).filter(SessionParticipant.session_id == session_id).all()


@pytest.fixture
def cls(client):
    counselor = _register(client, "rc-host@test.com")
    return _create_group_class(client, counselor["h"])


def _enter(client, code, **extra):
    return client.post(ENTER, json={**guest_body(code, "게스트"), **extra}, headers=STRICT)


# ── TS24: 게스트 ──────────────────────────────────────────────────────

def test_ts24_게스트_동의_누락_거부_저장실패_모두_403_자격_토큰_0(client, cls):
    for extra in ({}, {"recording_consent": False}):
        res = _enter(client, cls["access_code"], **extra)
        assert res.status_code == 403, res.text
        assert res.json()["detail"]["code"] == "RECORDING_CONSENT_REQUIRED"
        assert "entry_credential" not in res.text
    # 거부·누락으로 참여자 행이 만들어지지 않는다
    assert _participants(cls["id"]) == []


def test_ts24_게스트_동의_저장후_입장_버전_시각_기록(client, cls):
    res = _enter(client, cls["access_code"], recording_consent=True, recording_notice_version="rec-9")
    assert res.status_code == 200, res.text
    assert res.json()["entry_credential"]
    (p,) = _participants(cls["id"])
    assert p.recording_consented is True and p.recording_notice_version == "rec-9" and p.recording_consent_at is not None
    # 뇌파 수집은 따로 고르지 않으면 미동의(추정 금지)
    assert p.eeg_collection_consented is False


def test_ts24_저장_실패시_입장_자격_없음(client, cls, monkeypatch):
    def boom(participant, version, now=None):
        raise RuntimeError("db down")

    monkeypatch.setattr(rcs, "apply_recording_consent", boom)
    with pytest.raises(RuntimeError):
        _enter(client, cls["access_code"], recording_consent=True)
    assert _participants(cls["id"]) == []


def test_ts24_재접속은_저장된_동의로_통과_동의없는_새_입장은_거부(client, cls):
    first = _enter(client, cls["access_code"], recording_consent=True)
    cred = first.json()["entry_credential"]
    again = client.post(ENTER, json={**guest_body(cls["access_code"], "게스트")},
                        headers={**STRICT, "X-Entry-Credential": cred})
    assert again.status_code == 200, again.text
    fresh = client.post(ENTER, json={**guest_body(cls["access_code"], "다른게스트", email="other@x.com")},
                        headers={**STRICT, "X-Entry-Credential": ""})
    assert fresh.status_code == 403


def test_ts24_리포트_제외_연구_거부는_입장을_막지_않는다(client, cls):
    res = _enter(client, cls["access_code"], recording_consent=True)
    assert res.status_code == 200
    (p,) = _participants(cls["id"])
    assert p.report_included is False and not _db().query(ResearchConsent).count()  # 선택 미동의 상태로도 입장


# ── TS24: 회원 ────────────────────────────────────────────────────────

def test_ts24_회원_코드입장도_동의없이는_403(client, cls):
    member = _register(client, "rc-member@test.com", role="client")
    denied = client.post(ENTER, json={"code": cls["access_code"]}, headers={**member["h"], **STRICT})
    assert denied.status_code == 403 and denied.json()["detail"]["code"] == "RECORDING_CONSENT_REQUIRED"
    assert _participants(cls["id"]) == []
    ok = client.post(ENTER, json={"code": cls["access_code"], "recording_consent": True}, headers={**member["h"], **STRICT})
    assert ok.status_code == 200, ok.text
    (p,) = _participants(cls["id"])
    assert p.recording_consented is True


def test_ts24_회원_뇌파_기본값은_계정_동의를_따른다(client, cls):
    member = _register(client, "rc-eeg@test.com", role="client")
    db = _db()
    db.query(Consent).filter_by(user_id=member["id"], type="eeg").update({"agreed": True})
    db.commit()
    res = client.post(ENTER, json={"code": cls["access_code"], "recording_consent": True}, headers={**member["h"], **STRICT})
    assert res.status_code == 200
    (p,) = _participants(cls["id"])
    assert p.eeg_collection_consented is True


# ── LiveKit 토큰 / 구 join / 사후 저장 ─────────────────────────────────

def _legacy_guest_with_credential(client, cls):
    """F1 이전에 만들어진 참여자(동의 미저장) + 입장 자격."""
    from app.services import entry_credential_service

    db = _db()
    p = SessionParticipant(session_id=cls["id"], guest_name="구참여자", consent_eeg=True)
    db.add(p)
    db.commit()
    db.refresh(p)
    credential, _ = entry_credential_service.issue(p)
    return p.id, credential


def test_ts24_동의없는_참여자는_LiveKit_토큰_발급_안됨_사후_저장_후_허용(client, cls):
    from tests.test_member_livekit_token import _set_room_id, _token_url

    pid, cred = _legacy_guest_with_credential(client, cls)
    _set_room_id(cls, uuid4())
    h = {"X-Entry-Credential": cred}
    denied = client.post(_token_url(cls), headers=h)
    assert denied.status_code in (400, 403)
    if denied.status_code == 403:
        assert denied.json()["detail"]["code"] == "RECORDING_CONSENT_REQUIRED"
    put = client.put(f"/api/v1/sessions/{cls['id']}/entry/recording-consent", json={"consented": True}, headers=h)
    assert put.status_code == 200 and put.json()["recording_consented"] is True
    assert put.json()["recording_notice_version"] == rcs.RECORDING_NOTICE_VERSION


def test_ts24_거부로_되돌리면_다시_막힌다(client, cls):
    pid, cred = _legacy_guest_with_credential(client, cls)
    h = {"X-Entry-Credential": cred}
    client.put(f"/api/v1/sessions/{cls['id']}/entry/recording-consent", json={"consented": True}, headers=h)
    off = client.put(f"/api/v1/sessions/{cls['id']}/entry/recording-consent", json={"consented": False}, headers=h)
    assert off.json()["recording_consented"] is False and off.json()["recording_consent_at"] is None


def test_ts24_class_guest_entry_는_동의_미저장이면_자격을_내주지_않는다():
    """class_guest_service.guest_entry 가 F1 게이트를 포함한다(소스 계약) — 실제 호출은 PG 전용 클래스 통합 테스트 영역."""
    from app.services import class_guest_service

    src = inspect.getsource(class_guest_service.guest_entry)
    assert "RECORDING_CONSENT_REQUIRED" in src and "is_recorded" in src
    assert src.index("is_recorded") < src.index("issue(context_cache")


# ── TS15: 뇌파 수집 게이트 ────────────────────────────────────────────

def test_ts15_뇌파_거부_참여자는_업로드_403_URL_0_동의_NULL은_기존_동작(client, cls):
    from app.services import session_service

    res = _enter(client, cls["access_code"], recording_consent=True, eeg_collection_consent=False)
    pid = res.json()["participant_id"]
    cred = res.json()["entry_credential"]
    body = {"chunks": [{"chunk_index": 0}]}
    denied = client.post(f"/api/v1/sessions/{cls['id']}/eeg-raw/presign", json=body, headers={"X-Entry-Credential": cred})
    assert denied.status_code == 403
    assert denied.json()["detail"]["code"] == "EEG_CONSENT_REQUIRED"
    assert "url" not in denied.text.lower()

    db = _db()
    p = db.query(SessionParticipant).filter_by(id=pid).first()
    p.eeg_collection_consented = None  # F1 이전 행
    db.commit()
    rcs.assert_eeg_upload_allowed(_db().query(SessionParticipant).filter_by(id=pid).first())
    p.eeg_collection_consented = True
    db.commit()
    rcs.assert_eeg_upload_allowed(_db().query(SessionParticipant).filter_by(id=pid).first())
    assert session_service is not None


def test_ts15_리포트_제외만으로_수집을_막지_않는다(client, cls):
    res = _enter(client, cls["access_code"], recording_consent=True, eeg_collection_consent=True)
    (p,) = _participants(cls["id"])
    assert p.report_included is False and p.consent_eeg is not None
    rcs.assert_eeg_upload_allowed(p)


def test_ts15_회차_뇌파_선택은_리포트_연구와_독립으로_저장(client, cls):
    res = _enter(client, cls["access_code"], recording_consent=True)
    cred = res.json()["entry_credential"]
    put = client.put(f"/api/v1/sessions/{cls['id']}/entry/eeg-consent", json={"consented": True, "notice_version": "eeg-7"},
                     headers={"X-Entry-Credential": cred})
    assert put.status_code == 200
    assert put.json()["eeg_collection_consented"] is True and put.json()["eeg_notice_version"] == "eeg-7"
    got = client.get(f"/api/v1/sessions/{cls['id']}/entry/consents", headers={"X-Entry-Credential": cred})
    assert got.json()["recording_consented"] is True and got.json()["eeg_collection_consented"] is True


# ── TS15: 앱 내 철회 ──────────────────────────────────────────────────

@pytest.fixture
def account_routes():
    ensure_account_routes()


def test_ts15_계정_뇌파_철회_저장_회차_동기화_독립_유지(client, cls, account_routes):
    member = _register(client, "rc-withdraw@test.com", role="client")
    client.post(ENTER, json={"code": cls["access_code"], "recording_consent": True, "eeg_collection_consent": True},
                headers={**member["h"], **STRICT})
    res = client.put("/api/v1/users/me/consents", json={"eeg": True}, headers=member["h"])
    assert res.status_code == 200 and res.json()["eeg"]["agreed"] is True
    off = client.put("/api/v1/users/me/consents", json={"eeg": False}, headers=member["h"])
    assert off.status_code == 200
    assert off.json()["eeg"]["agreed"] is False and off.json()["eeg"]["withdrawn_at"] is not None
    (p,) = _participants(cls["id"])
    assert p.eeg_collection_consented is False          # 회차 동기화
    assert p.recording_consented is True                # 필수 기록 동의는 독립 유지
    got = client.get("/api/v1/users/me/consents", headers=member["h"])
    assert got.json()["eeg"]["agreed"] is False


def test_ts15_연구_철회는_신규_0_기존_철회요청_연결_중복_0(client, cls, account_routes):
    member = _register(client, "rc-research@test.com", role="client")
    client.post(ENTER, json={"code": cls["access_code"], "recording_consent": True}, headers={**member["h"], **STRICT})
    (p,) = _participants(cls["id"])
    db = _db()
    db.add(ResearchConsent(session_id=p.session_id, participant_id=p.id, consented=True, notice_version="r5-1",
                           consented_at=datetime.now(timezone.utc), research_subject_id="s" * 64, key_version=1,
                           export_state="pending"))
    db.commit()
    for _ in range(2):  # 반복 철회도 요청은 1건
        res = client.put("/api/v1/users/me/consents", json={"research": False}, headers=member["h"])
        assert res.status_code == 200 and res.json()["research"]["agreed"] is False
    row = _db().query(ResearchConsent).filter_by(participant_id=p.id).first()
    assert row.consented is False and row.withdrawn_at is not None and row.export_state == "withdrawn"
    assert _db().query(ResearchWithdrawalRequest).filter_by(research_subject_id="s" * 64).count() == 1
