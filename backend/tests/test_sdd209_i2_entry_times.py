"""SDD-209 I2 — entry-state 가 서버의 시작·종료 시각을 내려 준다 (종료 화면 `함께한 시간` 정확화).

프론트가 처음 본 시각으로 근사하던 값을 서버 값으로 대체한다. 둘 다 본인 소속 클래스의 시각일 뿐 타인 정보가 아니다.
"""

from datetime import datetime

from tests.entry_helpers import enter_guest
from tests.test_sdd015_class_code import _create_class, _open_class, _register


def _state(client, cls, pid):
    # 테스트 클라이언트는 participant_id 쿼리로 해당 참여자의 입장 자격을 자동 첨부한다
    res = client.get(f"/api/v1/sessions/{cls['id']}/entry-state?participant_id={pid}")
    assert res.status_code == 200, res.text
    return res.json()


def _enter(client, cls):
    res = enter_guest(client, cls["access_code"], "시각손님")
    assert res.status_code == 200, res.text
    return res.json()["participant_id"]


def test_열린_클래스는_시작_종료_시각이_null(client):
    host = _register(client, "i2t1@test.com")
    cls = _create_class(client, host["h"])
    _open_class(client, cls, host["h"])
    pid = _enter(client, cls)

    body = _state(client, cls, pid)
    assert body["started_at"] is None
    assert body["ended_at"] is None


def test_시작하면_started_at_이_내려오고_ended_at_은_null(client):
    host = _register(client, "i2t2@test.com")
    cls = _create_class(client, host["h"])
    _open_class(client, cls, host["h"])
    pid = _enter(client, cls)
    assert client.post(f"/api/v1/sessions/{cls['id']}/start", headers=host["h"]).status_code == 200

    body = _state(client, cls, pid)
    assert body["started_at"] is not None
    datetime.fromisoformat(body["started_at"])
    assert body["ended_at"] is None


def test_종료하면_두_시각이_모두_내려오고_시작이_종료보다_앞선다(client):
    host = _register(client, "i2t3@test.com")
    cls = _create_class(client, host["h"])
    _open_class(client, cls, host["h"])
    pid = _enter(client, cls)
    client.post(f"/api/v1/sessions/{cls['id']}/start", headers=host["h"])
    assert client.post(f"/api/v1/sessions/{cls['id']}/end", headers=host["h"]).status_code == 200

    body = _state(client, cls, pid)
    started = datetime.fromisoformat(body["started_at"])
    ended = datetime.fromisoformat(body["ended_at"])
    assert started <= ended
    assert body["ended"] is True


def test_취소된_클래스는_시작_없이_종료_시각도_없다(client):
    host = _register(client, "i2t4@test.com")
    cls = _create_class(client, host["h"])
    _open_class(client, cls, host["h"])
    pid = _enter(client, cls)
    client.post(f"/api/v1/sessions/{cls['id']}/cancel", headers=host["h"])

    body = _state(client, cls, pid)
    assert body["started_at"] is None
