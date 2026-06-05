"""LINK BAND EEG 실시간 네임스페이스 `/eeg`

클라이언트→서버: join (세션룸 입장), metrics (1Hz 실시간 지표)
서버→클라이언트: metrics (브로드캐스트 — 상담사 대시보드용), alert (SQI 경고 등)
"""

from app.ws import sio


# ── 세션별 참여자 관리 ──────────────────────────────────────────

_active: dict[str, set[str]] = {}  # session_id → {sid, ...}


def _add_active(session_id: str, sid: str) -> None:
    _active.setdefault(session_id, set()).add(sid)


def _remove_active(session_id: str, sid: str) -> None:
    sids = _active.get(session_id)
    if sids:
        sids.discard(sid)
        if not sids:
            del _active[session_id]


@sio.event(namespace="/eeg")
async def connect(sid, environ, auth):
    return True


@sio.event(namespace="/eeg")
async def disconnect(sid):
    for session_id, sids in list(_active.items()):
        if sid in sids:
            _remove_active(session_id, sid)
            await sio.emit("participant_left", {"sid": sid}, room=session_id, namespace="/eeg")


@sio.on("join", namespace="/eeg")
async def on_join(sid, data):
    session_id = data.get("session_id")
    user_id = data.get("user_id", sid)
    if not session_id:
        return
    await sio.enter_room(sid, session_id, namespace="/eeg")
    _add_active(session_id, sid)
    await sio.emit("participant_joined", {"sid": sid, "user_id": user_id}, room=session_id, namespace="/eeg", skip_sid=sid)


@sio.on("metrics", namespace="/eeg")
async def on_metrics(sid, data):
    """1Hz 실시간 지표 수신 → 세션 룸 전체 브로드캐스트

    data 형식:
    {
        "session_id": "...",
        "user_id": "...",
        "timestamp": 1712345678.9,
        "metrics": {
            "neural_activity": 72,
            "concentration": 65,
            "cognitive_stress": 34,
            "eeg_stress": 28,
            "emotional_balance": 58,
            "relaxation": 71,
            "heart_rate": 72,
            "total_movement": 120,
            "sensor_attached": 1,
            "sqi_fp1": 87,
            "sqi_fp2": 92
        }
    }
    """
    session_id = data.get("session_id")
    if not session_id:
        return

    # 전체 룸에 브로드캐스트 (송신자 제외)
    await sio.emit("metrics", data, room=session_id, namespace="/eeg", skip_sid=sid)

    # SQI 경고 체크
    metrics = data.get("metrics", {})
    sqi_fp1 = metrics.get("sqi_fp1", 100)
    sqi_fp2 = metrics.get("sqi_fp2", 100)
    sensor = metrics.get("sensor_attached", 1)

    if sensor == 0:
        await sio.emit("alert", {
            "type": "sensor_detached",
            "user_id": data.get("user_id"),
            "message": "센서가 분리되었습니다",
            "level": "critical",
        }, room=session_id, namespace="/eeg")
    elif sqi_fp1 < 10 or sqi_fp2 < 10:
        await sio.emit("alert", {
            "type": "sqi_critical",
            "user_id": data.get("user_id"),
            "sqi_fp1": sqi_fp1,
            "sqi_fp2": sqi_fp2,
            "message": "신호 품질 매우 낮음",
            "level": "critical",
        }, room=session_id, namespace="/eeg")
    elif sqi_fp1 < 30 or sqi_fp2 < 30:
        await sio.emit("alert", {
            "type": "sqi_warning",
            "user_id": data.get("user_id"),
            "sqi_fp1": sqi_fp1,
            "sqi_fp2": sqi_fp2,
            "message": "신호 품질 저하",
            "level": "warning",
        }, room=session_id, namespace="/eeg")


async def broadcast_eeg(session_id: str, payload: dict) -> None:
    """서버 내부에서 EEG 데이터 브로드캐스트 시 사용."""
    await sio.emit("metrics", payload, room=session_id, namespace="/eeg")


async def send_alert(session_id: str, alert: dict) -> None:
    """서버 내부에서 경고 전송."""
    await sio.emit("alert", alert, room=session_id, namespace="/eeg")
