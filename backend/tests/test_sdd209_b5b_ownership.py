"""SDD-209 B5b — 소유권 통합 (verify BT25~BT30·BT44·BT45, AZ5~AZ8·AZ10, RV3-7·8·10·12).

REST·WS·LiveKit·EEG 업로드·체크인·손들기·리포트 선택·entry-state 가 모두 "로그인 회원 또는 입장 자격"으로
본인 참여자를 증명한다. 코드·participant_id 단독은 인증 수단이 아니다. 구 by-code 4개 경로는 폴백 없이 제거.
"""

import uuid

import pytest

from tests.entry_helpers import guest_body, no_credential
from tests.test_sdd015_class_code import _create_class, _open_class, _register
from tests.test_sdd026_live_session_p0 import _feature, _wire


def _group(client, host, **kw):
    kw.setdefault("participant_mode", "group")
    kw.setdefault("max_participants", 10)
    cls = _create_class(client, host["h"], **kw)
    _open_class(client, cls, host["h"])
    return cls


def _guest(client, cls, name="게스트"):
    res = client.post("/api/v1/sessions/enter", json=guest_body(cls["access_code"], name))
    assert res.status_code == 200, res.text
    return res.json()


def _cred(j):
    return {"X-Entry-Credential": j["entry_credential"]}


# ── BT45 / RV3-12: 구 경로 제거 ─────────────────────────────────────────


def test_BT45_by_code_4개_경로_폴백없이_제거(client):
    assert client.get("/api/v1/sessions/by-code/1234").status_code in (404, 405)
    assert client.post("/api/v1/sessions/by-code/1234/join", json={}).status_code in (404, 405)
    assert client.get("/api/v1/sessions/by-code/1234/state").status_code in (404, 405)
    assert client.post("/api/v1/sessions/by-code/1234/livekit-token", json={}).status_code in (404, 405)


def test_RV3_12_구_경로_심볼_코드에서_제거():
    from app.services import session_service

    for name in ("join_session_by_code", "get_session_by_code", "get_guest_session_state", "member_livekit_token"):
        assert not hasattr(session_service, name), name


# ── BT44 entry-state ────────────────────────────────────────────────────


def test_BT44_entry_state_자격기반_본인_상태(client):
    host = _register(client, "b5bh1@test.com")
    cls = _group(client, host, max_participants=1)
    first, second = _guest(client, cls, "첫째"), _guest(client, cls, "둘째")

    s1 = client.get(f"/api/v1/sessions/{cls['id']}/entry-state", headers=_cred(first))
    assert s1.status_code == 200, s1.text
    body = s1.json()
    assert body["participant_id"] == first["participant_id"] and body["is_waitlisted"] is False
    assert body["report_included"] is False and body["guest_state"] == "waiting"
    assert body["chat_enabled"] is False and "participants" not in body

    s2 = client.get(f"/api/v1/sessions/{cls['id']}/entry-state", headers=_cred(second))
    assert s2.json()["is_waitlisted"] is True

    # 본인 리포트 선택이 반영된다
    client.put(f"/api/v1/sessions/{cls['id']}/report-choice",
               json={"participant_id": first["participant_id"], "report_included": True}, headers=_cred(first))
    assert client.get(f"/api/v1/sessions/{cls['id']}/entry-state", headers=_cred(first)).json()["report_included"] is True

    # 시작 → 진행 전이 감지, 종료 후에도 읽기 가능(FM09)
    client.post(f"/api/v1/sessions/{cls['id']}/start", headers=host["h"])
    assert client.get(f"/api/v1/sessions/{cls['id']}/entry-state", headers=_cred(first)).json()["guest_state"] == "meditation"
    client.post(f"/api/v1/sessions/{cls['id']}/end", headers=host["h"])
    ended = client.get(f"/api/v1/sessions/{cls['id']}/entry-state", headers=_cred(first)).json()
    assert ended["ended"] is True and ended["guest_state"] == "complete"


