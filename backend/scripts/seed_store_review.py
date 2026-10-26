"""심사 합성 자료 시드. 기본은 무접속 dry-run, --apply는 격리 테스트 DB에만 허용한다.

DATABASE_URL이나 .env를 대상으로 사용하지 않는다. 비밀번호는
STORE_REVIEW_PASSWORD 환경변수로만 받고 출력하지 않는다. 운영 실행 경로는 없다.
"""
import argparse
import os
from pathlib import Path
import sys
import uuid
from datetime import datetime, timezone, timedelta

from sqlalchemy.engine import make_url


def require_test_database(database_url: str) -> None:
    """운영/개발 DB는 로컬 호스트여도 거부한다. SQLite 격리 fixture만 허용한다."""
    url = make_url(database_url)
    if url.get_backend_name() != 'sqlite' or url.host or url.query:
        raise ValueError('격리 SQLite 테스트 DB만 허용됩니다')
    name = url.database or ':memory:'
    if name != ':memory:' and not Path(name).name.startswith('test_store_review_'):
        raise ValueError('test_store_review_ 이름의 격리 테스트 DB가 필요합니다')


def stable_id(key: str) -> uuid.UUID:
    return uuid.uuid5(uuid.NAMESPACE_URL, 'mindbreeze:store-review:' + key)


def seed_review(db, password: str) -> dict[str, int]:
    """호출자가 트랜잭션을 소유한다. 탈퇴·정지 계정은 변경 없이 대체한다."""
    require_test_database(str(db.get_bind().url))
    if len(password) < 12:
        raise ValueError('심사 비밀번호는 12자 이상이어야 합니다')
    import app.models  # noqa: F401
    from sqlalchemy import select
    from app.core.security import hash_password
    from app.models.user import User
    from app.models.onboarding_progress import OnboardingProgress

    users = {}
    created = 0
    for role, label in [('counselor', '예시 진행자'), ('client', '예시 회원')]:
        for generation in range(1000):
            suffix = '' if generation == 0 else f'-{generation}'
            email = f'store-review-{role}{suffix}@example.com'
            user = db.scalar(select(User).where(User.email == email))
            if user is not None and (user.status != 'active' or getattr(user, 'deleted_at', None)):
                continue
            if user is None:
                user = User(id=uuid.uuid4(), email=email, password_hash=hash_password(password),
                            name=label, role=role, status='active', verified_tier='email',
                            notification_preferences={'email': {}, 'push': {}, 'in_app': {}})
                db.add(user)
                db.flush()
                created += 1
            users[role] = user
            break
        else:
            raise ValueError('대체 계정 범위를 초과했습니다')
        if not db.scalar(select(OnboardingProgress).where(OnboardingProgress.user_id == user.id)):
            db.add(OnboardingProgress(user_id=user.id, current_step=1, completed=True,
                                      completed_at=datetime.now(timezone.utc), steps={}))
    seed_synthetic_content(db, users['counselor'], users['client'])
    return {'created_users': created}


FEATURE_WINDOWS = 60
# 진행자 프로필 1 + 클래스·진행자·회원 3 + 회차 1 + 참여 1 + 지표 창 60 + 리포트 2
CONTENT_ROWS_TOTAL = 1 + 3 + 1 + 1 + FEATURE_WINDOWS + 2


