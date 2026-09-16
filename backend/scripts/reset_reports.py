"""리포트 초기화 — 기존 리포트 모두 삭제 후, 성별·생년월일·회원/비회원이 다양한 리포트 3개 생성.

실행: cd backend && venv/bin/python scripts/reset_reports.py
"""
import uuid
from datetime import date, datetime, timedelta, timezone

from app.core.database import SessionLocal
from app.models.eeg_feature import EEGFeatureWindow
from app.models.record import Report
from app.models.session import Session, SessionParticipant
from app.models.user import User
from app.services.report_service import generate_report

# test_counsel1@test.com 상담사 user_id (dev 시뮬레이션 계정)
COUNSELOR_ID = uuid.UUID("4f8f44fe-acdf-4802-adea-2c62ff563f84")
CLIENT_EMAIL = "client@test.com"
REPORT_EMAIL = "brian.chae@looxidlabs.com"


def window_value(i: int, early: float, late: float) -> float:
    return early if i < 30 else late


def make_windows(session_id, participant_id, seed_offset: float):
    windows = []
    for i in range(60):
        jitter = ((i * 7 + seed_offset * 13) % 10) / 100 - 0.05
        windows.append(
            EEGFeatureWindow(
                session_id=session_id,
                participant_id=participant_id,
                window_index=i,
                quality="valid",
                focus_index=round(window_value(i, 0.50, 0.65) + jitter, 4),
                cognitive_load=round(window_value(i, 2.5, 2.0) + jitter, 4),
                relaxation_index=round(window_value(i, 0.40, 0.50) + jitter, 4),
                stress_index=round(window_value(i, 1.5, 1.0) + jitter, 4),
                emotional_stability=round(window_value(i, 2.0, 2.5) + jitter, 4),
                total_neural_activity=round(window_value(i, 400.0, 300.0), 2),
                faa=0.1,
                hemispheric_balance=0.05,
                heart_rate=round(window_value(i, 78.0, 72.0), 1),
                respiratory_rate=round(window_value(i, 16.0, 13.0), 1),
                sdnn=round(window_value(i, 32.0, 40.0), 1),
                rmssd=round(window_value(i, 28.0, 34.0), 1),
            )
        )
    return windows


def main() -> int:
    db = SessionLocal()
    now = datetime.now(timezone.utc)
    try:
        # 1) 기존 리포트 모두 삭제
        deleted = db.query(Report).delete()
        db.commit()
        print(f"기존 리포트 {deleted}개 삭제 완료")

        # 2) 회원(client) user_id 조회
        client_user = db.query(User).filter(User.email == CLIENT_EMAIL).first()
        client_user_id = client_user.id if client_user else None

        # 3) 참여자 3명 구성 (성별·생년월일·회원/비회원 다양)
        participants = [
            {
                "title": "김서연 (내담자)",
                "guest_name": "김서연",
                "user_id": None,
                "gender": "female",
                "birth_date": date(1995, 3, 15),
                "report_email": REPORT_EMAIL,
                "type": "client",
            },
            {
                "title": "박준호 (명상수업)",
                "guest_name": "박준호",
                "user_id": None,
                "gender": "male",
                "birth_date": date(1988, 7, 22),
                "report_email": None,
                "type": "counselor",
            },
            {
                "title": "이하은 (회원)",
                "guest_name": None,
                "user_id": client_user_id,
                "gender": "female",
                "birth_date": date(2001, 11, 5),
                "report_email": None,
                "type": "counselor",
            },
        ]

        created = 0
        for n, p in enumerate(participants):
            sid = uuid.uuid4()
            started = now - timedelta(hours=n + 1)
            ended = started + timedelta(minutes=20)
            session = Session(
                id=sid,
                type="meditation",
                status="completed",
                host_id=COUNSELOR_ID,
                scheduled_at=started,
                started_at=started,
                ended_at=ended,
                duration_min=20,
                title=p["title"],
                location_type="offline",
                participant_mode="one_on_one",
                linkband_mode="optional",
            )
            db.add(session)
            db.flush()

            participant = SessionParticipant(
                session_id=sid,
                user_id=p["user_id"],
                guest_name=p["guest_name"],
                gender=p["gender"],
                birth_date=p["birth_date"],
                report_email=p["report_email"],
            )
            db.add(participant)
            db.flush()

            for w in make_windows(sid, participant.id, seed_offset=n):
                db.add(w)
            db.flush()

            result = generate_report(str(sid), str(COUNSELOR_ID), p["type"], db)
            # client 리포트는 즉시 승인(발행)해서 재발송 대상이 되게 함
            if p["type"] == "client":
                from app.services.report_service import approve_report
                report_id = result.get("id")
                if report_id:
                    approve_report(report_id, str(COUNSELOR_ID), db)
            print(
                f"[{n + 1}] {p['title']} "
                f"type={p['type']} gender={p['gender']} birth={p['birth_date']} "
                f"guest={p['user_id'] is None} status={result.get('status')}"
            )
            created += 1

        db.commit()
        print(f"\n새 리포트 {created}개 생성 완료")
        return 0
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        print(f"[reset_reports] 실패: {exc}")
        import traceback
        traceback.print_exc()
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
