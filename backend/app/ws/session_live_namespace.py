"""클래스별 뇌파 실시간 Socket.IO 네임스페이스 `/session-live` (SDD-024 · SDD-026)

밴드 착용 참가자의 1초 EEG feature 를 WS 로 받아
  (a) EEGFeatureWindow 저장 (SDD-023 ingestion 로직 재사용, 멱등)
  (b) 세션 룸의 호스트에게 실시간 브로드캐스트
한다. REST 5초 배치(`POST /sessions/{id}/features`)는 폴백/오프라인 큐로 유지된다.

SDD-026 P0 안전망:
- connect: 잘못된 토큰이면 연결 거부(예외 무시 금지).
- join: 신원·참여자 검증 후 role 별 room 분리.
    · 호스트 → 전체 수신 룸 `session:{id}`  (모든 참가자 feature 수신)
    · 게스트/회원 → 본인 전용 룸 `session:{id}:self:{participant_id}`  (본인만)
    · 상태 이벤트 공용 룸 `session:{id}:all`  (호스트+참가자 공통)
  게스트는 전체 수신 룸에 들어가지 못하므로 게스트 간 EEG 가 노출되지 않는다.
- join snapshot: status/state_version/started_at + (호스트)참가자 목록·집계 / (게스트)본인 상태.
- 서버 내부 이벤트: session_state_changed / participant_changed / device_status_changed.

클라이언트→서버: join(session_id[, participant_id]), leave(session_id), feature(data),
                 class:signal(data), waiting_room(data),   ← 개선 5 무음 시그널 / 개선 3 대기실
                 class:audio_sync(data)                    ← 개선 10 가이드·BGM 재생 제어(상담사)
서버→클라이언트: joined, join_denied, eeg_feature, class:signal(호스트 전용),
                 class:aggregate(호스트 전용 — 개선 8 그룹 익명 집계),
                 class:audio_sync(세션 공용 룸 — 개선 10 동기 재생 타임코드),
                 session_state_changed, participant_changed, device_status_changed,
                 waiting_room_changed(호스트 전용)  ← 개선 3 대기실 입장/퇴장

개선 10(명상 가이드·BGM 동기 재생): 상담사가 트는 가이드 음성·BGM 을 회원 화면에서 같은
소스·같은 위치로 재생한다. 상담사 플레이어가 play/pause/seek/stop 을 올리면 서버가 재생
타임코드(server_ts + position_sec)를 만들어 세션 공용 룸(호스트+참여자)에 브로드캐스트하고,
회원은 서버 시계와의 오차를 보정해 position_sec 기준으로 정렬한다. 볼륨은 회원별 개별
설정이라 payload 에 없다(회원이 각자 조절 — 스피커 뮤트와 무관하게 헤드셋 경유 재생).
마지막 재생 상태는 세션별로 보관해 **늦게 입장한 회원**도 같은 위치로 합류한다.

개선 5(무음 시그널): 기본 뮤트 1:N 수업에서 회원이 발언권(손들기) 없이도 "잘 따라가요 /
조금 어려워요 / 잠시 쉴게요"를 상담사에게만 조용히 전달한다. DB 에 저장하지 않는 휘발성
상태이며 참여자당 최신 1건만 TTL(_QUIET_SIGNAL_TTL_SEC) 동안 집계에 남는다.

개선 8(그룹 익명 집계·적응형 페이싱): 밴드 착용자들의 이완도·집중도를 개인 baseline 대비
상대값으로 익명 집계(평균 + 안정 비율)해 상담사에게만 `class:aggregate` 로 내보낸다.
개인 점수·순위는 payload 에 존재하지 않으며, 착용자가 MIN_WEARERS 미만이면 점수를 만들지 않고
sample_status="insufficient"(표본 적음)로 알린다. 계산은 AGGREGATE_INTERVAL_SEC 주기로 제한한다.
"""

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any, cast

from socketio.exceptions import ConnectionRefusedError

logger = logging.getLogger(__name__)

_NAMESPACE = "/session-live"

# 개선 5: 무음 시그널 이벤트명(클라이언트→서버 emit / 서버→호스트 브로드캐스트 공용)
QUIET_SIGNAL_EVENT = "class:signal"

# 신호 유형 — "잘 따라가요 / 조금 어려워요 / 잠시 쉴게요"
QUIET_SIGNAL_TYPES: tuple[str, ...] = ("following", "difficult", "resting")

# 활성 신호 유지 시간(초) — 이 시간이 지난 신호는 집계에서 빠진다(카드 표시는 FE 가 더 짧게 처리)
QUIET_SIGNAL_TTL_SEC = 10.0

# 세션별 활성 신호: session_id(str) -> {participant_id(str): (signal_type, monotonic_ts)}
# 참여자가 신호를 보낼 때마다 최신 1건으로 덮어쓴다(참여자당 1표 — 집계 왜곡 방지).
_active_signals: dict[str, dict[str, tuple[str, float]]] = {}

# 개선 8: 그룹 익명 집계 상태 지표(적응형 페이싱) — 상담사 전용 이벤트명
GROUP_AGGREGATE_EVENT = "class:aggregate"

# 집계 브로드캐스트 주기(초). 참가자가 매초 feature 를 올리므로 그때마다 집계하면 DB 비용이
# 참여자 수 × 초 만큼 늘어난다. 상담사 판단에 5초 지연은 충분히 짧다.
AGGREGATE_INTERVAL_SEC = 5.0

# 세션별 마지막 집계 발행 시각(monotonic) — throttle 상태
_last_aggregate_at: dict[str, float] = {}


def aggregate_due(session_id, *, at: float | None = None) -> bool:
    """세션별 집계 발행 주기 판정(throttle).

    판정과 동시에 발행 시각을 기록하므로, 호출측은 True 일 때만 실제 집계를 계산하면 된다
    (매 feature 마다 그룹 전체를 다시 집계하지 않게 하는 것이 목적).
    at 은 테스트 주입 지점 — 운영 경로에서는 단조 시각을 쓴다.
    """
    sid = str(session_id)
    stamp = time.monotonic() if at is None else at
    last = _last_aggregate_at.get(sid)
    if last is not None and stamp - last < AGGREGATE_INTERVAL_SEC:
        return False
    _last_aggregate_at[sid] = stamp
    return True