def test_BT44_회원은_로그인으로도_entry_state(client):
    host = _register(client, "b5bh2@test.com")
    member = _register(client, "b5bm2@test.com", role="client")
    cls = _group(client, host)
    client.post("/api/v1/sessions/enter", json={"code": cls["access_code"]}, headers=member["h"])
    r = client.get(f"/api/v1/sessions/{cls['id']}/entry-state", headers={**member["h"], **no_credential()})
    assert r.status_code == 200 and r.json()["is_waitlisted"] is False


# ── AZ5~AZ8 / BT25 REST 교차 접근 ───────────────────────────────────────


def test_AZ5_BT25_타_참여자_REST_접근_403_자격없음_401(client):
    host = _register(client, "b5bh3@test.com")
    cls = _group(client, host)
    a, b = _guest(client, cls, "A"), _guest(client, cls, "B")
    base = f"/api/v1/sessions/{cls['id']}"

    # 손들기: B 자격으로 A 의 손들기 → 403, 자격 없음 → 401, 본인 → 200
    assert client.post(f"{base}/participants/{a['participant_id']}/raise-hand", headers=_cred(b)).status_code == 403
    assert client.post(f"{base}/participants/{a['participant_id']}/raise-hand", headers=no_credential()).status_code == 401
    assert client.post(f"{base}/participants/{a['participant_id']}/raise-hand", headers=_cred(a)).status_code == 200

    # 체크인
    body = {"participant_id": a["participant_id"], "arousal": 3, "valence": 3}
    assert client.post(f"{base}/checkin", json=body, headers=_cred(b)).status_code == 403
    assert client.post(f"{base}/checkin", json=body, headers=no_credential()).status_code == 401
    assert client.post(f"{base}/checkin", json=body, headers=_cred(a)).status_code == 200

    # 리포트 선택
    body = {"participant_id": a["participant_id"], "report_included": True}
    assert client.put(f"{base}/report-choice", json=body, headers=_cred(b)).status_code == 403
    assert client.put(f"{base}/report-choice", json=body, headers=no_credential()).status_code == 401

    # entry-state / livekit-token 은 항상 "자격이 가리키는 본인" 것만 — 타인 지정 불가
    assert client.get(f"{base}/entry-state", headers=no_credential()).status_code == 401


def test_AZ6_타_클래스_자격은_모든_엔드포인트_403(client):
    host = _register(client, "b5bh4@test.com")
    cls1, cls2 = _group(client, host), _group(client, host)
    g1 = _guest(client, cls1)
    base2 = f"/api/v1/sessions/{cls2['id']}"
    for method, url, kw in (
        ("get", f"{base2}/entry-state", {}),
        ("post", f"{base2}/entry/livekit-token", {}),
        ("post", f"{base2}/features", {"json": {"features": [_feature(0, relaxation_index=0.5)]}}),
        ("post", f"{base2}/eeg-raw/presign", {"json": {"chunks": [{"stream_id": "s", "chunk_index": 0,
                                                                  "sample_rate": 250, "channel_count": 2}]}}),
    ):
        res = getattr(client, method)(url, headers=_cred(g1), **kw)
        assert res.status_code == 403, (url, res.status_code, res.text)


def test_AZ7_BT28_EEG_업로드는_소유_자격만_타인_403_자격없음_401(client):
    host = _register(client, "b5bh5@test.com")
    cls = _group(client, host)
    a, b = _guest(client, cls, "A"), _guest(client, cls, "B")
    url = f"/api/v1/sessions/{cls['id']}/features"
    batch = [_feature(0, relaxation_index=0.5, signal_quality=0.9)]

    assert client.post(url, json={"features": batch}, headers=_cred(a)).status_code == 200  # participant_id 생략도 자격으로
    assert client.post(url, json={"participant_id": a["participant_id"], "features": batch}, headers=_cred(b)).status_code == 403
    assert client.post(url, json={"participant_id": a["participant_id"], "features": batch},
                       headers=no_credential()).status_code == 401

    chunks = [{"stream_id": "s", "chunk_index": 0, "sample_rate": 250, "channel_count": 2}]
    pre = f"/api/v1/sessions/{cls['id']}/eeg-raw/presign"
    assert client.post(pre, json={"chunks": chunks}, headers=_cred(a)).status_code == 200
    assert client.post(pre, json={"participant_id": a["participant_id"], "chunks": chunks}, headers=_cred(b)).status_code == 403
    assert client.post(pre, json={"participant_id": a["participant_id"], "chunks": chunks},
                       headers=no_credential()).status_code == 401


