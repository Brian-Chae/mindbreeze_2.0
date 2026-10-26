"""구 계약(`/sessions/*`) 응답 형태 골든 (SDD-211 C3 · CS-5·CS-6·CS-9·CS-10).

`response_model` 이 없는 dict 응답(join·livekit-token·markers·video/url)과 OpenAPI 로 고정되지 않는
불투명 필드(record·eeg-rollup·checkin·invite)의 실제 키/타입을 시나리오 17개로 박제한다.
값이 아니라 형태(키+타입 태그)만 저장한다. 골든 = Phase 0 시작 시점의 동작(버그 포함, 정리 금지).
"""

from __future__ import annotations

import uuid
from unittest.mock import Mock

import pytest

from tests.entry_helpers import guest_body
from tests.test_member_livekit_token import _join_guest, _set_room_id, _start_group_class, _start_online_class
from tests.test_sdd015_class_code import _create_class, _db, _open_class, _register
from tests.contract.shape_recorder import ShapeRecorder

API = "/api/v1/sessions"


@pytest.fixture(scope="module")
def recorder():
    rec = ShapeRecorder()
    yield rec
    rec.flush()


@pytest.fixture
def invite_enqueue(monkeypatch):
    from app.services import session_email_invite_service as svc

    mock = Mock()
    monkeypatch.setattr(svc, "enqueue_invite_email", mock)
    return mock


def _group(client, host, **over) -> dict:
    return _create_class(client, host["h"], participant_mode="group", max_participants=10, location_type="online", **over)


def _open_group(client, host) -> dict:
    cls = _group(client, host)
    _open_class(client, cls, host["h"])
    return cls


def _enter_guest(client, cls, name="손님") -> dict:
    res = client.post(f"{API}/enter", json=guest_body(cls["access_code"], name, email="guest@example.com"))
    assert res.status_code == 200, res.text
    return res.json()


def _member_in(client, cls, email: str) -> tuple[dict, str]:
    member = _register(client, email, role="client")
    res = client.post(f"{API}/enter", json={"code": cls["access_code"]}, headers=member["h"])
    assert res.status_code == 200, res.text
    return member, res.json()["participant_id"]


# ── S01~S07: 호스트 생성·조회·수정·전이 (SessionResponse) ───────────────


def test_S01_세션_생성_201(client, recorder):
    host = _register(client, "shape-s01@test.com")
    res = client.post(
        API,
        json={"type": "meditation", "duration_min": 30, "title": "형태 골든", "participant_mode": "group", "max_participants": 10},
        headers=host["h"],
    )
    recorder.check("S01 POST /sessions", res)


def test_S02_세션_목록(client, recorder):
    host = _register(client, "shape-s02@test.com")
    cls = _open_group(client, host)
    _enter_guest(client, cls)
    res = client.get(API, headers=host["h"])
    recorder.check("S02 GET /sessions", res)


def test_S03_세션_상세_참여자_포함(client, recorder):
    host = _register(client, "shape-s03@test.com")
    cls = _open_group(client, host)
    _enter_guest(client, cls)
    _member_in(client, cls, "shape-s03-m@test.com")
    res = client.get(f"{API}/{cls['id']}", headers=host["h"])
    recorder.check("S03 GET /sessions/{id}", res)


def test_S04_세션_수정(client, recorder):
    host = _register(client, "shape-s04@test.com")
    cls = _group(client, host)
    res = client.put(f"{API}/{cls['id']}", json={"title": "수정된 제목", "duration_min": 45}, headers=host["h"])
    recorder.check("S04 PUT /sessions/{id}", res)


def test_S05_open_전이(client, recorder):
    host = _register(client, "shape-s05@test.com")
    cls = _group(client, host)
    res = client.post(f"{API}/{cls['id']}/open", headers=host["h"])
    recorder.check("S05 POST open", res)


def test_S06_start_전이(client, recorder):
    host = _register(client, "shape-s06@test.com")
    cls = _open_group(client, host)
    _enter_guest(client, cls)
    res = client.post(f"{API}/{cls['id']}/start", headers=host["h"])
    recorder.check("S06 POST start", res)


def test_S07_end_전이(client, recorder):
    host = _register(client, "shape-s07@test.com")
    cls = _open_group(client, host)
    _enter_guest(client, cls)
    assert client.post(f"{API}/{cls['id']}/start", headers=host["h"]).status_code == 200
    res = client.post(f"{API}/{cls['id']}/end", headers=host["h"])
    recorder.check("S07 POST end", res)
    # SDD-217 DEV-03: 마지막 정규 회차와 부모 클래스가 즉시 완료되어 코드를 숨긴다.
    assert res.json()["status"] == "completed"
    assert res.json()["access_code"] is None


# ── S08~S10: 입장 ───────────────────────────────────────────────────────


def test_S08_enter_verify_봉인_응답(client, recorder):
    host = _register(client, "shape-s08@test.com")
    cls = _open_group(client, host)
    res = client.post(f"{API}/enter/verify", json={"code": cls["access_code"]})
    body = recorder.check("S08 POST enter/verify", res, strict_keys=True)
    assert set(body) == {"title", "scheduled_at", "host_name"}