def clear_group_aggregates() -> None:
    """집계 throttle 상태 전역 초기화(테스트/세션 종료 정리용)."""
    _last_aggregate_at.clear()

# sync(REST) 컨텍스트에서 async 브로드캐스트를 예약하기 위한 이벤트 루프 참조.
# connect 핸들러(루프 안에서 실행)에서 캡처한다. 캡처 전(테스트 등)에는 None → 발행 생략.
_loop: asyncio.AbstractEventLoop | None = None


def _get_sio():
    """circular import 회피용 lazy import (app.ws.__init__)"""
    from app.ws import sio
    return sio


def _open_db():
    """WS 핸들러용 DB 세션 팩토리.

    Socket.IO 핸들러는 FastAPI 의존성 주입을 쓸 수 없으므로 SessionLocal 로 직접 연다.
    테스트에서는 이 함수를 monkeypatch 하여 인메모리 세션을 주입한다.
    """
    from app.core.database import SessionLocal
    return SessionLocal()


def _jsonify(value):
    """datetime 등을 JSON 직렬화 가능한 형태로 재귀 변환(WS emit 안전)."""
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: _jsonify(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonify(v) for v in value]
    return value


def _room_all(session_id) -> str:
    """상태 이벤트 공용 룸(호스트+참가자)"""
    return f"session:{session_id}:all"


def _room_host(session_id) -> str:
    """호스트 전체 수신 룸(모든 참가자 EEG)"""
    return f"session:{session_id}"


def _room_self(session_id, participant_id) -> str:
    """참가자 본인 전용 룸"""
    return f"session:{session_id}:self:{participant_id}"


# 개선 3: 대기실 닉네임 표시 상한 — 화면·툴팁에만 쓰이는 값이라 짧게 자른다.
_WAITING_ROOM_NICKNAME_MAX = 20


def _sanitize_nickname(value) -> str | None:
    """대기실 표시용 닉네임을 정리한다(표시 전용 — 신원 판정에는 쓰지 않는다)."""
    if not isinstance(value, str):
        return None
    cleaned = " ".join(value.split())[:_WAITING_ROOM_NICKNAME_MAX]
    return cleaned or None


# 입장 전 체크인 요약(기분 SAM 2축 + 상담사 전달 메시지) — 대기실 실시간 표시 전용.
# 저장은 REST(/sessions/{id}/checkin)가 하고, WS 는 상담사 화면에 요약만 흘린다.
_WAITING_ROOM_CHECKIN_NOTE_MAX = 200


def _sanitize_checkin(value) -> dict | None:
    """입장 전 체크인 요약을 정리한다(표시 전용 — 신원 판정·저장에는 쓰지 않는다).

    value = {"arousal": 1~5|None, "valence": 1~5|None, "note": str|None}
    세 값이 모두 비면 None 을 돌려 대기실 이벤트에 실리지 않게 한다.
    """
    if not isinstance(value, dict):
        return None

    def _sam(v) -> int | None:
        if isinstance(v, bool) or not isinstance(v, int):
            return None
        return v if 1 <= v <= 5 else None

    arousal = _sam(value.get("arousal"))
    valence = _sam(value.get("valence"))
    emotion = _sam(value.get("emotion"))

    note_raw = value.get("note")
    note: str | None = None
    if isinstance(note_raw, str):
        note = " ".join(note_raw.split())[:_WAITING_ROOM_CHECKIN_NOTE_MAX] or None

    if arousal is None and valence is None and emotion is None and note is None:
        return None
    return {"arousal": arousal, "valence": valence, "emotion": emotion, "note": note}


# ---------------------------------------------------------------------------
# 개선 5: 무음 시그널 — 활성 신호 집계 (DB 저장 없는 휘발성 상태)
# ---------------------------------------------------------------------------


def _prune_active_signals(session_id: str, now: float) -> None:
    """TTL 이 지난 활성 신호를 제거한다(만료 시 세션 키도 정리 — 메모리 누수 방지)."""
    entries = _active_signals.get(session_id)
    if not entries:
        return
    for pid, (_, at) in list(entries.items()):
        if now - at >= QUIET_SIGNAL_TTL_SEC:
            del entries[pid]
    if not entries:
        _active_signals.pop(session_id, None)


def record_quiet_signal(
    session_id, participant_id, signal_type: str, *, at: float | None = None
) -> None:
    """참여자의 최신 무음 시그널을 활성 맵에 기록한다(참여자당 1건으로 덮어씀)."""
    stamp = time.monotonic() if at is None else at
    entries = _active_signals.setdefault(str(session_id), {})
    entries[str(participant_id)] = (signal_type, stamp)


def quiet_signal_counts(session_id, *, now: float | None = None) -> dict:
    """활성(TTL 이내) 신호의 유형별 집계 — {"following", "difficult", "resting", "total"}."""
    sid = str(session_id)
    stamp = time.monotonic() if now is None else now
    _prune_active_signals(sid, stamp)
    entries = _active_signals.get(sid, {})
    counts = {signal_type: 0 for signal_type in QUIET_SIGNAL_TYPES}
    for signal_type, _ in entries.values():
        if signal_type in counts:
            counts[signal_type] += 1
    counts["total"] = len(entries)
    return counts


def clear_quiet_signals() -> None:
    """활성 신호 전역 초기화(테스트/세션 종료 정리용)."""
    _active_signals.clear()