def test_AZ8_BT30_코드는_인증수단이_아니다(client):
    host = _register(client, "b5bh6@test.com")
    cls = _group(client, host)
    j = _guest(client, cls)
    code = cls["access_code"]
    url = f"/api/v1/sessions/{cls['id']}/features"
    batch = [_feature(0, relaxation_index=0.5, signal_quality=0.9)]
    for headers in (
        {"X-Entry-Credential": code},
        {"X-Access-Code": code, **no_credential()},
        {"Authorization": f"Bearer {code}", **no_credential()},
    ):
        res = client.post(url, json={"participant_id": j["participant_id"], "features": batch}, headers=headers)
        assert res.status_code == 401, (headers, res.status_code)
    res = client.post(url, json={"participant_id": j["participant_id"], "access_code": code, "features": batch},
                      headers=no_credential())
    assert res.status_code == 401
    assert client.get(f"/api/v1/sessions/{cls['id']}/entry-state?code={code}", headers=no_credential()).status_code == 401


# ── BT27 LiveKit ────────────────────────────────────────────────────────


def test_BT27_LiveKit_대기열_403_타인_자격_불가_송신규칙_동일(client):
    from app.models.session import Session as S
    from app.core.database import SessionLocal

    host = _register(client, "b5bh7@test.com")
    cls = _group(client, host, location_type="online", max_participants=1)
    first, waiting = _guest(client, cls, "첫째"), _guest(client, cls, "대기")
    db = SessionLocal()
    try:
        s = db.query(S).filter(S.id == uuid.UUID(cls["id"])).first()
        s.webrtc_room_id = uuid.uuid4()
        db.commit()
    finally:
        db.close()
    url = f"/api/v1/sessions/{cls['id']}/entry/livekit-token"

    ok = client.post(url, headers=_cred(first))
    assert ok.status_code == 200 and ok.json()["can_publish"] is False  # 온라인 그룹≤20 기본 뮤트(_compute_can_publish)
    assert client.post(url, headers=_cred(waiting)).status_code == 403  # 대기열
    assert client.post(url, headers=no_credential()).status_code == 401


# ── AZ10 / BT29 / RV3-10 호스트 분리 ────────────────────────────────────


def test_AZ10_참가자_자격으로_호스트_API_불가(client):
    host = _register(client, "b5bh8@test.com")
    member = _register(client, "b5bm8@test.com", role="client")
    cls = _group(client, host)
    j = _guest(client, cls)
    client.post("/api/v1/sessions/enter", json={"code": cls["access_code"]}, headers=member["h"])
    base = f"/api/v1/sessions/{cls['id']}"
    host_calls = (
        ("post", f"{base}/start", {}),
        ("post", f"{base}/open", {}),
        ("post", f"{base}/cancel", {}),
        ("post", f"{base}/invite", {"json": {"user_id": member["id"]}}),
        ("get", f"{base}/live-metrics", {}),
        ("post", f"{base}/livekit-token", {}),
        ("delete", f"{base}/participants/{member['id']}", {}),
    )
    for method, url, kw in host_calls:
        # 비로그인 + 입장 자격: access 토큰이 아니므로 401
        r = getattr(client, method)(url, headers=_cred(j), **kw)
        assert r.status_code == 401, (url, r.status_code)
        # 로그인한 일반 회원(호스트 아님) + 자격: 403
        r = getattr(client, method)(url, headers={**member["h"], **_cred(j)}, **kw)
        assert r.status_code == 403, (url, r.status_code)
    # 클래스 상태가 바뀌지 않았다
    assert client.get(base, headers=host["h"]).json()["status"] == "open"