def test_S09_비회원_enter(client, recorder):
    host = _register(client, "shape-s09@test.com")
    cls = _open_group(client, host)
    res = client.post(f"{API}/enter", json=guest_body(cls["access_code"], "손님", email="guest@example.com"))
    recorder.check("S09 POST enter (비회원)", res)


def test_S10_entry_state(client, recorder):
    host = _register(client, "shape-s10@test.com")
    cls = _open_group(client, host)
    joined = _enter_guest(client, cls)
    res = client.get(f"{API}/{cls['id']}/entry-state", params={"participant_id": joined["participant_id"]},
                     headers={"X-Entry-Credential": joined["entry_credential"]})
    recorder.check("S10 GET entry-state", res)


# ── S11~S13: response_model 미지정 dict ─────────────────────────────────


def test_S11_join_미지정_dict(client, recorder):
    host = _register(client, "shape-s11@test.com")
    cls = _start_online_class(client, host)
    res = client.post(f"{API}/{cls['id']}/join", headers=host["h"])
    recorder.check("S11 POST join", res)


def test_S12_livekit_token_미지정_dict(client, recorder):
    host = _register(client, "shape-s12@test.com")
    cls, _joined = _start_group_class(client, host)
    res = client.post(f"{API}/{cls['id']}/livekit-token", headers=host["h"])
    recorder.check("S12 POST livekit-token", res)


def test_S13_markers_미지정_dict(client, recorder):
    host = _register(client, "shape-s13@test.com")
    cls = _start_online_class(client, host)
    res = client.post(f"{API}/{cls['id']}/markers", json={"timestamp_sec": 12.5, "note": "호흡 안정"}, headers=host["h"])
    recorder.check("S13 POST markers", res)


# ── S14~S17: 불투명 필드·보강 ───────────────────────────────────────────


def test_S14_record_조회와_수정_불투명_내부_키(client, recorder):
    host = _register(client, "shape-s14@test.com")
    cls = _open_group(client, host)
    _enter_guest(client, cls)
    member, _pid = _member_in(client, cls, "shape-s14-m@test.com")
    assert client.post(f"{API}/{cls['id']}/start", headers=host["h"]).status_code == 200
    assert client.post(f"{API}/{cls['id']}/markers", json={"timestamp_sec": 3.0, "note": "마커"}, headers=host["h"]).status_code == 200
    checkin = client.post(f"{API}/{cls['id']}/checkin", json={"phase": "after", "arousal": 2, "valence": 5, "emotion": 4, "note": "가벼워요"}, headers=member["h"])
    assert checkin.status_code == 200, checkin.text
    recorder.check("S14 GET record (호스트)", client.get(f"{API}/{cls['id']}/record", headers=host["h"]))
    recorder.check("S14 GET record (참여자)", client.get(f"{API}/{cls['id']}/record", headers=member["h"]))
    res = client.put(f"{API}/{cls['id']}/record", json={"counselor_notes": "메모", "ai_summary": {"headline": "요약"}}, headers=host["h"])
    recorder.check("S14 PUT record", res)


def test_S15_report_status와_report_choice_summary(client, recorder):
    host = _register(client, "shape-s15@test.com")
    cls = _open_group(client, host)
    joined = _enter_guest(client, cls)
    ok = client.put(
        f"{API}/{cls['id']}/report-choice",
        json={"participant_id": joined["participant_id"], "report_included": True},
        headers={"X-Entry-Credential": joined["entry_credential"]},
    )
    assert ok.status_code == 200, ok.text
    recorder.check("S15 PUT report-choice", ok)
    recorder.check("S15 GET report-status", client.get(f"{API}/{cls['id']}/report-status", headers=host["h"]))
    recorder.check("S15 GET report-choice/summary", client.get(f"{API}/{cls['id']}/report-choice/summary", headers=host["h"]))


def test_S16_eeg_rollup과_checkin과_invite_email(client, recorder, invite_enqueue):
    host = _register(client, "shape-s16@test.com")
    cls = _open_group(client, host)
    joined = _enter_guest(client, cls)
    member, _pid = _member_in(client, cls, "shape-s16-m@test.com")
    assert client.post(f"{API}/{cls['id']}/start", headers=host["h"]).status_code == 200
    features = [{"second_offset": i, "relaxation_index": 0.5, "signal_quality": 0.9} for i in range(10)]
    ing = client.post(f"{API}/{cls['id']}/features", json={"participant_id": joined["participant_id"], "features": features},
                      headers={"X-Entry-Credential": joined["entry_credential"]})
    assert ing.status_code == 200, ing.text
    recorder.check("S16 POST features", ing)
    recorder.check("S16 GET eeg-rollup", client.get(f"{API}/{cls['id']}/eeg-rollup", headers=host["h"]))
    recorder.check(
        "S16 POST checkin",
        client.post(f"{API}/{cls['id']}/checkin", json={"phase": "before", "arousal": 3, "valence": 4}, headers=member["h"]),
    )
    recorder.check(
        "S16 POST invite/email",
        client.post(f"{API}/{cls['id']}/invite/email", json={"emails": ["invitee@example.com"]}, headers=host["h"]),
    )
    recorder.check("S16 GET invite/email", client.get(f"{API}/{cls['id']}/invite/email", headers=host["h"]))