def build_quiet_signal_payload(
    session_id,
    participant_id,
    signal_type: str,
    display_name: str | None = None,
    *,
    at: float | None = None,
) -> dict:
    """무음 시그널 브로드캐스트 payload 를 만든다 (집계 카운트 포함).

    at 은 테스트용 주입 지점(TTL 검증) — 운영 경로에서는 단조 시각을 쓴다.
    """
    stamp = time.monotonic() if at is None else at
    record_quiet_signal(session_id, participant_id, signal_type, at=stamp)
    return {
        "session_id": str(session_id),
        "participant_id": str(participant_id),
        "signal_type": signal_type,
        "display_name": display_name,
        # WS 직렬화 안전을 위해 ISO 문자열로 내보낸다 (datetime 객체 그대로 emit 금지)
        "at": datetime.now(timezone.utc).isoformat(),
        "counts": quiet_signal_counts(session_id, now=stamp),
    }


def register_session_live_namespace(sio):
    """app.ws.__init__ 에서 sio 초기화 후 호출하여 `/session-live` 네임스페이스 등록"""

    @sio.event(namespace=_NAMESPACE)
    async def connect(sid, environ, auth):
        # SDD-026: 무토큰은 게스트로 허용하되, 토큰이 있으면 반드시 유효해야 한다.
        # 잘못된 토큰은 예외를 무시하지 않고 연결을 거부(False)한다.
        global _loop
        try:
            _loop = asyncio.get_running_loop()
        except RuntimeError:
            _loop = None

        user_id = None
        token = (auth or {}).get("token")
        if token:
            try:
                from app.core.security import decode_token
                payload = decode_token(token)
                user_id = payload.get("sub")
            except Exception:
                logger.warning("[WS /session-live] 잘못된 토큰 — 연결 거부 (sid=%s)", sid)
                raise ConnectionRefusedError("token_expired")
            if not user_id:
                logger.warning("[WS /session-live] 토큰에 sub 없음 — 연결 거부 (sid=%s)", sid)
                raise ConnectionRefusedError("token_expired")
            logger.info("[WS /session-live] user %s connected (sid=%s)", user_id, sid)

        await sio.save_session(sid, {"user_id": user_id}, namespace=_NAMESPACE)
        return True

    @sio.event(namespace=_NAMESPACE)
    async def disconnect(sid):
        pass

    @sio.on("join", namespace=_NAMESPACE)
    async def on_join(sid, data):
        data = data or {}
        session_id = data.get("session_id")
        if not session_id:
            return
        participant_id = data.get("participant_id")
        session = await sio.get_session(sid, namespace=_NAMESPACE)
        current_user_id = (session or {}).get("user_id")

        resolved = await asyncio.to_thread(
            _resolve_join, session_id, current_user_id, participant_id
        )
        if resolved is None:
            # SDD-026: 비인가 join — 어떤 room 에도 입장시키지 않고 거부를 통지한다.
            logger.warning("[WS /session-live] join 거부 (sid=%s, session=%s)", sid, session_id)
            await sio.emit(
                "join_denied", {"session_id": str(session_id)}, to=sid, namespace=_NAMESPACE
            )
            return

        role = resolved["role"]
        pid = resolved["participant_id"]
        snapshot = _jsonify(resolved["snapshot"])

        # leave/feature 판정에 쓰도록 세션 컨텍스트 갱신
        await sio.save_session(
            sid,
            {
                "user_id": current_user_id,
                "role": role,
                "participant_id": pid,
                "session_id": str(session_id),
            },
            namespace=_NAMESPACE,
        )

        # 상태 이벤트 공용 룸(호스트+참가자)
        await sio.enter_room(sid, _room_all(session_id), namespace=_NAMESPACE)
        if role == "host":
            await sio.enter_room(sid, _room_host(session_id), namespace=_NAMESPACE)
        else:
            await sio.enter_room(sid, _room_self(session_id, pid), namespace=_NAMESPACE)

        logger.info("[WS /session-live] sid=%s joined session=%s as %s", sid, session_id, role)
        await sio.emit(
            "joined",
            {
                "session_id": str(session_id),
                "role": role,
                "participant_id": pid,
                "snapshot": snapshot,
            },
            to=sid,
            namespace=_NAMESPACE,
        )

        # 개선 8: 상담사는 join 즉시 그룹 익명 집계 게이지를 받아야 한다 — throttle 을 건너뛰고
        # 본인 소켓으로만 1건 발행한다(첫 feature 를 기다리면 게이지가 빈 채로 남는다).
        if role == "host":
            await publish_group_aggregate(session_id, force=True, to=sid)

        # 개선 10: 늦게 입장한 회원은 진행 중인 가이드·BGM 에 같은 위치로 합류한다.
        # (상담사 본인은 자기 플레이어가 원본이므로 replay 하지 않는다 — 자기 명령을 되받을 필요 없음)
        if role != "host":
            state = audio_state_for(session_id)
            if state is not None:
                await sio.emit(AUDIO_SYNC_EVENT, state, to=sid, namespace=_NAMESPACE)
                logger.info("[WS /session-live] %s replay → sid=%s", AUDIO_SYNC_EVENT, sid)

    @sio.on("leave", namespace=_NAMESPACE)
    async def on_leave(sid, data):
        data = data or {}
        session_id = data.get("session_id")
        if not session_id:
            return
        session = await sio.get_session(sid, namespace=_NAMESPACE)
        pid = (session or {}).get("participant_id")
        # 입장했을 수 있는 모든 룸에서 퇴장(멱등 — 없으면 무시)
        await sio.leave_room(sid, _room_host(session_id), namespace=_NAMESPACE)
        await sio.leave_room(sid, _room_all(session_id), namespace=_NAMESPACE)
        if pid:
            await sio.leave_room(sid, _room_self(session_id, pid), namespace=_NAMESPACE)
        logger.info("[WS /session-live] sid=%s left session=%s", sid, session_id)

    @sio.on("feature", namespace=_NAMESPACE)
    async def on_feature(sid, data):
        """참가자가 보낸 1초 EEG feature → 저장 + 호스트 룸 브로드캐스트.

        data = {
            "session_id": str,
            "participant_id": str | None,   # 게스트 식별 (로그인 참가자는 connect 토큰의 user_id 사용)
            "feature": { second_offset, delta_power, ..., signal_quality, play_group_id, band_battery }
        }
        """
        data = data or {}
        session_id = data.get("session_id")
        feature = data.get("feature")
        if not session_id or not feature:
            return
        participant_id = data.get("participant_id")
        session = await sio.get_session(sid, namespace=_NAMESPACE)
        current_user_id = (session or {}).get("user_id")

        try:
            saved, resolved_participant_id, feature_out = await asyncio.to_thread(
                _store_feature, session_id, participant_id, current_user_id, feature
            )
        except Exception:
            # 비참가자/미식별/대리 업로드/미동의 등 저장 실패 시 브로드캐스트하지 않는다
            logger.warning("[WS /session-live] feature 저장 실패 (sid=%s, session=%s)", sid, session_id)
            return

        # SDD-026: 전체 참가자 EEG 는 호스트 전체 수신 룸으로만 브로드캐스트한다.
        # 게스트는 이 룸에 없으므로 타 참가자 EEG 가 노출되지 않는다(게스트 간 비노출).
        await broadcast_session_eeg(
            session_id,
            {
                "participant_id": resolved_participant_id,
                "feature": feature_out,
                "saved": saved,
            },
        )

        # 개선 8: 그룹 익명 집계(적응형 페이싱) — 주기(AGGREGATE_INTERVAL_SEC)마다 한 번만 계산해
        # 상담사 룸에 브로드캐스트한다. 개인 점수는 payload 에 담지 않는다.
        await publish_group_aggregate(session_id)

    @sio.on("class:signal", namespace=_NAMESPACE)
    async def on_quiet_signal(sid, data):
        """개선 5: 무음 시그널 — 회원/게스트의 비언어 상태 신호를 상담사에게 전달한다.

        data = {
            "session_id": str,
            "participant_id": str | None,   # 게스트 식별(로그인 회원은 connect 토큰의 user_id 사용)
            "signal_type": "following" | "difficult" | "resting",
        }

        - 발언권(손들기/부여)과 독립 — 발언권 없이도 전송할 수 있고 발언권 상태를 바꾸지 않는다.
        - DB 저장 없는 휘발성 신호이며 호스트 룸에만 브로드캐스트한다(다른 참여자에게 비노출).
        - 진행 단계(open/in_progress/paused)에서만 반영하고, 그 외(완료·취소 등)는 무시한다.
        """
        data = data or {}
        session_id = data.get("session_id")
        signal_type = data.get("signal_type")
        if not session_id or signal_type not in QUIET_SIGNAL_TYPES:
            return

        session = await sio.get_session(sid, namespace=_NAMESPACE)
        current_user_id = (session or {}).get("user_id")
        # join 이후에는 세션 컨텍스트의 participant_id 를 신뢰한다(게스트 본인 룸 스코프)
        participant_id = data.get("participant_id") or (session or {}).get("participant_id")

        try:
            sender = await asyncio.to_thread(
                _resolve_quiet_signal_sender, session_id, participant_id, current_user_id
            )
        except Exception:
            # 비참가자/미식별/사칭 → 브로드캐스트하지 않는다
            logger.warning(
                "[WS /session-live] class:signal 발신자 검증 실패 (sid=%s, session=%s)",
                sid,
                session_id,
            )
            return

        from app.services import session_service

        if sender.get("status") not in session_service.QUIET_SIGNAL_SESSION_STATUSES:
            logger.info(
                "[WS /session-live] class:signal 무시 — 진행 단계 아님 (session=%s, status=%s)",
                session_id,
                sender.get("status"),
            )
            return

        payload = build_quiet_signal_payload(
            session_id,
            sender["participant_id"],
            signal_type,
            sender.get("display_name"),
        )
        await broadcast_quiet_signal(session_id, payload)

    @sio.on("waiting_room", namespace=_NAMESPACE)
    async def on_waiting_room(sid, data):
        """개선 3: 대기실 입장/퇴장 알림 → 호스트(상담사) 룸 브로드캐스트.

        data = {"session_id": str, "action": "join" | "leave", "nickname": str | None}

        - 신원은 join 시 저장된 세션 컨텍스트(role/participant_id)로만 판정한다 —
          클라이언트가 보낸 participant_id 를 신뢰하지 않으므로 대기 상태를 위조할 수 없다.
        - 대기 목록은 서버에 저장하지 않는다(휘발성). 호스트 클라이언트가 heartbeat TTL 로
          정리하므로 탭 강제 종료·단절에도 인원이 수렴한다.
        """
        data = data or {}
        session_id = data.get("session_id")
        action = data.get("action")
        if not session_id or action not in ("join", "leave"):
            return

        session = await sio.get_session(sid, namespace=_NAMESPACE) or {}
        # 이 소켓이 join 한 세션과 일치해야 한다(타 세션 위조 차단)
        if session.get("session_id") != str(session_id):
            logger.warning("[WS /session-live] waiting_room 무시 — join 불일치 (sid=%s)", sid)
            return
        # 참가자(회원/게스트)만 대상 — 호스트(role="host")는 대기 인원이 아니다
        if session.get("role") != "participant" or not session.get("participant_id"):
            logger.warning("[WS /session-live] waiting_room 무시 — 참가자 아님 (sid=%s)", sid)
            return

        await broadcast_waiting_room(
            session_id,
            {
                "participant_id": session["participant_id"],
                "action": action,
                "nickname": _sanitize_nickname(data.get("nickname")),
                "checkin": _sanitize_checkin(data.get("checkin")),
                "readiness": _sanitize_readiness(data.get("readiness")),
            },
        )

    @sio.on("waiting_room_remind", namespace=_NAMESPACE)
    async def on_waiting_room_remind(sid, data):
        if not isinstance(data, dict):
            return {"ok": False, "error": "잘못된 요청입니다."}
        session_id = data.get("session_id")
        session = await sio.get_session(sid, namespace=_NAMESPACE) or {}
        if session.get("role") != "host" or session.get("session_id") != session_id:
            return {"ok": False, "error": "상담사만 안내를 보낼 수 있습니다."}
        targets = data.get("participant_ids")
        if not isinstance(targets, list) or not targets or len(targets) > 500 or not all(isinstance(pid, str) for pid in targets):
            return {"ok": False, "error": "대상 참가자를 확인해 주세요."}
        try:
            resolved = await asyncio.to_thread(
                _resolve_join, session_id, session.get("user_id"), None
            )
            if not resolved or resolved.get("role") != "host":
                return {"ok": False, "error": "상담사 권한을 확인해 주세요."}
            allowed = {str(p["participant_id"]) for p in resolved["snapshot"].get("participants", [])}
            targets = list(dict.fromkeys(targets))
            if not set(targets).issubset(allowed):
                return {"ok": False, "error": "이 세션의 참가자만 선택해 주세요."}
            for participant_id in targets:
                await sio.emit("waiting_room_reminder", {
                    "session_id": session_id,
                    "message": "상담사가 준비 상태 확인을 부탁했어요. 설문·링크밴드·기기를 확인해 주세요. 건너뛰어도 괜찮아요.",
                }, room=_room_self(session_id, participant_id), namespace=_NAMESPACE)
            return {"ok": True, "sent": len(targets)}
        except Exception:
            logger.exception("대기실 리마인드 전송 실패")
            return {"ok": False, "error": "안내를 보내지 못했습니다. 다시 시도해 주세요."}

    @sio.on(AUDIO_SYNC_EVENT, namespace=_NAMESPACE)
    async def on_class_audio_sync(sid, data):
        """개선 10: 명상 가이드·BGM 재생 제어 → 세션 공용 룸 브로드캐스트(상담사 전용).

        data = {
            "session_id": str,
            "action": "play" | "pause" | "seek" | "stop",
            "track_id": str | None,        # 재생 소스 식별자(카탈로그 track_id)
            "position_sec": float,         # 재생 위치(초) — 서버가 서버 시각과 함께 배포
        }

        - 상담사(role="host")만 제어할 수 있다 — 회원/게스트가 올린 제어는 무시한다
          (아무나 클래스의 가이드·BGM 을 멈추거나 바꿀 수 없게 한다).
        - join 으로 저장된 세션 컨텍스트와 session_id 가 일치해야 한다(타 세션 위조 차단).
        - play 는 카탈로그에 등록된 track_id 만 허용한다(미등록 트랙 재생 차단).
        - 위치는 서버가 정규화(0~24h, ms 단위)하고 서버 시각(server_ts/_ms)을 함께 내보낸다.
        - 마지막 재생 상태는 세션별로 보관해 **늦게 입장한 회원**에게 같은 위치로 replay 한다.
        """
        data = data or {}
        session_id = data.get("session_id")
        action = data.get("action")
        if not session_id or action not in AUDIO_SYNC_ACTIONS:
            return

        session = await sio.get_session(sid, namespace=_NAMESPACE) or {}
        # 이 소켓이 join 한 세션과 일치해야 한다(타 세션 위조 차단)
        if session.get("session_id") != str(session_id):
            logger.warning("[WS /session-live] %s 무시 — join 불일치 (sid=%s)", AUDIO_SYNC_EVENT, sid)
            return
        # 상담사(호스트)만 — 회원/게스트의 재생 제어는 브로드캐스트하지 않는다
        if session.get("role") != "host":
            logger.warning("[WS /session-live] %s 무시 — 상담사 아님 (sid=%s)", AUDIO_SYNC_EVENT, sid)
            return

        track_id = data.get("track_id")
        if track_id is not None and not isinstance(track_id, str):
            return
        # play 는 등록된 트랙만 — 없는 트랙을 재생하라고 지시하면 회원 화면이 무음이 된다
        if action == "play" and not _is_known_audio_track(track_id):
            logger.warning(
                "[WS /session-live] %s 무시 — 미등록 트랙 (session=%s, track_id=%s)",
                AUDIO_SYNC_EVENT,
                session_id,
                track_id,
            )
            return

        position = audio_position_from_payload(data)
        if position is None:
            logger.warning("[WS /session-live] %s 무시 — 위치 값 부적합 (sid=%s)", AUDIO_SYNC_EVENT, sid)
            return

        try:
            host = await asyncio.to_thread(
                _resolve_audio_host, session_id, session.get("user_id")
            )
        except Exception:
            logger.warning(
                "[WS /session-live] %s 발신자 검증 실패 (sid=%s, session=%s)",
                AUDIO_SYNC_EVENT,
                sid,
                session_id,
            )
            return

        if host.get("status") not in AUDIO_SYNC_SESSION_STATUSES:
            logger.info(
                "[WS /session-live] %s 무시 — 진행 단계 아님 (session=%s, status=%s)",
                AUDIO_SYNC_EVENT,
                session_id,
                host.get("status"),
            )
            return

        payload = build_audio_sync_payload(session_id, action, track_id, position)
        record_audio_state(session_id, payload)
        await broadcast_audio_sync(session_id, payload)

    logger.info("[WS /session-live] namespace registered")


