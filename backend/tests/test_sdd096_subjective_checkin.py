"""SDD-096 — 세션 직후 1탭 셀프 체크인(주관 상태) + 리포트 연계 QA

검증 시나리오:
- TS1: 로그인 회원 체크인 → 200 + SessionRecord.subjective_state 저장 + 기록지 노출
- TS2: 밴드 미착용(세션 레코드 없음) 세션도 체크인 시 레코드가 생성된다
- TS3: 내용이 아무것도 없으면 422 (메시지(note)만 남기는 것은 입장 전 체크인에서 허용)
- TS4: 1~5 범위 밖 값은 422
- TS5: 소감 길이 초과(200자 초과)는 422
- TS6: 취소된 세션은 409
- TS7: 게스트 — participant_token 없으면 403, 있으면 저장
- TS8: 다른 참여자(타인 게스트) 슬롯은 덮어쓰지 않는다(참여자별 분리 저장)
- TS9: 기록지 조회 — 상담사는 세션 전체(scope=session), 참여자는 본인 슬롯(scope=participant)
- TS10: 수업 전 예상(before) + 수업 후(after) 대비가 내담자 리포트에 연계된다
- TS11: 체크인 없는 세션의 리포트는 subjective_state=null (0/빈 dict 치환 금지)
"""

from tests.test_member_livekit_token import _join_guest, _start_group_class
from tests.test_sdd015_class_code import _create_class, _register


# ---------------------------------------------------------------------------
# 헬퍼
# ---------------------------------------------------------------------------


def _checkin_url(session_id: str) -> str:
    return f"/api/v1/sessions/{session_id}/checkin"


def _start_class(client, counselor, **overrides) -> dict:
    """그룹 클래스(게스트 1명 포함) 오픈 → 게스트 참여 → 시작."""
    overrides.setdefault("participant_mode", "group")
    overrides.setdefault("max_participants", 20)
    cls, _joined = _start_group_class(client, counselor, **overrides)
    return cls


def _start_one_on_one(client, counselor, member) -> tuple[dict, str]:
    """1:1 클래스 — 회원 1명만 참여(리포트↔참여자 1:1 매칭 검증용)."""
    cls = _create_class(client, counselor["h"])
    assert client.post(f"/api/v1/sessions/{cls['id']}/open", headers=counselor["h"]).status_code == 200
    pid = _join_member(client, cls, member)
    assert client.post(f"/api/v1/sessions/{cls['id']}/start", headers=counselor["h"]).status_code == 200
    return cls, pid


def _join_member(client, cls: dict, member: dict) -> str:
    res = client.post(
        f"/api/v1/sessions/by-code/{cls['access_code']}/join", json={}, headers=member["h"]
    )
    assert res.status_code == 200, res.text
    return res.json()["participant_id"]


def _complete(client, cls: dict, counselor) -> None:
    res = client.post(f"/api/v1/sessions/{cls['id']}/end", headers=counselor["h"])
    assert res.status_code == 200, res.text


def _record(client, cls: dict, counselor) -> dict:
    res = client.get(f"/api/v1/sessions/{cls['id']}/record", headers=counselor["h"])
    assert res.status_code == 200, res.text
    return res.json()


# ---------------------------------------------------------------------------
# 1. 저장 · 조회
# ---------------------------------------------------------------------------


