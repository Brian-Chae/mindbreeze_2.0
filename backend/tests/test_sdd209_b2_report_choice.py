"""SDD-209 B2 — 리포트 반영 선택 모델·API·업로드 게이트 분리 (verify BT6~BT9, RV2-1·2·5·7·8, LG7·LG8).

선택(report_included)은 consent_audio/eeg 와 별개이며, 거부(제외)는 원본 수집 중지가 아니다.
"""

import uuid

from tests.test_member_livekit_token import _join_guest, _start_group_class
from tests.test_sdd015_class_code import _create_class, _register, _open_class


def _db():
    from app.core.database import SessionLocal

    return SessionLocal()


def _group_with_guest(client, email="b2c@test.com"):
    counselor = _register(client, email)
    cls, joined = _start_group_class(client, counselor, participant_mode="group", max_participants=10)
    return counselor, cls, joined


def _put(client, cls, joined, included, *, token=True, headers=None, **extra):
    body = {"participant_id": joined["participant_id"], "report_included": included, **extra}
    if token:
        body["participant_token"] = joined["participant_token"]
    return client.put(f"/api/v1/sessions/{cls['id']}/report-choice", json=body, headers=headers or {})


def _row(pid):
    from app.models.session import SessionParticipant

    db = _db()
    try:
        p = db.query(SessionParticipant).filter(SessionParticipant.id == uuid.UUID(pid)).first()
        return {
            "included": p.report_included, "ack_at": p.report_notice_ack_at,
            "ack_ver": p.report_notice_version, "consent_eeg": p.consent_eeg, "consent_audio": p.consent_audio,
        }
    finally:
        db.close()


def _events(pid):
    from app.models.session import ReportChoiceEvent

    db = _db()
    try:
        rows = db.query(ReportChoiceEvent).filter(ReportChoiceEvent.participant_id == uuid.UUID(pid)) \
            .order_by(ReportChoiceEvent.created_at).all()
        return [(e.previous_included, e.new_included, e.actor_kind) for e in rows]
    finally:
        db.close()


def test_기본값은_제외이고_고지없이도_입장_진행(client):
    _, cls, joined = _group_with_guest(client, "b2c1@test.com")
    row = _row(joined["participant_id"])
    assert row["included"] is False and row["ack_at"] is None
    assert _events(joined["participant_id"]) == []


def test_BT6_본인_선택_저장_멱등_이력_고지증빙_분리(client):
    _, cls, joined = _group_with_guest(client, "b2c2@test.com")
    pid = joined["participant_id"]

    r = _put(client, cls, joined, True, notice_acknowledged=True, notice_version="v1")
    assert r.status_code == 200, r.text
    assert r.json()["report_included"] is True and r.json()["changed"] is True
    row = _row(pid)
    assert row["included"] is True and row["ack_at"] is not None and row["ack_ver"] == "v1"
    assert _events(pid) == [(False, True, "self")]

    # 멱등: 같은 값 재요청은 이력을 늘리지 않는다
    r2 = _put(client, cls, joined, True)
    assert r2.status_code == 200 and r2.json()["changed"] is False
    assert _events(pid) == [(False, True, "self")]

    # 변경(BT9): 이전/이후 기록
    r3 = _put(client, cls, joined, False)
    assert r3.status_code == 200 and r3.json()["changed"] is True
    assert _events(pid) == [(False, True, "self"), (True, False, "self")]
    # 고지 증빙은 선택 변경으로 지워지지 않고 이력과 별개로 남는다
    assert _row(pid)["ack_ver"] == "v1"


def test_고지확인_없이_선택만_하면_증빙을_남기지_않는다(client):
    _, cls, joined = _group_with_guest(client, "b2c3@test.com")
    assert _put(client, cls, joined, True).status_code == 200
    row = _row(joined["participant_id"])
    assert row["included"] is True and row["ack_at"] is None and row["ack_ver"] is None


def test_본인만_가능_게스트토큰없음_타인_호스트_403(client):
    counselor, cls, joined = _group_with_guest(client, "b2c4@test.com")
    # 토큰 없는 게스트
    assert _put(client, cls, joined, True, token=False).status_code == 403
    # 다른 게스트의 토큰
    other = _join_guest(client, cls)
    r = client.put(
        f"/api/v1/sessions/{cls['id']}/report-choice",
        json={"participant_id": joined["participant_id"], "report_included": True,
              "participant_token": other["participant_token"]},
    )
    assert r.status_code == 403
    # 호스트도 참여자 대신 바꿀 수 없다
    assert _put(client, cls, joined, True, token=False, headers=counselor["h"]).status_code == 403
    assert _row(joined["participant_id"])["included"] is False