def _resolve_join(session_id, current_user_id, participant_id):
    """join 권한 판정을 서비스 레이어에 위임(전용 DB 세션)."""
    from app.services import session_service

    db = _open_db()
    try:
        return session_service.resolve_live_join(session_id, current_user_id, participant_id, db)
    finally:
        db.close()


def _resolve_quiet_signal_sender(session_id, participant_id, current_user_id):
    """무음 시그널 발신자 검증을 서비스 레이어에 위임(전용 DB 세션).

    비참가자·미식별·타인 participant_id 사칭이면 HTTPException 을 올린다
    (호출측 핸들러가 예외를 흡수해 브로드캐스트하지 않는다).
    """
    from app.services import session_service

    db = _open_db()
    try:
        return session_service.resolve_signal_sender(
            session_id, participant_id, current_user_id, db
        )
    finally:
        db.close()


def _resolve_audio_host(session_id, current_user_id):
    """개선 10: 재생 제어 발신자(세션 호스트) 검증을 서비스 레이어에 위임.

    호스트가 아니거나 세션이 없으면 HTTPException 을 올린다
    (호출측 핸들러가 예외를 흡수해 브로드캐스트하지 않는다).
    """
    from app.services import session_service

    db = _open_db()
    try:
        return session_service.resolve_audio_sync_host(session_id, current_user_id, db)
    finally:
        db.close()


