"""loadtest_ingest_v3_40.py 단위 검증 — 모의 서버(contract.md 구현)에 40기기 합성 클라이언트를 붙인다.

실행: ~/.hermes/cache/lt40s-venv/bin/python -m pytest backend/scripts/loadtest/test_loadtest_ingest_v3.py -q
dev/운영 서버에는 접속하지 않는다(ASGITransport 직결).
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid

import httpx
import pytest

# 실제 시계를 120배속으로 돌리는 시간 의존 시험이라 실행 환경(CPU·라이브러리 버전)에 따라 결과가 달라진다.
# CI 전체 pytest 에서는 제외하고, 부하 스크립트를 수정했을 때만 LT40S_UNIT=1 로 수동 실행한다.
if os.environ.get("LT40S_UNIT") != "1":
    pytest.skip("LT40S_UNIT=1 일 때만 실행(시간 의존 모의 시험, CI 제외)", allow_module_level=True)

sys.path.insert(0, os.path.dirname(__file__))
import loadtest_ingest_v3_40 as lt  # noqa: E402
from mock_ingest_server import MockState, build_app  # noqa: E402

SID = str(uuid.uuid4())
SCALE = 120.0   # 가상 120배속: 600초 시험 ≈ 5초


def make_members(state: MockState, n: int) -> list[dict]:
    ms = []
    for i in range(n):
        pid, cred, stream = str(uuid.uuid4()), f"cred-{uuid.uuid4()}", str(uuid.uuid4())
        state.creds[cred] = pid
        state.streams_by_pid[pid] = {stream}
        ms.append({"name": f"{lt.PREFIX}게스트-{i + 1:03d}", "participant_id": pid, "entry_credential": cred, "stream_id": stream})
    return ms


def run(scenario: str, devices: int = 40, seconds: int = 600, state: MockState | None = None, hook=None):
    state = state or MockState()
    members = make_members(state, devices)
    if hook:
        hook(state)
    transport = httpx.ASGITransport(app=build_app(state))
    res = asyncio.run(lt.execute(api="http://mock.local", sid=SID, members=members, wearers=devices, seconds=seconds, scenario=scenario,
                                 scale=SCALE, token=None, use_socket=False, seed=7, transport=transport))
    res["verdict"] = lt.judge(res["rows"], seconds, db_on=False, s3_res=None)
    return res, state


def assert_complete(res: dict, seconds: int = 600, devices: int = 40) -> None:
    assert res["devices"] == devices
    for r in res["rows"]:
        assert r["server_windows"] == seconds, r["name"]
        assert r["missing"] == 0 and r["rest_rejected"] == 0
        assert r["raw_server_uploaded"] == r["raw_expected"] == (seconds // lt.CHUNK_SECS) * 3
        assert r["receipt_match"] is True


def test_normal_600_of_600():
    res, st = run("normal")
    assert_complete(res)
    c = res["verdict"]["criteria"]
    assert c["feature_complete"] == c["rest_rejected_0"] == c["raw_100pct"] == c["raw_receipt_match"] == "PASS"
    assert c["s3_100pct"] == "UNVERIFIED" and res["verdict"]["overall"].startswith("CONDITIONAL")   # DB/S3 없이는 PASS 금지
    assert len(st.features) == 40 * 600
    assert st.max_windows_seen <= lt.BATCH_MAX


def test_netdrop_recovers_all():
    res, st = run("netdrop")
    assert res["injected"]["drop"] > 0
    assert_complete(res)


def test_mixed_close_four_groups_recover():
    res, st = run("mixed-close")
    groups = {r["group"] for r in res["rows"]}
    assert groups == {"netdrop3m", "kill_restart", "wifi_off_5m", "normal"}
    assert any(r["detail"].get("restarted") for r in res["rows"] if r["group"] == "kill_restart")
    assert_complete(res)


def test_sockblock_storage_continues():
    res, st = run("sockblock")
    assert_complete(res)   # 소켓은 이 하네스에서 미사용 — 저장은 소켓과 무관함을 확인


def test_dup_resend_is_idempotent():
    res, st = run("dup-resend")
    assert_complete(res)
    assert len(st.features) == 40 * 600
    assert all(r["detail"]["dup_resend"]["rejected_on_resend"] == 0 for r in res["rows"])
    assert res["stats"]["result_status"]["duplicate"] > 0


def test_429_retried_not_lost():
    res, st = run("rate429", hook=lambda s: setattr(s, "presign_429_left", 25))
    assert res["stats"]["retry_429"] > 0
    assert_complete(res)


def test_5xx_retried():
    res, st = run("normal", devices=5, hook=lambda s: setattr(s, "fail_batch_5xx_left", 12))
    assert_complete(res, devices=5)


def test_reject_is_quarantined_and_fails_verdict():
    state = MockState()
    members = make_members(state, 3)
    state.streams_by_pid[members[0]["participant_id"]] = set()   # 첫 기기는 stream 미소유 → stream_not_owned
    transport = httpx.ASGITransport(app=build_app(state))
    res = asyncio.run(lt.execute(api="http://mock.local", sid=SID, members=members, wearers=3, seconds=60, scenario="normal", scale=SCALE,
                                 token=None, use_socket=False, seed=1, transport=transport))
    assert res["stats"]["reject_codes"].get("stream_not_owned") == 60
    v = lt.judge(res["rows"], 60, False, None)
    assert v["criteria"]["feature_complete"] == "FAIL" and v["criteria"]["rest_rejected_0"] == "FAIL" and v["overall"] == "FAIL"


def test_reconcile_resends_missing_after_server_loss():
    """서버가 일부 창을 잃은 상황(저장 직후 유실 가정) → summary 대조 후 재전송으로 서버==로컬."""
    state = MockState()
    members = make_members(state, 2)
    transport = httpx.ASGITransport(app=build_app(state))

    async def go():
        clock = lt.Clock(SCALE)
        stats = lt.Stats()
        m = members[0]
        store = lt.LocalStore(pid=m["participant_id"], sid=SID, cred=m["entry_credential"], name="x", stream_id=m["stream_id"], t0_us=1)
        async with httpx.AsyncClient(transport=transport) as c:
            dev = lt.Device(store, c, "http://mock.local/api/v1", clock, stats, None, __import__("random").Random(1))
            for q in range(120):
                dev.make_window(q)
            await dev.flush_features()
            for q in list(range(30, 50)) + [119]:     # 중간 구간 + 꼬리 유실
                state.features.pop((SID, m["participant_id"], m["stream_id"], q))
            info = await dev.reconcile_features()
            assert info["ok"] and info["resent"] == 21
            assert len([k for k in state.features if k[1] == m["participant_id"]]) == 120

    asyncio.run(go())


def test_parse_feature_summary_semantics():
    j = {"streams": [{"stream_id": "s", "count": 5, "min_index": 2, "max_index": 9, "contiguous_through": -1, "missing_ranges": [[4, 6]], "truncated": False}]}
    assert lt.parse_feature_summary(j, "s") == {2, 3, 7, 8, 9}
    assert lt.parse_feature_summary(j, "other") == set()


def test_receipt_hash_matches_contract_order():
    rows = [("s", "g2", "ppg", 1, "cc", 5), ("s", "g1", "eeg", 0, "aa", 3)]
    import hashlib
    exp = hashlib.sha256("|".join(["s|g1|eeg|0|aa|3", "s|g2|ppg|1|cc|5"]).encode()).hexdigest()
    assert lt.receipt_hash(rows) == exp
    assert lt.receipt_hash(list(reversed(rows))) == exp