def test_회원_본인_선택_및_타인_회원_403(client):
    counselor = _register(client, "b2c5@test.com")
    m1 = _register(client, "b2m5a@test.com", role="client")
    m2 = _register(client, "b2m5b@test.com", role="client")
    cls = _create_class(client, counselor["h"], participant_mode="group", max_participants=10)
    _open_class(client, cls, counselor["h"])
    pid1 = client.post(f"/api/v1/sessions/by-code/{cls['access_code']}/join", json={}, headers=m1["h"]).json()["participant_id"]
    client.post(f"/api/v1/sessions/by-code/{cls['access_code']}/join", json={}, headers=m2["h"])

    url = f"/api/v1/sessions/{cls['id']}/report-choice"
    assert client.put(url, json={"participant_id": pid1, "report_included": True}, headers=m2["h"]).status_code == 403
    ok = client.put(url, json={"participant_id": pid1, "report_included": True}, headers=m1["h"])
    assert ok.status_code == 200 and ok.json()["report_included"] is True


def test_종료_취소_클래스는_409(client):
    counselor, cls, joined = _group_with_guest(client, "b2c6@test.com")
    assert client.post(f"/api/v1/sessions/{cls['id']}/end", headers=counselor["h"]).status_code == 200
    assert _put(client, cls, joined, True).status_code == 409

    c2 = _create_class(client, counselor["h"])
    # 취소된 클래스(참여자 없음 → participant 조회 전에 상태 409)
    assert client.post(f"/api/v1/sessions/{c2['id']}/cancel", headers=counselor["h"]).status_code == 200
    r = client.put(f"/api/v1/sessions/{c2['id']}/report-choice",
                   json={"participant_id": str(uuid.uuid4()), "report_included": True})
    assert r.status_code == 409


def test_BT7_제외_동의없는_참여자도_입장_업로드_200_타인_403(client):
    from app.models.session import SessionParticipant

    counselor, cls, joined = _group_with_guest(client, "b2c7@test.com")
    pid = joined["participant_id"]
    db = _db()
    try:  # consent_eeg=False 로 되돌려 게이트 분리를 직접 검증
        p = db.query(SessionParticipant).filter(SessionParticipant.id == uuid.UUID(pid)).first()
        p.consent_eeg = False
        db.commit()
    finally:
        db.close()
    assert _row(pid)["included"] is False and _row(pid)["consent_eeg"] is False

    up = client.post(
        f"/api/v1/sessions/{cls['id']}/features",
        json={"participant_id": pid, "features": [{"second_offset": 0, "relaxation_index": 0.5, "signal_quality": 0.9}]},
    )
    assert up.status_code == 200, up.text
    # consent_* 의미 불변: 업로드가 값을 바꾸지 않는다
    assert _row(pid)["consent_eeg"] is False

    # 타 참여자 id 로 비소유 업로드는 여전히 403 (회원 사칭)
    other = _register(client, "b2m7@test.com", role="client")
    mpid = client.post(f"/api/v1/sessions/by-code/{cls['access_code']}/join", json={}, headers=other["h"]).json()["participant_id"]
    bad = client.post(
        f"/api/v1/sessions/{cls['id']}/features",
        json={"participant_id": mpid, "features": [{"second_offset": 1, "relaxation_index": 0.5, "signal_quality": 0.9}]},
    )
    assert bad.status_code == 403


def test_RV2_8_consent_컬럼_의미_불변_코드입장_opt_in_유지(client):
    _, cls, joined = _group_with_guest(client, "b2c8@test.com")
    row = _row(joined["participant_id"])
    # 코드 자발 참여의 consent_eeg opt-in 기록은 그대로(내보내기 게이트 의미 보존), 리포트 선택은 별개.
    assert row["consent_eeg"] is True and row["included"] is False


def test_BT8_내보내기_게이트는_리포트_선택과_혼용되지_않는다():
    import inspect

    from app.services import export_service

    src = inspect.getsource(export_service)
    assert "report_included" not in src