def _is_known_audio_track(track_id) -> bool:
    """카탈로그에 등록된 트랙인가 — play 명령의 미등록 track_id 차단용."""
    from app.services import class_audio_service

    return class_audio_service.is_known_track(track_id)


def _store_feature(session_id, participant_id, current_user_id, feature):
    """단일 EEG feature 를 검증·저장한다(SDD-023 ingestion 로직 재사용).

    반환: (saved_count, resolved_participant_id(str), normalized_feature(dict))
    """
    from app.models.session import Session
    from app.schemas.session import EEGFeatureItem
    from app.services import session_service

    item = EEGFeatureItem.model_validate(feature)
    db = _open_db()
    try:
        sid = session_service._to_uuid(session_id)
        s = db.query(Session).filter(Session.id == sid).first()
        if not s:
            raise ValueError("세션을 찾을 수 없습니다")
        participant = session_service.resolve_upload_participant(sid, participant_id, current_user_id, db)
        saved = session_service.persist_feature_windows(sid, participant, [item], db)
        # 공통 입력 계약 전체를 전송: 마음 지표 + BPM·호흡수·HRV, 미측정은 null.
        return saved, str(participant.id), item.model_dump()
    finally:
        db.close()


# ---------------------------------------------------------------------------
# 서버 내부 브로드캐스트 헬퍼 (다른 모듈에서도 호출 가능)
# ---------------------------------------------------------------------------


