"""AI 기록지 처리 상태 Socket.IO 네임스페이스 `/record`

클라이언트→서버: subscribe(session_id), unsubscribe(session_id)
서버→클라이언트: record_status (merging→transcribing→diarizing→summarizing→completed/failed)
"""

import asyncio
import logging
from datetime import datetime

logger = logging.getLogger(__name__)


def _get_sio():
    """Lazy import to avoid circular dependency with app.ws.__init__"""
    from app.ws import sio
    return sio


def _open_db():
    """WS 핸들러용 DB 세션 팩토리.

    Socket.IO 핸들러는 FastAPI 의존성 주입을 쓸 수 없으므로 SessionLocal 로 직접 연다.
    테스트에서는 이 함수를 monkeypatch 하여 인메모리 세션을 주입한다.
    """
    from app.core.database import SessionLocal
    return SessionLocal()


def _account_is_active(user_id) -> bool:
    """WS-03: 계정 상태를 확인한다 — active 계정만 /record 소켓을 쓸 수 있다.

    Socket.IO connect 는 REST 의 get_current_user 상태 게이트를 우회하므로
    정지(suspended)/대기(pending)/삭제 계정을 여기서 직접 차단한다.
    반드시 `asyncio.to_thread` 로 호출해 이벤트 루프를 막지 않는다(WS-08).
    조회가 불가하면(예외) 보수적으로 비활성 취급해 연결을 막는다.
    """
    from app.models.user import User as UserModel

    db = _open_db()
    try:
        user = db.query(UserModel).filter(UserModel.id == user_id).first()
    except Exception:
        logger.warning(
            "[WS /record] 계정 상태 조회 실패 — 연결 거부 (user=%s)", user_id, exc_info=True
        )
        return False
    finally:
        db.close()
    return user is not None and user.status == "active"


def _authorize_subscribe(session_id, user_id) -> None:
    """SDD-095 구독 권한 검증(동기) — 세션 호스트/참여자만 허용한다.

    `on_subscribe`(async) 안에서 직접 동기 DB 를 호출하면 이벤트 루프가 블로킹되므로
    이 함수를 `asyncio.to_thread` 로 위임한다(WS-08). 비참여자·세션 없음이면 예외를 올린다.
    """
    from app.services.session_service import _get_session_for_participant

    db = _open_db()
    try:
        _get_session_for_participant(session_id, user_id, db)
    finally:
        db.close()


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
            except Exception:
                logger.warning("[WS /record] 잘못된 토큰 — 연결 거부 (sid=%s)", sid)
                return False
            if not user_id:
                logger.warning("[WS /record] 토큰에 sub 없음 — 연결 거부 (sid=%s)", sid)
                return False
            # WS-02: access 토큰만 인정 — refresh 등 비-access 토큰으로 소켓을 열지 못하게 한다.
            if payload.get("type") != "access":
                logger.warning(
                    "[WS /record] 비-access 토큰 — 연결 거부 (sid=%s, type=%s)",
                    sid,
                    payload.get("type"),
                )
                return False
            # WS-03: 정지/대기/삭제 계정은 토큰이 유효해도 소켓을 열지 못하게 한다.
            try:
                active = await asyncio.to_thread(_account_is_active, user_id)
            except Exception:
                active = False
            if not active:
                logger.warning(
                    "[WS /record] 비활성 계정 — 연결 거부 (sid=%s, user=%s)", sid, user_id
                )
                return False
            logger.info("[WS /record] user %s connected (sid=%s)", user_id, sid)
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
            await asyncio.to_thread(_authorize_subscribe, session_id, user_id)
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
    try:
        await sio.emit("report:progress", body, room=room, namespace="/record")  # type: ignore
    except Exception:
        # WS-01: Redis manager 가 런타임에 끊겨도 리포트 생성 파이프라인을 중단시키지 않는다.
        logger.warning(
            "[WS /record] report:progress emit 실패 — 로깅만 하고 계속 (session=%s)",
            session_id,
            exc_info=True,
        )
        return
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
    try:
        await sio.emit("record_status", payload, room=room, namespace="/record")  # type: ignore
    except Exception:
        # WS-01: Redis manager 장애 시에도 상태 브로드캐스트가 파이프라인을 깨지 않도록 로깅만 한다.
        logger.warning(
            "[WS /record] record_status emit 실패 — 로깅만 하고 계속 (status=%s, session=%s)",
            status,
            session_id,
            exc_info=True,
        )
        return
    logger.info("[WS /record] broadcast %s → session:%s", status, session_id)
