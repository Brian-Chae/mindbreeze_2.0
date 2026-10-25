"""SDD-246 T06 로컬 E2E 합성 시드 — 로컬 PostgreSQL(sdd246_t06_e2e)에만 쓴다. dev/실 환경파일·고객 데이터 미사용.
사용: DATABASE_URL=postgresql://localhost/sdd246_t06_e2e python seed.py init|metric <session_id> <participant_id> <focus>
"""
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

url = os.environ.get("DATABASE_URL", "")
assert url.startswith("postgresql://localhost/") or "127.0.0.1" in url, "로컬 DB 에만 쓴다"
BACKEND = Path(__file__).resolve().parents[4] / "backend"
assert not any((BACKEND / n).exists() for n in (".env", ".env.dev")), "실제 환경파일이 있는 경로에서는 실행하지 않는다"
sys.path.insert(0, str(BACKEND))

from app.core.database import SessionLocal  # noqa: E402
from app.core.security import hash_password  # noqa: E402
import app.models  # noqa: E402,F401
from app.models.class_program import Class, ClassInstructor  # noqa: E402
from app.models.session import Session, SessionParticipant  # noqa: E402
from app.models.user import User  # noqa: E402

PW = "T06-local-pass1!"
OUT = Path("/tmp/t06/seed.json")


def init() -> None:
    with SessionLocal() as db:
        host = User(email=f"t06-host-{uuid.uuid4().hex[:6]}@example.com", password_hash=hash_password(PW), name="합성 강사", role="counselor", status="active", verified_tier="verified")
        db.add(host); db.flush()
        parent = Class(created_by=host.id, title="합성 명상 클래스", default_duration_min=30)
        db.add(parent); db.flush()
        db.add(ClassInstructor(class_id=parent.id, user_id=host.id, role="lead")); db.flush()
        sess = Session(host_id=host.id, class_id=parent.id, seq=1, host_state="assigned", type="meditation", duration_min=30, status="ready",
                       participant_mode="group", max_participants=20, location_type="online")
        db.add(sess); db.flush()
        members = []
        for i in range(2):
            u = User(email=f"t06-m{i}-{uuid.uuid4().hex[:6]}@example.com", password_hash=hash_password(PW), name=f"합성 회원{i}", role="client", status="active", verified_tier="verified")
            db.add(u); db.flush()
            p = SessionParticipant(session_id=sess.id, user_id=u.id, eeg_collection_consented=True)
            db.add(p); db.flush()
            members.append({"user_id": str(u.id), "email": u.email, "participant_id": str(p.id)})
        db.commit()
        # 회차 생성 시점에 v2 로 고정(운영은 session 생성 API 가 _pin_new_run 으로 한다)
        from app.services.session_live_legacy import PROTOCOL_V2, pin_session_protocol
        pin_session_protocol(db, sess.id, protocol=PROTOCOL_V2)
        sess = db.get(Session, sess.id)
        sess.status = "open"  # pin 뒤에 열린 상태로 — 상담사 로비부터 시험한다
        sess.opened_at = datetime.now(timezone.utc)
        db.commit()
        OUT.write_text(json.dumps({"password": PW, "host": {"id": str(host.id), "email": host.email}, "class_id": str(parent.id), "session_id": str(sess.id), "members": members}))
        print(OUT)


def metric(session_id: str, participant_id: str, focus: float, seq: int) -> None:
    """합성 metric 을 outbox 로 주입한다(백엔드 live:metric sink 는 T09 소유라 아직 없음). heartbeat 의 publish 가 방송한다."""
    import time
    from app.models.live_state import LiveSessionEpoch  # noqa: F401
    from app.services.session_live_ledger import append_outbox, lock_epoch
    from sqlalchemy import func, select
    from app.models.live_state import LiveOutbox

    now_ms = int(time.time() * 1000)

    def mv(v, unit):
        return {"value": v, "unit": unit, "validity": "valid", "reason": None, "last_valid_sequence": str(seq), "last_valid_observed_at_ms": now_ms}

    data = {
        "participant_id": participant_id, "stream_id": str(uuid.uuid4()), "sequence": str(seq), "observed_at_ms": now_ms, "freshness": "fresh",
        "sqi": 0.9, "contact": {"fp1": "contact", "fp2": "contact"},
        "metrics": {"focus_display": mv(focus, "score_0_100"), "relaxation_display": mv(focus, "score_0_100"), "emotion_display": mv(focus, "score_0_100"),
                    "bpm": mv(focus, "beats_per_min"), "respiration": mv(focus, "breaths_per_min"), "sdnn": mv(focus, "ms")},
    }
    with SessionLocal() as db:
        er = lock_epoch(db, uuid.UUID(session_id))
        ver = int(db.execute(select(func.coalesce(func.max(LiveOutbox.entity_version), 0)).where(
            LiveOutbox.session_id == uuid.UUID(session_id), LiveOutbox.domain == "metrics", LiveOutbox.entity_id == participant_id)).scalar_one()) + 1
        append_outbox(db, er, domain="metrics", event_type="metrics.updated", entity_id=participant_id, entity_version=ver,
                      audience=["host", f"member:{participant_id}"], payload=data, command_id=None)
        db.commit()
    print("metric appended", seq, focus)


if __name__ == "__main__" and sys.argv[1] == "init":
    init()
elif __name__ == "__main__" and sys.argv[1] == "metric":
    metric(sys.argv[2], sys.argv[3], float(sys.argv[4]), int(sys.argv[5]))
