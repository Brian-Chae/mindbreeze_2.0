"""채팅 차단 해제·차단 목록·신고 철회 (fix/chat-unblock)."""

from app.models.chat import ChatBlock, ChatReport
from tests.test_chat import _close_db, _test_db
from tests.test_sdd220_chat_moderation import _direct_pair, _post, _report


def _report_id(client, who, target_id, room_id):
    res = _report(client, who, target_id, room_id=room_id, reason="abuse", operation_key="u-op")
    assert res.status_code == 201, res.text
    return res.json()["report_id"]


def test_차단_목록은_내가_건_것만_나온다(client):
    host, member, room_id = _direct_pair(client, "ub1")
    _report_id(client, member, host["id"], room_id)
    mine = client.get("/api/v1/chat/blocks", headers=member["auth"])
    assert mine.status_code == 200, mine.text
    items = mine.json()["blocks"]
    assert [i["user_id"] for i in items] == [host["id"]]
    assert items[0]["report_id"] and items[0]["report_status"] == "submitted"
    # 차단당한 쪽 목록에는 없다
    assert client.get("/api/v1/chat/blocks", headers=host["auth"]).json()["blocks"] == []


def test_차단_해제하면_다시_대화할_수_있다(client):
    host, member, room_id = _direct_pair(client, "ub2")
    _report_id(client, member, host["id"], room_id)
    assert _post(client, room_id, host).status_code == 403
    res = client.delete(f"/api/v1/chat/blocks/{host['id']}", headers=member["auth"])
    assert res.status_code == 200, res.text
    assert _post(client, room_id, host).status_code == 201
    assert _post(client, room_id, member).status_code == 201
    assert client.get("/api/v1/chat/blocks", headers=member["auth"]).json()["blocks"] == []


def test_차단당한_쪽은_해제할_수_없다(client):
    host, member, room_id = _direct_pair(client, "ub3")
    _report_id(client, member, host["id"], room_id)
    res = client.delete(f"/api/v1/chat/blocks/{member['id']}", headers=host["auth"])
    assert res.status_code == 404
    assert _post(client, room_id, host).status_code == 403


def test_차단_해제_비로그인_401(client):
    assert client.delete("/api/v1/chat/blocks/x").status_code == 401
    assert client.get("/api/v1/chat/blocks").status_code == 401


def test_신고_철회는_본인만_가능하고_멱등이다(client):
    host, member, room_id = _direct_pair(client, "ub4")
    rid = _report_id(client, member, host["id"], room_id)
    assert client.post(f"/api/v1/chat/reports/{rid}/withdraw", headers=host["auth"]).status_code == 404
    res = client.post(f"/api/v1/chat/reports/{rid}/withdraw", headers=member["auth"])
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "withdrawn"
    assert client.post(f"/api/v1/chat/reports/{rid}/withdraw", headers=member["auth"]).status_code == 200
    db_gen, db = _test_db()
    try:
        assert db.query(ChatReport).one().status == "withdrawn"
        assert db.query(ChatBlock).count() == 1  # 철회가 차단을 자동 해제하지는 않는다
    finally:
        _close_db(db_gen)
    items = client.get("/api/v1/chat/blocks", headers=member["auth"]).json()["blocks"]
    assert items[0]["report_status"] == "withdrawn"


def test_처리된_신고는_철회할_수_없다(client):
    host, member, room_id = _direct_pair(client, "ub5")
    rid = _report_id(client, member, host["id"], room_id)
    db_gen, db = _test_db()
    try:
        db.query(ChatReport).update({"status": "resolved"})
        db.commit()
    finally:
        _close_db(db_gen)
    assert client.post(f"/api/v1/chat/reports/{rid}/withdraw", headers=member["auth"]).status_code == 409


def test_없는_신고_철회_404(client):
    host, member, room_id = _direct_pair(client, "ub6")
    assert client.post("/api/v1/chat/reports/not-a-uuid/withdraw", headers=member["auth"]).status_code == 404
