"""리포트 발행 E2E 검증 — mock 세션 5개 생성 → 리포트 발행 → narrative 생성 확인.

실행: cd backend && venv/bin/python verify_report_publish.py
"""
import uuid
from datetime import datetime, timedelta, timezone

from app.core.database import SessionLocal
from app.models.eeg_feature import EEGFeatureWindow
from app.models.session import Session, SessionParticipant
from app.services.report_service import generate_report

# test_counsel1@test.com 상담사 user_id (dev 시뮬레이션 계정)
COUNSELOR_ID = uuid.UUID("4f8f44fe-acdf-4802-adea-2c62ff563f84")

# 6지표 전반(0~29초) → 후반(30~59초) 변화 (raw 값)
# 몸: 호흡↓ 심박↓ HRV↑ / 마음: 집중↑ 이완↑ 감정↑
def window_value(i: int, early: float, late: float) -> float:
    return early if i < 30 else late


def make_windows(session_id, participant_id, seed_offset: float):
    windows = []
    for i in range(60):
        # 소폭 노이즈로 현실감 부여 (seed 기반 결정적)
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
    created_reports = 0
    try:
        for n in range(5):
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
                title=f"리포트 발행 검증 {n + 1}",
                location_type="offline",
                participant_mode="one_on_one",
                linkband_mode="optional",
            )
            db.add(session)
            db.flush()

            participant = SessionParticipant(
                session_id=sid, user_id=None, guest_name=f"검증참가자{n + 1}"
            )
            db.add(participant)
            db.flush()

            for w in make_windows(sid, participant.id, seed_offset=n):
                db.add(w)
            db.flush()

            result = generate_report(str(sid), str(COUNSELOR_ID), "counselor", db)
            content = result.get("content") or {}
            eeg = content.get("eeg") or {}
            narrative = eeg.get("narrative") or {}
            print(
                f"[{n + 1}] session={str(sid)[:8]} "
                f"status={result.get('status')} "
                f"narrative_keys={list(narrative.keys())} "
                f"eeg_status={eeg.get('status')} "
                f"normalization_source={eeg.get('normalization_source')}"
            )
            created_reports += 1

        db.commit()
        print(f"\n총 {created_reports}개 리포트 발행 완료")
        return 0
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        print(f"[verify_report_publish] 실패: {exc}")
        import traceback
        traceback.print_exc()
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