async def broadcast_session_eeg(session_id: str, feature: dict) -> None:
    """세션의 호스트 전체 수신 룸에 실시간 EEG feature 를 브로드캐스트한다.

    Args:
        session_id: 세션 UUID(str)
        feature: 브로드캐스트 payload (participant_id, feature, saved 등)
    """
    sio = _get_sio()
    room = _room_host(session_id)
    payload = {"session_id": str(session_id), **feature}
    await sio.emit("eeg_feature", payload, room=room, namespace=_NAMESPACE)
    logger.info("[WS /session-live] broadcast eeg_feature → %s", room)


async def broadcast_session_state(session_id: str, payload: dict) -> None:
    """세션 상태 변경(start/pause/resume/end/cancel)을 공용 룸에 브로드캐스트한다."""
    sio = _get_sio()
    room = _room_all(session_id)
    await sio.emit(
        "session_state_changed",
        {"session_id": str(session_id), **payload},
        room=room,
        namespace=_NAMESPACE,
    )
    logger.info("[WS /session-live] broadcast session_state_changed → %s", room)


async def broadcast_participant(session_id: str, payload: dict) -> None:
    """참가자 구성 변경(입장/퇴장/대기열)을 호스트 전체 수신 룸에 브로드캐스트한다."""
    sio = _get_sio()
    room = _room_host(session_id)
    await sio.emit(
        "participant_changed",
        {"session_id": str(session_id), **payload},
        room=room,
        namespace=_NAMESPACE,
    )
    logger.info("[WS /session-live] broadcast participant_changed → %s", room)


async def broadcast_speaking(session_id: str, payload: dict) -> None:
    """SDD-094: 발언권(손들기/부여·해제) 변경을 호스트 룸 + 해당 참가자 본인 룸에 브로드캐스트한다.

    상담사는 참여자 목록의 손들기/발언권 표시를 갱신하고,
    회원 본인은 speaking_changed 를 받아 LiveKit 토큰을 재발급(카메라/마이크 on/off)한다.
    """
    sio = _get_sio()
    body = {"session_id": str(session_id), **payload}
    await sio.emit("speaking_changed", body, room=_room_host(session_id), namespace=_NAMESPACE)
    pid = payload.get("participant_id")
    if pid:
        await sio.emit(
            "speaking_changed", body, room=_room_self(session_id, pid), namespace=_NAMESPACE
        )
    logger.info("[WS /session-live] broadcast speaking_changed → session:%s", session_id)


async def broadcast_device_status(session_id: str, payload: dict) -> None:
    """기기 상태 변경(연결/배터리)을 호스트 룸 + 해당 참가자 본인 룸에 브로드캐스트한다."""
    sio = _get_sio()
    body = {"session_id": str(session_id), **payload}
    await sio.emit("device_status_changed", body, room=_room_host(session_id), namespace=_NAMESPACE)
    pid = payload.get("participant_id")
    if pid:
        await sio.emit(
            "device_status_changed", body, room=_room_self(session_id, pid), namespace=_NAMESPACE
        )
    logger.info("[WS /session-live] broadcast device_status_changed → session:%s", session_id)


async def broadcast_quiet_signal(session_id: str, payload: dict) -> None:
    """개선 5: 무음 시그널을 상담사(호스트) 룸에만 브로드캐스트한다.

    기본 뮤트 1:N 수업에서 회원의 상태 신호는 상담사에게만 전달돼야 하므로
    공용 룸(`:all`)이나 참여자 본인 룸으로는 내보내지 않는다(참여자 간 비노출).
    """
    sio = _get_sio()
    room = _room_host(session_id)
    await sio.emit(
        QUIET_SIGNAL_EVENT,
        {"session_id": str(session_id), **payload},
        room=room,
        namespace=_NAMESPACE,
    )
    logger.info("[WS /session-live] broadcast %s → %s", QUIET_SIGNAL_EVENT, room)