def seed_synthetic_content(db, host, member_user, *, dry_run: bool = False) -> dict[str, int]:
    """진행자 프로필·합성 클래스·회차·참여·지표 60창·리포트 2건. stable_id 기준 멱등, 커밋은 호출자가 한다.

    운영 시드(seed_store_review_ops.py)도 이 함수를 쓴다. 서비스 함수를 거치지 않아 초대·알림·outbox가 생기지 않는다.
    dry_run=True면 조회만 하고 새로 만들 행 수만 센다(계정이 아직 없으면 전부 신규).
    """
    if dry_run and (host is None or member_user is None):
        return {'created_rows': CONTENT_ROWS_TOTAL}
    from sqlalchemy import select
    from app.models.counselor_profile import CounselorProfile
    from app.models.class_program import Class, ClassInstructor, ClassMember
    from app.models.session import Session, SessionParticipant
    from app.models.record import Report
    from app.models.eeg_feature import EEGFeatureWindow

    def add(*rows) -> None:
        if not dry_run:
            for row in rows:
                db.add(row)
            db.flush()

    created = 0
    if not db.scalar(select(CounselorProfile).where(CounselorProfile.user_id == host.id)):
        created += 1
        if not dry_run:
            # 서비스와 같은 6자리 발급기(컬럼 String(6)·unique — PG가 길이를 강제한다).
            from app.services.code_service import generate_unique_code

            add(CounselorProfile(user_id=host.id, specialties=[],
                                 counselor_code=generate_unique_code(db, CounselorProfile, 'counselor_code')))
    key = f'{host.id}:{member_user.id}'
    class_id = stable_id(key + ':class')
    session_id = stable_id(key + ':session')
    participant_id = stable_id(key + ':participant')
    member_id = stable_id(key + ':member')
    now = datetime.now(timezone.utc)
    if db.get(Class, class_id) is None:
        created += 3  # 클래스·진행자·회원
        add(Class(id=class_id, created_by=host.id, title='예시 데이터 · 명상 클래스',
                  status='completed', default_duration_min=1, record_audio=False, record_video=False,
                  linkband_mode='optional'))
        add(ClassInstructor(class_id=class_id, user_id=host.id, role='lead', status='active'),
            ClassMember(id=member_id, class_id=class_id, user_id=member_user.id,
                        status='completed', joined_via='host_invite', report_included_default=True))
    if db.get(Session, session_id) is None:
        created += 1
        add(Session(id=session_id, class_id=class_id, seq=1, type='meditation', status='completed',
                    host_id=host.id, host_state='assigned', title='예시 데이터 · 1분 명상', duration_min=1,
                    started_at=now - timedelta(minutes=1), ended_at=now,
                    record_audio=False, record_video=False, linkband_mode='optional'))
    if db.get(SessionParticipant, participant_id) is None:
        created += 1
        add(SessionParticipant(id=participant_id, session_id=session_id, user_id=member_user.id,
                               member_id=member_id, report_included=True, attendance_status='attended',
                               band_connected=False, consent_eeg=False, entered_at=now))
    for index in range(FEATURE_WINDOWS):
        feature_id = stable_id(key + f':feature:{index}')
        if db.get(EEGFeatureWindow, feature_id) is None:
            created += 1
            add(EEGFeatureWindow(id=feature_id, session_id=session_id, user_id=member_user.id,
                                 participant_id=participant_id, window_index=index,
                                 play_group_id='synthetic-review', quality='valid',
                                 focus_index=0.4 + index / 300, relaxation_index=0.5 + index / 400,
                                 stress_index=0.3 - index / 600))
    for role, user in [('counselor', host), ('client', member_user)]:
        report_id = stable_id(key + ':report:' + role)
        if db.get(Report, report_id) is None:
            created += 1
            add(Report(id=report_id, session_id=session_id, participant_id=participant_id,
                       user_id=user.id, type=role, status='completed', generation_status='ready',
                       approved_by_user_id=host.id, approved_at=now,
                       content={'title': '예시 데이터 · 명상 기록',
                                'summary': '합성 예시 데이터입니다. 실제 측정값이 아닙니다.',
                                'source': 'synthetic', 'insights': ['추정 참고 지표'],
                                'counselor_comment': '합성 예시 데이터입니다. 실제 측정값이 아닙니다.',
                                'eeg': {'status': 'valid',
                                        'timeline': [{'t': i, 'concentration': 50 + i / 6,
                                                      'relaxation': 52 + i / 10, 'stress': 40 - i / 10}
                                                     for i in range(FEATURE_WINDOWS)],
                                        'metrics': {'focus_index_stability_score': 62,
                                                    'relaxation_score': 58, 'stress_score': 35}}}))
    return {'created_rows': created}


def run_seed(database_url: str, *, apply: bool = False, password: str | None = None,
             session_factory=None) -> dict:
    require_test_database(database_url)
    if not apply:
        return {'dry_run': True, 'planned_users': 2, 'planned_feature_windows': 60, 'planned_reports': 2}
    if not password or len(password) < 12:
        raise ValueError('STORE_REVIEW_PASSWORD가 필요합니다(12자 이상)')
    engine = None
    if session_factory is None:
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        engine = create_engine(database_url)
        session_factory = sessionmaker(bind=engine)
    try:
        with session_factory() as db:
            with db.begin():
                result = seed_review(db, password)
        return {'dry_run': False, **result}
    finally:
        if engine is not None:
            engine.dispose()


def main(argv=None) -> None:
    parser = argparse.ArgumentParser(description='격리 테스트 DB 심사 합성 자료 시드')
    parser.add_argument('--database-url', required=True, help='격리 SQLite 테스트 DB 주소')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args(argv)
    # 앱 설정을 로드하기 전에 대상부터 검증한다.
    try:
        require_test_database(args.database_url)
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        result = run_seed(args.database_url, apply=args.apply, password=os.environ.get('STORE_REVIEW_PASSWORD'))
    except Exception:
        raise SystemExit('시드 실패: 대상·스키마·비밀번호 정책을 확인하세요(비밀값 출력 없음)') from None
    print('dry-run: 접속·쓰기 없음' if result['dry_run'] else '격리 테스트 시드 완료')


if __name__ == '__main__':
    main()
