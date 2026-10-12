"""REST 폴백으로 저장한 EEG도 호스트 실시간 표시까지 전달한다."""

import asyncio
import pytest

import app.ws.session_live_namespace as ns
from tests.test_sdd024_session_live_ws import (
    _create_group_class,
    _feature,
    _join_guest,
    _register,
    _wire,
)


def test_rest_guest_features_publish_latest_and_aggregate_without_duplicate_replay(client, monkeypatch):
    counselor = _register(client, "rest-live-host@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "폴백 참가자")
    fake = _wire(monkeypatch)
    ns.clear_group_aggregates()
    monkeypatch.setattr(ns, "_schedule", asyncio.run)
    payload = {
        "participant_id": pid,
        "features": [
            _feature(0, relaxation_index=0.4, signal_quality=0.9),
            _feature(1, relaxation_index=0.7, signal_quality=0.9),
        ],
    }

    response = client.post(f"/api/v1/sessions/{cls['id']}/features", json=payload)

    assert response.status_code == 200, response.text
    assert response.json()["saved"] == 2
    eeg = fake.eeg_emits()
    assert len(eeg) == 1
    assert eeg[0]["room"] == f"session:{cls['id']}"
    assert eeg[0]["data"]["participant_id"] == pid
    assert eeg[0]["data"]["feature"]["relaxation_index"] == 0.7
    assert eeg[0]["data"]["saved"] == 2
    aggregates = [e for e in fake.emits if e["event"] == "class:aggregate"]
    assert len(aggregates) == 1
    assert aggregates[0]["room"] == f"session:{cls['id']}"

    duplicate = client.post(f"/api/v1/sessions/{cls['id']}/features", json=payload)
    assert duplicate.json()["saved"] == 0
    assert len(fake.eeg_emits()) == 1


def test_rest_rejected_upload_does_not_publish(client, monkeypatch):
    counselor = _register(client, "rest-denied-host@test.com")
    cls = _create_group_class(client, counselor["h"])
    fake = _wire(monkeypatch)
    monkeypatch.setattr(ns, "_schedule", asyncio.run)

    response = client.post(
        f"/api/v1/sessions/{cls['id']}/features",
        json={"features": [_feature(0, relaxation_index=0.4)]},
    )

    assert response.status_code == 403
    assert fake.eeg_emits() == []


@pytest.mark.parametrize("with_timestamp", [True, False])
def test_rest_backfill_does_not_replace_newer_live_feature(client, monkeypatch, with_timestamp):
    counselor = _register(client, "rest-backfill-host@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "재전송 참가자")
    fake = _wire(monkeypatch)
    monkeypatch.setattr(ns, "_schedule", asyncio.run)
    for offset in (10, 2):
        response = client.post(
            f"/api/v1/sessions/{cls['id']}/features",
            json={"participant_id": pid, "features": [
                _feature(offset, timestamp=1700000000000 + offset * 1000 if with_timestamp else None),
            ]},
        )
        assert response.json()["saved"] == 1
    assert len(fake.eeg_emits()) == 1
    assert fake.eeg_emits()[0]["data"]["feature"]["second_offset"] == 10


@pytest.mark.parametrize("duplicate_timestamp", [10000, 20000])
def test_rest_mixed_duplicate_cannot_publish_unsaved_value(client, monkeypatch, duplicate_timestamp):
    counselor = _register(client, "rest-mixed-host@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "중복 참가자")
    fake = _wire(monkeypatch)
    monkeypatch.setattr(ns, "_schedule", asyncio.run)
    batches = [
        [_feature(10, timestamp=10000, relaxation_index=0.7)],
        [_feature(2, timestamp=2000, relaxation_index=0.4),
         _feature(10, timestamp=duplicate_timestamp, relaxation_index=0.1)],
    ]
    for features in batches:
        response = client.post(
            f"/api/v1/sessions/{cls['id']}/features",
            json={"participant_id": pid, "features": features},
        )
        assert response.status_code == 200, response.text
        assert response.json()["saved"] == 1
    assert len(fake.eeg_emits()) == 1
    assert fake.eeg_emits()[0]["data"]["feature"]["relaxation_index"] == 0.7