async def broadcast_waiting_room(session_id: str, payload: dict) -> None:
    """개선 3: 대기실 입장/퇴장을 상담사(호스트) 룸에만 브로드캐스트한다.

    대기 인원은 상담사 관제용이므로 공용 룸(`:all`)이나 참여자 본인 룸으로는 내보내지 않는다.
    """
    sio = _get_sio()
    room = _room_host(session_id)
    await sio.emit(
        "waiting_room_changed",
        {"session_id": str(session_id), **payload},
        room=room,
        namespace=_NAMESPACE,
    )
    logger.info("[WS /session-live] broadcast waiting_room_changed → %s", room)


async def broadcast_audio_sync(session_id: str, payload: dict, *, to: str | None = None) -> None:
    """개선 10: 가이드·BGM 재생 타임코드를 세션 공용 룸(호스트+참여자)에 브로드캐스트한다.

    - 세션 공용 룸(`:all`)으로 내보내 회원 화면이 모두 같은 위치로 정렬되게 한다
      (무음 시그널·집계와 달리 **참여자에게 반드시 전달되어야 하는** 이벤트다).
    - payload 에는 볼륨이 없다 — 볼륨은 회원별 개별 설정이다.
    - to 지정 시 해당 소켓 1개(늦게 입장한 회원 replay)로만 보낸다.
    """
    sio = _get_sio()
    body = {"session_id": str(session_id), **payload}
    if to:
        await sio.emit(AUDIO_SYNC_EVENT, body, to=to, namespace=_NAMESPACE)
        logger.info("[WS /session-live] emit %s → sid=%s", AUDIO_SYNC_EVENT, to)
        return
    room = _room_all(session_id)
    await sio.emit(AUDIO_SYNC_EVENT, body, room=room, namespace=_NAMESPACE)
    logger.info("[WS /session-live] broadcast %s → %s", AUDIO_SYNC_EVENT, room)


# ---------------------------------------------------------------------------
# 개선 8: 그룹 익명 집계(적응형 페이싱) — 상담사 전용
# ---------------------------------------------------------------------------


def _compute_group_aggregate(session_id) -> dict | None:
    """집계 계산을 서비스 레이어에 위임(전용 DB 세션). 실패는 삼키고 집계만 생략한다."""
    from app.services import group_aggregate as group_aggregate_service

    db = _open_db()
    try:
        return group_aggregate_service.compute_group_aggregate(session_id, db)
    except Exception:
        logger.warning(
            "[WS /session-live] 그룹 집계 계산 실패 (session=%s)", session_id, exc_info=True
        )
        return None
    finally:
        db.close()


async def broadcast_group_aggregate(session_id: str, payload: dict, *, to: str | None = None) -> None:
    """개선 8: 그룹 익명 집계를 상담사에게만 브로드캐스트한다.

    - to 지정 시 해당 소켓 1개(상담사 join 직후), 미지정 시 호스트 룸 전체.
    - 공용 룸(`:all`)·참여자 본인 룸으로는 절대 내보내지 않는다. 집계 평균은 개인 값을
      역산할 수 있는 정보이므로 회원에게 노출하지 않는다(점수 경쟁 방지).
    """
    sio = _get_sio()
    body = {"session_id": str(session_id), **payload}
    if to:
        await sio.emit(GROUP_AGGREGATE_EVENT, body, to=to, namespace=_NAMESPACE)
        logger.info("[WS /session-live] emit %s → sid=%s", GROUP_AGGREGATE_EVENT, to)
        return
    room = _room_host(session_id)
    await sio.emit(GROUP_AGGREGATE_EVENT, body, room=room, namespace=_NAMESPACE)
    logger.info("[WS /session-live] broadcast %s → %s", GROUP_AGGREGATE_EVENT, room)


async def publish_group_aggregate(
    session_id, *, force: bool = False, to: str | None = None
) -> dict | None:
    """그룹 익명 집계를 계산해 (주기가 되었으면) 발행한다.

    returns 발행 여부와 무관하게 계산된 payload(계산 실패 시 None).
    - force=True: throttle 을 무시하고 즉시 발행(상담사 join 직후 1건).
    """
    if force:
        _last_aggregate_at[str(session_id)] = time.monotonic()
    elif not aggregate_due(session_id):
        return None

    payload = await asyncio.to_thread(_compute_group_aggregate, session_id)
    if payload is None:
        return None

    await broadcast_group_aggregate(session_id, payload, to=to)
    return payload


# ---------------------------------------------------------------------------
# 개선 10: 명상 가이드·BGM 동기 재생 — 재생 타임코드 브로드캐스트 (상담사 → 세션 룸)
# ---------------------------------------------------------------------------

# 재생 제어 이벤트명(클라이언트→서버 emit / 서버→세션 룸 브로드캐스트 공용)
AUDIO_SYNC_EVENT = "class:audio_sync"

# 재생 제어 액션 — play/pause/seek/stop 만 허용한다(그 외 값은 무시).
# · seek 는 위치 이동과 정기 재동기(heartbeat)에 함께 쓴다 — 회원은 위치만 맞추면 된다.
AUDIO_SYNC_ACTIONS: tuple[str, ...] = ("play", "pause", "seek", "stop")

# 재생 제어를 허용하는(진행 단계) 세션 상태 — 대기실(open)·진행·일시정지
AUDIO_SYNC_SESSION_STATUSES: tuple[str, ...] = ("open", "in_progress", "paused")

# 위치 상한(초) — 비정상 값으로 payload 가 오염되지 않게 잘라 넣는다(24시간)
AUDIO_SYNC_MAX_POSITION_SEC = 86400.0

# 위치 소수 자릿수 — 밀리초 단위면 근사 동기에 충분하고 payload 크기도 작다
AUDIO_SYNC_POSITION_DECIMALS = 3

# 마지막 재생 상태를 늦게 입장한 회원에게 replay 해 주는 유효 시간(초).
# 이보다 오래된 상태는 재생 중일 가능성이 낮아(호스트 이탈 등) replay 하지 않는다.
AUDIO_SYNC_STATE_TTL_SEC = 3600.0

# 세션별 마지막 재생 상태: session_id(str) -> (payload(dict), monotonic_ts)
_audio_states: dict[str, tuple[dict, float]] = {}