def test_입장자격은_로그인_토큰으로_통하지_않는다(client):
    host = _register(client, "b5bh9@test.com")
    cls = _group(client, host)
    j = _guest(client, cls)
    assert client.get("/api/v1/sessions", headers={"Authorization": f"Bearer {j['entry_credential']}"}).status_code == 401


# ── BT26 WS ─────────────────────────────────────────────────────────────


def test_BT26_WS_join_자격필수_타클래스_거부_feature_재검증(client, monkeypatch):
    host = _register(client, "b5bh10@test.com")
    cls1, cls2 = _group(client, host), _group(client, host)
    j = _guest(client, cls1)
    pid, cred = j["participant_id"], j["entry_credential"]
    fake = _wire(monkeypatch)

    # participant_id 만(자격 없음) → 거부
    fake.call("connect", "s1", {}, {})
    fake.call("join", "s1", {"session_id": cls1["id"], "participant_id": pid, "entry_credential": None})
    assert fake.events("joined") == [] and fake.events("join_denied")

    # 위조 자격 → 거부
    fake.call("connect", "s2", {}, {})
    fake.call("join", "s2", {"session_id": cls1["id"], "participant_id": pid, "entry_credential": "forged"})
    assert fake.events("joined") == []

    # 타 클래스 자격으로 다른 클래스 join → 거부
    fake.call("connect", "s3", {}, {})
    fake.call("join", "s3", {"session_id": cls2["id"], "participant_id": pid, "entry_credential": cred})
    assert fake.events("joined") == []

    # 올바른 자격 → 입장, 이후 feature 는 join 컨텍스트의 자격으로 저장
    fake.call("connect", "s4", {}, {})
    fake.call("join", "s4", {"session_id": cls1["id"], "participant_id": pid, "entry_credential": cred})
    assert len(fake.events("joined")) == 1
    fake.call("feature", "s4", {"session_id": cls1["id"], "participant_id": pid, "stream_id": "x", "sequence": 0,
                                "feature": _feature(0, relaxation_index=0.5, signal_quality=0.9)})
    acks = fake.events("feature_ack")
    assert acks and acks[-1]["data"]["saved"] == 1

    # 입장 자격을 폐기하면 같은 소켓의 후속 feature 가 거부된다(매 요청 재검증) — 저장 0
    assert client.post("/api/v1/sessions/entry/revoke", headers={"X-Entry-Credential": cred}).status_code == 204
    fake.call("feature", "s4", {"session_id": cls1["id"], "participant_id": pid, "stream_id": "x", "sequence": 1,
                                "feature": _feature(1, relaxation_index=0.5, signal_quality=0.9)})
    assert fake.events("feature_ack")[-1]["data"]["saved"] == 0


# ── 회원 로그인 경로는 그대로 ────────────────────────────────────────────


def test_로그인_회원은_자격없이_로그인만으로_본인_업로드_교차는_403(client):
    host = _register(client, "b5bh11@test.com")
    m1 = _register(client, "b5bm11a@test.com", role="client")
    m2 = _register(client, "b5bm11b@test.com", role="client")
    cls = _group(client, host)
    p1 = client.post("/api/v1/sessions/enter", json={"code": cls["access_code"]}, headers=m1["h"]).json()["participant_id"]
    client.post("/api/v1/sessions/enter", json={"code": cls["access_code"]}, headers=m2["h"])
    url = f"/api/v1/sessions/{cls['id']}/features"
    batch = [_feature(0, relaxation_index=0.5, signal_quality=0.9)]
    assert client.post(url, json={"features": batch}, headers={**m1["h"], **no_credential()}).status_code == 200
    assert client.post(url, json={"participant_id": p1, "features": batch},
                       headers={**m2["h"], **no_credential()}).status_code == 403