def test_S17_video_url_미지정_dict(client, recorder):
    from app.models.record import SessionRecord

    host = _register(client, "shape-s17@test.com")
    cls = _start_online_class(client, host)
    recorder.check("S17 GET video/url (영상 없음)", client.get(f"{API}/{cls['id']}/video/url", headers=host["h"]))

    db = _db()
    try:
        db.add(SessionRecord(session_id=uuid.UUID(cls["id"]), video_s3_key="local/fallback.mp4"))
        db.commit()
    finally:
        db.close()
    recorder.check("S17 GET video/url (영상 있음)", client.get(f"{API}/{cls['id']}/video/url", headers=host["h"]))


# ── 에러 응답 본문 형태(`{"detail": …}`) ────────────────────────────────


def test_E_에러_응답_형태(client, recorder):
    host = _register(client, "shape-e@test.com")
    other = _register(client, "shape-e-other@test.com")
    cls = _group(client, host)
    recorder.check("E401 GET /sessions (비로그인)", client.get(API))
    recorder.check("E403 PUT /sessions/{id} (비호스트)", client.put(f"{API}/{cls['id']}", json={"title": "x"}, headers=other["h"]))
    recorder.check("E404 GET /sessions/{id} (없음)", client.get(f"{API}/{uuid.uuid4()}", headers=host["h"]))
    recorder.check("E422 POST /sessions (검증 실패)", client.post(API, json={"type": "nope", "duration_min": 0}, headers=host["h"]))


# ── 골든 자체 검증 · 변이 주입(CS-10) ───────────────────────────────────

_TAGS = {"uuid", "datetime", "date", "url", "str", "number", "bool", "null"}


def _leaves(node):
    if isinstance(node, dict):
        for key, value in node.items():
            assert not key.rstrip("?").count("@"), f"골든 키에 이메일이 섞임: {key}"
            yield from _leaves(value)
    elif isinstance(node, list):
        for value in node:
            yield from _leaves(value)
    else:
        yield node


def _golden() -> dict:
    from tests.contract import golden_io
    from tests.contract.shape_recorder import GOLDEN_NAME

    return golden_io.load_golden(GOLDEN_NAME)


def test_CS5_골든은_17개_시나리오_전부를_담고_값이_아닌_태그만_저장한다():
    golden = _golden()
    scenarios = {label.split(" ")[0] for label in golden if label.startswith("S")}
    assert scenarios == {f"S{n:02d}" for n in range(1, 18)}
    for label, entry in golden.items():
        assert set(_leaves(entry["shape"])) <= _TAGS, label
    assert all(any(label.startswith(code) for label in golden) for code in ("E401", "E403", "E404", "E422"))


def test_CS6_enter_verify_는_봉인_응답으로_저장된다():
    entry = _golden()["S08 POST enter/verify"]
    assert entry["strict_keys"] is True
    assert set(entry["shape"]) == {"title", "scheduled_at", "host_name"}


def test_CS10_변이주입_미지정_dict_응답의_키_삭제와_타입_변경을_잡는다():
    from tests.contract import shape

    for label, victim in (
        ("S12 POST livekit-token", "livekit_token"),
        ("S11 POST join", "livekit_token"),
        ("S13 POST markers", "markers"),
        ("S17 GET video/url (영상 있음)", "url"),
    ):
        golden_shape = _golden()[label]["shape"]
        dropped = {k: v for k, v in golden_shape.items() if k != victim}
        assert shape.compare_shape(golden_shape, dropped), f"{label}: 키 삭제를 못 잡음"
        retyped = {**golden_shape, victim: "bool"}
        assert shape.compare_shape(golden_shape, retyped), f"{label}: 타입 변경을 못 잡음"


def test_CS10_변이주입_불투명_필드_내부_키_삭제를_잡는다():
    from tests.contract import shape

    golden_shape = _golden()["S14 GET record (호스트)"]["shape"]
    slot = golden_shape["subjective_state"]["participants"]["<uuid>"]["after"]
    broken = {
        **golden_shape,
        "subjective_state": {
            **golden_shape["subjective_state"],
            "participants": {"<uuid>": {"after": {k: v for k, v in slot.items() if k != "valence"}, "before": "null"}},
        },
    }
    problems = shape.compare_shape(golden_shape, broken)
    assert problems and "valence" in problems[0]


def test_CS6_변이주입_봉인_응답에_키가_추가되면_실패한다():
    from tests.contract import shape

    entry = _golden()["S08 POST enter/verify"]
    widened = {**entry["shape"], "host_email": "str"}
    assert shape.compare_shape(entry["shape"], widened) == []
    assert shape.compare_shape(entry["shape"], widened, strict_keys=entry["strict_keys"])