# 세션별 재생 명령 순번 — 역순 도착(네트워크 재정렬) 방어용. 회원은 더 큰 revision 만 적용한다.
_audio_revisions: dict[str, int] = {}


def normalize_audio_position(value) -> float | None:
    """재생 위치(초)를 검증·정규화한다. 숫자가 아니면 None(호출측이 무시)."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if value != value:  # NaN
        return None
    try:
        position = float(value)
    except (TypeError, ValueError):
        return None
    if position < 0:
        position = 0.0
    if position > AUDIO_SYNC_MAX_POSITION_SEC:
        position = AUDIO_SYNC_MAX_POSITION_SEC
    return round(position, AUDIO_SYNC_POSITION_DECIMALS)


def audio_position_from_payload(data: dict) -> float | None:
    """클라이언트 payload 의 위치 필드(position_sec)를 읽는다(누락 시 0)."""
    if "position_sec" not in data:
        return 0.0
    return normalize_audio_position(data.get("position_sec"))


def next_audio_revision(session_id) -> int:
    """세션별 재생 명령 순번을 1씩 올려 돌려준다."""
    sid = str(session_id)
    revision = _audio_revisions.get(sid, 0) + 1
    _audio_revisions[sid] = revision
    return revision


def build_audio_sync_payload(
    session_id,
    action: str,
    track_id: str | None = None,
    position_sec: float = 0.0,
    *,
    now: datetime | None = None,
) -> dict:
    """재생 타임코드 payload 를 만든다.

    서버가 시각을 찍는 이유: 클라이언트끼리 시계가 달라도 **서버 도착 시각**을 기준으로
    경과 시간을 계산하면 상담사·회원의 재생 위치가 수렴한다(회원은 server_ts_ms 로
    로컬 시계 오차를 보정한다).
    """
    stamp = now if now is not None else datetime.now(timezone.utc)
    position = normalize_audio_position(position_sec)
    return {
        "session_id": str(session_id),
        "action": action,
        "track_id": track_id,
        "position_sec": 0.0 if position is None else position,
        # WS 직렬화 안전을 위해 ISO 문자열 + epoch(ms) 를 함께 내보낸다
        "server_ts": stamp.isoformat(),
        "server_ts_ms": int(stamp.timestamp() * 1000),
        "revision": next_audio_revision(session_id),
    }


def record_audio_state(session_id, payload: dict, *, at: float | None = None) -> None:
    """늦게 입장하는 회원에게 replay 할 마지막 재생 상태를 보관한다(휘발성 — DB 저장 없음).

    stop 은 재생할 것이 없으므로 상태를 지운다(다음 입장자는 아무것도 듣지 않는다).
    """
    sid = str(session_id)
    if payload.get("action") == "stop":
        _audio_states.pop(sid, None)
        return
    _audio_states[sid] = (dict(payload), time.monotonic() if at is None else at)


def clear_audio_states() -> None:
    """재생 상태·순번 전역 초기화(테스트/세션 종료 정리용)."""
    _audio_states.clear()
    _audio_revisions.clear()


def audio_state_for(session_id, *, now: float | None = None) -> dict | None:
    """세션의 마지막 재생 상태(유효 시간 이내). 없으면 None."""
    sid = str(session_id)
    entry = _audio_states.get(sid)
    if entry is None:
        return None
    payload, stored_at = entry
    stamp = time.monotonic() if now is None else now
    if stamp - stored_at >= AUDIO_SYNC_STATE_TTL_SEC:
        _audio_states.pop(sid, None)
        return None
    return dict(payload)


# ---------------------------------------------------------------------------
# sync → async 브리지 (REST/서비스 레이어에서 이벤트 발행)
# ---------------------------------------------------------------------------


def _schedule(coro) -> None:
    """캡처한 이벤트 루프에 코루틴을 예약한다. 루프가 없으면(테스트 등) 발행을 생략한다."""
    loop = _loop
    if loop is not None:
        try:
            asyncio.run_coroutine_threadsafe(coro, loop)
            return
        except Exception:
            pass
    # 실행 중 루프 없음 — "coroutine never awaited" 경고 방지 후 생략
    coro.close()


def notify_session_state_changed(session_id: str, payload: dict) -> None:
    _schedule(broadcast_session_state(session_id, _jsonify(payload)))


def notify_session_eeg(session_id: str, payload: dict) -> None:
    """REST 폴백 저장 이후 호스트 EEG 표시와 기존 주기의 그룹 집계를 발행한다."""
    _schedule(broadcast_session_eeg(session_id, _jsonify(payload)))
    _schedule(publish_group_aggregate(session_id))


def notify_participant_changed(session_id: str, payload: dict) -> None:
    _schedule(broadcast_participant(session_id, _jsonify(payload)))


def notify_device_status_changed(session_id: str, payload: dict) -> None:
    _schedule(broadcast_device_status(session_id, _jsonify(payload)))


def notify_speaking_changed(session_id: str, payload: dict) -> None:
    """SDD-094: 발언권 변경 이벤트를 예약 발행한다(REST/서비스 레이어 → 호스트+본인 룸)."""
    _schedule(broadcast_speaking(session_id, _jsonify(payload)))


def notify_audio_sync(session_id: str, payload: dict) -> None:
    """개선 10: 재생 타임코드를 예약 발행한다(서비스 레이어 → 세션 공용 룸).

    세션 종료 등으로 재생을 멈춰야 할 때 호출한다(호스트 브라우저가 닫힌 경우의 안전망).
    """
    body = cast("dict[str, Any]", _jsonify(payload))
    _schedule(broadcast_audio_sync(session_id, body))


def _sanitize_readiness(value):
    """완료 여부는 실제 boolean 세 필드가 모두 있을 때만 신뢰한다."""
    fields = ("surveyDone", "bandDone", "deviceDone")
    if not isinstance(value, dict) or not all(type(value.get(key)) is bool for key in fields):
        return None
    return {key: value[key] for key in fields}
