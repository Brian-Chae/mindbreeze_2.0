"""리포트 메일 발송 E2E 검증 — client 리포트 2개 생성 → 승인 → 메일 발송 예약.

실행: cd backend && venv/bin/python verify_report_email.py
"""
import uuid
from datetime import datetime, timedelta, timezone

from app.core.database import SessionLocal
from app.models.eeg_feature import EEGFeatureWindow
from app.models.session import Session, SessionParticipant
from app.services.report_service import generate_report, approve_report

# test_counsel1@test.com 상담사
COUNSELOR_ID = uuid.UUID("4f8f44fe-acdf-4802-adea-2c62ff563f84")
TO_EMAIL = "brian.chae@looxidlabs.com"


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
        for n in range(2):
            sid = uuid.uuid4()
            started = now - timedelta(hours=n + 2)
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
                title=f"메일 발송 검증 {n + 1}",
                location_type="offline",
                participant_mode="one_on_one",
                linkband_mode="optional",
            )
            db.add(session)
            db.flush()

            participant = SessionParticipant(
                session_id=sid,
                user_id=None,
                guest_name=f"메일수신자{n + 1}",
                report_email=TO_EMAIL,
            )
            db.add(participant)
            db.flush()

            for w in make_windows(sid, participant.id, seed_offset=n + 10):
                db.add(w)
            db.flush()

            report = generate_report(str(sid), str(COUNSELOR_ID), "client", db)
            result = approve_report(report["id"], str(COUNSELOR_ID), db)
            print(
                f"[{n + 1}] report_id={report['id'][:8]} "
                f"status={result['status']} "
                f"sent_at={result.get('sent_at') is not None}"
            )

        db.commit()
        print("\n승인 완료 — email_app worker가 메일을 발송합니다.")
        return 0
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        print(f"[verify_report_email] 실패: {exc}")
        import traceback
        traceback.print_exc()
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