def test_01_회원_체크인_저장_및_기록지_노출(client):
    host = _register(client, "sdd096a@test.com")
    cls = _start_class(client, host)
    member = _register(client, "sdd096a-member@test.com", role="client")
    pid = _join_member(client, cls, member)

    res = client.post(
        _checkin_url(cls["id"]),
        json={"phase": "after", "arousal": 2, "valence": 5, "emotion": 4, "note": "몸이 가벼워졌어요"},
        headers=member["h"],
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["phase"] == "after"
    assert body["participant_id"] == pid
    slot = body["subjective_state"]["after"]
    assert slot["arousal"] == 2 and slot["valence"] == 5 and slot["emotion"] == 4
    assert slot["note"] == "몸이 가벼워졌어요"
    assert slot["recorded_at"]
    assert body["subjective_state"]["before"] is None

    # 기록지에도 주관 상태가 노출된다 — 본인 슬롯 스코프
    rec = client.get(f"/api/v1/sessions/{cls['id']}/record", headers=member["h"]).json()
    assert rec["subjective_state"]["scope"] == "participant"
    assert rec["subjective_state"]["after"]["valence"] == 5
    assert rec["subjective_state"]["after"]["emotion"] == 4


def test_02_밴드미착용_레코드없음_체크인시_레코드_생성(client):
    # LINK BAND 없이 진행한 세션은 SessionRecord 자체가 없다 — 체크인이 남는 기록의 시작점.
    host = _register(client, "sdd096b@test.com")
    cls = _start_class(client, host)
    member = _register(client, "sdd096b-member@test.com", role="client")
    _join_member(client, cls, member)
    assert _record(client, cls, host)["status"] == "idle"

    res = client.post(
        _checkin_url(cls["id"]),
        json={"arousal": 4, "valence": 4},
        headers=member["h"],
    )
    assert res.status_code == 200, res.text
    rec = _record(client, cls, host)
    assert rec["subjective_state"]["scope"] == "session"
    assert len(rec["subjective_state"]["participants"]) == 1
    assert next(iter(rec["subjective_state"]["participants"].values()))["after"]["arousal"] == 4


def test_03_메시지만_허용_내용없으면_422(client):
    # 입장 전 체크인에서는 '상담사에게 전할 말'만 남기는 것도 허용한다(SAM 축 없이 note 만).
    host = _register(client, "sdd096c@test.com")
    cls = _start_class(client, host)
    member = _register(client, "sdd096c-member@test.com", role="client")
    _join_member(client, cls, member)

    note_only = client.post(
        _checkin_url(cls["id"]), json={"phase": "before", "note": "오늘 목이 안 좋아요"}, headers=member["h"]
    )
    assert note_only.status_code == 200, note_only.text
    assert note_only.json()["subjective_state"]["before"]["note"] == "오늘 목이 안 좋아요"
    assert note_only.json()["subjective_state"]["before"]["arousal"] is None

    # 아무 내용도 없으면 422
    res = client.post(_checkin_url(cls["id"]), json={}, headers=member["h"])
    assert res.status_code == 422, res.text

    # 공백만 있는 소감도 None 으로 정규화 → 422
    res = client.post(_checkin_url(cls["id"]), json={"note": "   "}, headers=member["h"])
    assert res.status_code == 422, res.text


def test_04_범위밖_값은_422(client):
    host = _register(client, "sdd096d@test.com")
    cls = _start_class(client, host)
    member = _register(client, "sdd096d-member@test.com", role="client")
    _join_member(client, cls, member)

    for bad in ({"arousal": 6}, {"arousal": 0}, {"valence": 9}, {"emotion": 6}):
        res = client.post(_checkin_url(cls["id"]), json=bad, headers=member["h"])
        assert res.status_code == 422, f"{bad} → {res.status_code}"


def test_05_소감_길이초과_422(client):
    host = _register(client, "sdd096e@test.com")
    cls = _start_class(client, host)
    member = _register(client, "sdd096e-member@test.com", role="client")
    _join_member(client, cls, member)

    res = client.post(
        _checkin_url(cls["id"]),
        json={"valence": 3, "note": "가" * 201},
        headers=member["h"],
    )
    assert res.status_code == 422, res.text


def test_06_취소된_세션은_409(client):
    host = _register(client, "sdd096f@test.com")
    cls = _start_class(client, host)
    member = _register(client, "sdd096f-member@test.com", role="client")
    _join_member(client, cls, member)
    assert client.post(f"/api/v1/sessions/{cls['id']}/cancel", headers=host["h"]).status_code == 200

    res = client.post(_checkin_url(cls["id"]), json={"arousal": 3}, headers=member["h"])
    assert res.status_code == 409, res.text


# ---------------------------------------------------------------------------
# 2. 소유 증명 · 참여자별 분리
# ---------------------------------------------------------------------------


def test_07_게스트_토큰없으면_403_있으면_저장(client):
    host = _register(client, "sdd096g@test.com")
    cls, joined = _start_group_class(client, host)
    pid = joined["participant_id"]

    denied = client.post(
        _checkin_url(cls["id"]), json={"participant_id": pid, "arousal": 3, "valence": 3}
    )
    assert denied.status_code == 403, denied.text

    ok = client.post(
        _checkin_url(cls["id"]),
        json={
            "participant_id": pid,
            "participant_token": joined["participant_token"],
            "arousal": 3,
            "valence": 4,
            "note": "편안했어요",
        },
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["subjective_state"]["after"]["note"] == "편안했어요"


def test_08_타인의_참여자_체크인은_403(client):
    host = _register(client, "sdd096h@test.com")
    cls, joined = _start_group_class(client, host)
    other = _register(client, "sdd096h-other@test.com", role="client")
    _join_member(client, cls, other)

    res = client.post(
        _checkin_url(cls["id"]),
        json={"participant_id": joined["participant_id"], "arousal": 2},
        headers=other["h"],
    )
    assert res.status_code == 403, res.text


def test_09_참여자별_분리저장_및_기록지_스코프(client):
    host = _register(client, "sdd096i@test.com")
    cls, joined = _start_group_class(client, host)
    member = _register(client, "sdd096i-member@test.com", role="client")
    mpid = _join_member(client, cls, member)

    for payload, headers in (
        (
            {"participant_id": joined["participant_id"], "participant_token": joined["participant_token"],
             "arousal": 1, "valence": 2},
            None,
        ),
        ({"arousal": 5, "valence": 4}, member["h"]),
    ):
        res = client.post(_checkin_url(cls["id"]), json=payload, headers=headers or {})
        assert res.status_code == 200, res.text

    # 상담사는 세션 전체(참여자별) 슬롯을 본다
    host_view = _record(client, cls, host)["subjective_state"]
    assert host_view["scope"] == "session"
    assert set(host_view["participants"]) == {joined["participant_id"], mpid}
    assert host_view["participants"][joined["participant_id"]]["after"]["valence"] == 2
    assert host_view["participants"][mpid]["after"]["arousal"] == 5

    # 회원은 본인 슬롯만 — 다른 참여자 소감 비노출
    member_view = client.get(
        f"/api/v1/sessions/{cls['id']}/record", headers=member["h"]
    ).json()["subjective_state"]
    assert member_view["scope"] == "participant"
    assert member_view["after"]["arousal"] == 5
    assert "participants" not in member_view


# ---------------------------------------------------------------------------
# 3. 리포트 연계
# ---------------------------------------------------------------------------


def test_10_수업전예상과_수업후_대비가_리포트에_연계(client):
    host = _register(client, "sdd096j@test.com")
    member = _register(client, "sdd096j-member@test.com", role="client")
    cls, _pid = _start_one_on_one(client, host, member)
    _complete(client, cls, host)

    before = client.post(
        _checkin_url(cls["id"]),
        json={"phase": "before", "arousal": 4, "valence": 2, "note": "긴장될 것 같아요"},
        headers=member["h"],
    )
    assert before.status_code == 200, before.text
    after = client.post(
        _checkin_url(cls["id"]),
        json={"phase": "after", "arousal": 2, "valence": 5, "note": "마음이 가라앉았어요"},
        headers=member["h"],
    )
    assert after.status_code == 200, after.text
    # 한 번의 after 응답이 before/after 슬롯을 함께 돌려준다(대비 렌더 근거)
    state = after.json()["subjective_state"]
    assert state["before"]["arousal"] == 4 and state["before"]["valence"] == 2
    assert state["after"]["arousal"] == 2 and state["after"]["valence"] == 5

    gen = client.post(
        f"/api/v1/reports/generate/{cls['id']}", json={"type": "client"}, headers=host["h"]
    )
    assert gen.status_code == 200, gen.text
    report = gen.json()
    assert report["subjective_state"]["scope"] == "participant"
    assert report["subjective_state"]["before"]["note"] == "긴장될 것 같아요"
    assert report["subjective_state"]["after"]["valence"] == 5


def test_11_체크인없는_리포트는_null(client):
    host = _register(client, "sdd096k@test.com")
    member = _register(client, "sdd096k-member@test.com", role="client")
    cls, _pid = _start_one_on_one(client, host, member)
    _complete(client, cls, host)

    gen = client.post(
        f"/api/v1/reports/generate/{cls['id']}", json={"type": "client"}, headers=host["h"]
    )
    assert gen.status_code == 200, gen.text
    # 미입력은 None — 빈 dict/0 치환 금지
    assert gen.json()["subjective_state"] is None
