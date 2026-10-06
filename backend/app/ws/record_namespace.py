"""AI 기록지 처리 상태 Socket.IO 네임스페이스 `/record`

클라이언트→서버: subscribe(session_id), unsubscribe(session_id)
서버→클라이언트: record_status (merging→transcribing→diarizing→summarizing→completed/failed)
"""

import logging
from datetime import datetime

logger = logging.getLogger(__name__)


def _get_sio():
    """Lazy import to avoid circular dependency with app.ws.__init__"""
    from app.ws import sio
    return sio


# Socket.IO 이벤트 핸들러 — sio.on 데코레이터를 모듈 레벨에서 사용할 수 없으므로
# app.ws.__init__.py에서 sio 생성 후 수동으로 등록한다.
# 대신 ASGI lifespan 또는 main.py의 startup에서 register_record_namespace(sio)를 호출한다.

def register_record_namespace(sio):
    """app.ws.__init__에서 sio 초기화 후 호출하여 /record 네임스페이스 등록"""

    @sio.event(namespace="/record")
    async def connect(sid, environ, auth):
        token = (auth or {}).get("token")
        user_id = None
        if token:
            try:
                from app.core.security import decode_token
                payload = decode_token(token)
                user_id = payload.get("sub")
                if user_id:
                    logger.info("[WS /record] user %s connected (sid=%s)", user_id, sid)
            except Exception:
                logger.warning("[WS /record] 잘못된 토큰 — 연결 거부 (sid=%s)", sid)
                return False
        await sio.save_session(sid, {"user_id": user_id}, namespace="/record")
        return True

    @sio.event(namespace="/record")
    async def disconnect(sid):
        pass

    @sio.on("subscribe", namespace="/record")
    async def on_subscribe(sid, data):
        data = data if isinstance(data, dict) else {}
        session_id = data.get("session_id")
        if not session_id:
            return
        # 보안: 세션 호스트/참여자만 구독 허용 (임의 session_id 도청 방지)
        session = await sio.get_session(sid, namespace="/record")
        user_id = (session or {}).get("user_id")
        if not user_id:
            logger.warning("[WS /record] 비인가 subscribe 거부 (sid=%s)", sid)
            return
        try:
            from app.core.database import SessionLocal
            from app.services.session_service import _get_session_for_participant

            db = SessionLocal()
            try:
                _get_session_for_participant(session_id, user_id, db)
            finally:
                db.close()
        except Exception:
            logger.warning(
                "[WS /record] 비참여자 subscribe 거부 (sid=%s, session=%s)", sid, session_id
            )
            return
        room = f"session:{session_id}"
        await sio.enter_room(sid, room, namespace="/record")
        logger.info("[WS /record] sid=%s subscribed to %s", sid, room)
        await sio.emit("subscribed", {"session_id": session_id}, to=sid, namespace="/record")

    @sio.on("unsubscribe", namespace="/record")
    async def on_unsubscribe(sid, data):
        data = data if isinstance(data, dict) else {}
        session_id = data.get("session_id")
        if not session_id:
            return
        room = f"session:{session_id}"
        await sio.leave_room(sid, room, namespace="/record")
        logger.info("[WS /record] sid=%s unsubscribed from %s", sid, room)

    logger.info("[WS /record] namespace registered")


async def broadcast_report_progress(session_id: str, payload: dict) -> None:
    """리포트 생성 진행 상태(`report:progress`)를 세션 룸에 브로드캐스트한다.

    SDD-095: 세션 종료 후 STT→요약→리포트 생성이 수 분 걸리는 구간에서
    프론트 스텝퍼가 '처리 중'을 표시할 수 있도록 진행 계약을 push 한다.

    Args:
        session_id: 세션 UUID(문자열)
        payload: report_progress_service.compute_report_progress() 산출 dict
    """
    sio = _get_sio()
    body = dict(payload)
    body["session_id"] = session_id
    # datetime 은 socket.io 기본 serializer(JSON)로 직렬화되지 않는다 → ISO 문자열로 변환
    updated_at = body.get("updated_at")
    if isinstance(updated_at, datetime):
        body["updated_at"] = updated_at.isoformat()
    room = f"session:{session_id}"
    await sio.emit("report:progress", body, room=room, namespace="/record")  # type: ignore
    logger.info(
        "[WS /record] report:progress %s (%s%%) → session:%s",
        body.get("generation_status"),
        body.get("progress"),
        session_id,
    )


async def broadcast_record_status(session_id: str, status: str, detail: dict | None = None) -> None:
    """서버 내부에서 처리 단계 변경 시 브로드캐스트.
    
    Args:
        session_id: 세션 UUID
        status: merging | transcribing | diarizing | summarizing | completed | failed
        detail: 추가 정보 (오류 메시지 등)
    """
    sio = _get_sio()
    payload = {"session_id": session_id, "status": status}
    if detail:
        payload["detail"] = detail  # type: ignore
    room = f"session:{session_id}"
    await sio.emit("record_status", payload, room=room, namespace="/record")  # type: ignore
    logger.info("[WS /record] broadcast %s → session:%s", status, session_id)
