"""스토어 심사 전용 계정·합성 샘플 시드 — 운영 PostgreSQL용 (대표님 결정 D6, 2026-10-24 승인).

만드는 것: 진행자 1·회원 1 심사 전용 계정(store-review-{counselor,client}@example.com),
진행자 개인 상담소(실제 가입 경로와 같은 구조), 합성 클래스·회차·참여·지표 60창·리포트 2건
(실제 개인정보 0, `seed_store_review.seed_synthetic_content` 재사용).

안전장치
- 기본은 dry-run: 읽기 전용 트랜잭션에서 계획만 출력한다(쓰기·비밀 파일 생성 0). `--apply`를 줄 때만 기록한다.
- 운영 가드: ENVIRONMENT=production/prod 이거나 로컬·dev RDS가 아닌 DB면 `--allow-production` 없이는 **접속 전에** 거부한다.
  SQLite는 거부한다(격리 SQLite 시드는 seed_store_review.py).
- 발송 0: 서비스 함수(초대·알림·outbox)를 거치지 않고 DB에 직접 넣는다. 두 계정의 이메일·푸시 알림 설정은 전부 끈다.
  기기 토큰은 만들지 않는다.
- 비밀번호: 실행 시 생성해 gitignore된 비밀 파일(기본 backend/.secrets/store-review-accounts.json, 디렉터리 700·파일 600)에만
  적는다. 화면·로그·예외 메시지에 출력하지 않는다. 파일은 DB 커밋 직전에 원자적으로 쓴다
  (커밋이 실패하면 다음 실행이 해시 불일치를 감지해 새 비밀번호로 바꾼다).
- 멱등: 재실행 시 행 중복 0. 비밀 파일의 비밀번호가 DB 해시와 맞으면 유지하고, 파일이 없거나 맞지 않는 계정만 새로 발급한다.
- 탈퇴(deleted) 계정은 되살리지 않고 `-1`, `-2` … 새 주소로 대체한다. `--deactivate`로 정지(suspended)한 계정은
  다음 `--apply`에서 다시 활성화한다.

사용(대상 환경의 .env가 로드된 backend/ 에서):
  python scripts/seed_store_review_ops.py                              # dry-run(계획만)
  python scripts/seed_store_review_ops.py --apply                      # dev/로컬 기록
  python scripts/seed_store_review_ops.py --apply --allow-production   # 운영 기록(OPS, 승인 후)
  python scripts/seed_store_review_ops.py --deactivate [--apply] [--allow-production]  # 심사 후 비활성
"""

from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from sqlalchemy.engine import make_url  # noqa: E402

DEFAULT_SECRETS_PATH = BACKEND / ".secrets" / "store-review-accounts.json"
ROLES: tuple[tuple[str, str], ...] = (("counselor", "예시 진행자"), ("client", "예시 회원"))
MAX_GENERATIONS = 1000
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}
DEV_RDS = re.compile(r"mindbreeze-dev\.[a-z0-9-]+\.[a-z0-9-]+\.rds\.amazonaws\.com")
ALLOWED_QUERY = {"sslmode", "connect_timeout", "application_name"}


def review_email(role: str, generation: int) -> str:
    suffix = "" if generation == 0 else f"-{generation}"
    return f"store-review-{role}{suffix}@example.com"


def require_ops_target(environment: str, database_url: str, *, allow_production: bool) -> str:
    """접속 전에 대상을 판정한다. 반환: 'local' | 'dev' | 'production'. URL·비밀값은 메시지에 넣지 않는다."""
    try:
        url = make_url(database_url)
    except Exception:
        raise ValueError("DATABASE_URL 형식을 해석할 수 없습니다") from None
    if url.get_backend_name() != "postgresql":
        raise ValueError("PostgreSQL 대상만 허용합니다(격리 SQLite는 seed_store_review.py)")
    # host/hostaddr/service 등으로 실제 접속 대상을 바꾸는 우회를 막는다.
    if set(url.query) - ALLOWED_QUERY:
        raise ValueError("허용하지 않는 접속 옵션이 DATABASE_URL에 있습니다")
    host = (url.host or "").lower()
    production_env = environment.strip().lower() in {"production", "prod"}
    if not production_env and (not host or host in LOCAL_HOSTS):
        return "local"
    if not production_env and DEV_RDS.fullmatch(host):
        return "dev"
    if not allow_production:
        raise ValueError("운영(또는 dev·로컬이 아닌) DB입니다. 승인된 실행이면 --allow-production을 함께 주세요")
    return "production"


def suppressed_notification_preferences() -> dict[str, dict[str, bool]]:
    """이메일·푸시는 모든 이벤트를 끈다. 인앱은 앱 안에서만 보이므로 기본값을 둔다."""
    from app.models.user import DEFAULT_NOTIFICATION_PREFERENCES
    from app.services.notification_service import EVENT_CATALOG

    def off(channel: str) -> dict[str, bool]:
        keys = set(DEFAULT_NOTIFICATION_PREFERENCES.get(channel, {})) | set(EVENT_CATALOG)
        return {key: False for key in sorted(keys)}

    return {"email": off("email"), "push": off("push"), "in_app": dict(DEFAULT_NOTIFICATION_PREFERENCES["in_app"])}


# ── 비밀 파일 ──────────────────────────────────────────────────────────


def load_secrets(path: Path) -> dict[str, str]:
    """email → password. 파일이 없거나 깨졌으면 빈 값(해당 계정은 새 비밀번호로 회전된다)."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return {}
    accounts = data.get("accounts") if isinstance(data, dict) else None
    if not isinstance(accounts, list):
        return {}
    return {a["email"]: a["password"] for a in accounts
            if isinstance(a, dict) and isinstance(a.get("email"), str) and isinstance(a.get("password"), str)}


def write_secrets(path: Path, accounts: list[dict[str, str]], target: str) -> None:
    """임시 파일(600)에 쓴 뒤 rename — 중간 상태 파일이나 넓은 권한이 남지 않는다."""
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(path.parent, 0o700)
    payload = {
        "purpose": "MIND BREEZE 스토어 심사 전용 계정(합성 데이터). 심사 메모에만 보안 채널로 전달.",
        "target": target,
        "written_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "accounts": accounts,
    }
    fd, tmp = tempfile.mkstemp(prefix=".store-review-", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
        os.chmod(path, 0o600)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


# ── 계획·적용 ──────────────────────────────────────────────────────────


def _resolve(db, role: str):
    """역할의 현재 심사 계정을 찾는다. 탈퇴 계정은 건너뛰고 다음 주소를 쓴다. 반환 (email, user|None)."""
    from sqlalchemy import select
    from app.models.user import User

    for generation in range(MAX_GENERATIONS):
        email = review_email(role, generation)
        user = db.scalar(select(User).where(User.email == email))
        if user is not None and (user.status == "deleted" or getattr(user, "deleted_at", None)):
            continue
        if user is not None and user.role != role:
            raise ValueError("심사 계정 주소를 다른 역할이 쓰고 있습니다. 확인이 필요합니다")
        return email, user
    raise ValueError("대체 계정 범위를 초과했습니다")


def _password_ok(user, stored: dict[str, str]) -> bool:
    from app.core.security import verify_password

    password = stored.get(user.email)
    return bool(password) and verify_password(password, user.password_hash)


def plan(db, stored: dict[str, str]) -> dict[str, Any]:
    """조회만 한다. 계정별 할 일과 새로 만들 합성 행 수."""
    from seed_store_review import seed_synthetic_content

    accounts, users = [], {}
    for role, _label in ROLES:
        email, user = _resolve(db, role)
        users[role] = user
        if user is None:
            action = "create"
        elif user.status != "active":
            action = "reactivate"
        else:
            action = "keep"
        password = "new" if user is None or not _password_ok(user, stored) else "keep"
        accounts.append({"role": role, "email": email, "action": action, "password": password})
    content = seed_synthetic_content(db, users["counselor"], users["client"], dry_run=True)
    return {"accounts": accounts, "content_rows_to_create": content["created_rows"]}


def apply(db, secrets_path: Path, target: str, *, generate: Callable[[], str] | None = None) -> dict[str, Any]:
    """계정·합성 자료를 만들고 비밀 파일을 쓴다. 커밋은 호출자가 한다(파일은 커밋 직전 상태로 기록)."""
    import app.models  # noqa: F401
    from sqlalchemy import select
    from app.core.security import hash_password
    from app.models.onboarding_progress import OnboardingProgress
    from app.models.user import User
    from seed_store_review import seed_synthetic_content

    generate = generate or (lambda: secrets.token_urlsafe(18))
    stored = load_secrets(secrets_path)
    prefs = suppressed_notification_preferences()
    users: dict[str, Any] = {}
    accounts_out: list[dict[str, str]] = []
    summary: list[dict[str, str]] = []
    for role, label in ROLES:
        email, user = _resolve(db, role)
        action = "keep"
        if user is None:
            password = generate()
            user = User(id=uuid.uuid4(), email=email, password_hash=hash_password(password), name=label,
                        role=role, status="active", verified_tier="email", notification_preferences=prefs)
            db.add(user)
            db.flush()
            action, password_action = "create", "new"
        else:
            if user.status != "active":
                user.status, action = "active", "reactivate"
            if _password_ok(user, stored):
                password, password_action = stored[email], "keep"
            else:
                password, password_action = generate(), "new"
                user.password_hash = hash_password(password)
            user.notification_preferences = prefs
        if not db.scalar(select(OnboardingProgress).where(OnboardingProgress.user_id == user.id)):
            db.add(OnboardingProgress(user_id=user.id, current_step=1, completed=True,
                                      completed_at=datetime.now(timezone.utc), steps={}))
        users[role] = user
        accounts_out.append({"role": role, "email": email, "password": password})
        summary.append({"role": role, "email": email, "action": action, "password": password_action})
    content = seed_synthetic_content(db, users["counselor"], users["client"])
    db.flush()
    write_secrets(secrets_path, accounts_out, target)
    return {"accounts": summary, "content_rows_created": content["created_rows"]}


def deactivate(db, *, dry_run: bool) -> dict[str, Any]:
    """심사 후 비활성 — 활성 심사 계정을 suspended로 바꾸고 로그인 토큰을 지운다(로그인 403)."""
    from sqlalchemy import select
    from app.models.refresh_token import RefreshToken
    from app.models.user import User

    rows = db.scalars(select(User).where(User.email.like("store-review-%@example.com"),
                                         User.status == "active")).all()
    targets = [u for u in rows if re.fullmatch(r"store-review-(counselor|client)(-\d+)?@example\.com", u.email)]
    if not dry_run:
        for user in targets:
            user.status = "suspended"
            db.query(RefreshToken).filter(RefreshToken.user_id == user.id).delete(synchronize_session=False)
        db.flush()
    return {"deactivate": [u.email for u in targets]}


# ── 실행 ──────────────────────────────────────────────────────────────


def run(database_url: str, environment: str, *, do_apply: bool = False, do_deactivate: bool = False,
        allow_production: bool = False, secrets_path: Path = DEFAULT_SECRETS_PATH,
        engine_factory: Callable[[str], Any] | None = None) -> dict[str, Any]:
    target = require_ops_target(environment, database_url, allow_production=allow_production)  # 접속 전
    from sqlalchemy import text
    from sqlalchemy.orm import Session as OrmSession

    if engine_factory is None:
        from sqlalchemy import create_engine

        engine_factory = create_engine
    bind = engine_factory(database_url)  # 엔진(실행) 또는 바깥 트랜잭션이 열린 연결(시험)
    try:
        with OrmSession(bind=bind, join_transaction_mode="create_savepoint") as db:
            if not do_apply:
                # 읽기 전용 트랜잭션 — 실수로 쓰기가 섞여도 DB가 거부한다. 끝나면 항상 롤백.
                try:
                    db.execute(text("SET TRANSACTION READ ONLY"))
                    result = (deactivate(db, dry_run=True) if do_deactivate
                              else plan(db, load_secrets(secrets_path)))
                finally:
                    db.rollback()
                return {"dry_run": True, "target": target, **result}
            with db.begin():
                result = deactivate(db, dry_run=False) if do_deactivate else apply(db, secrets_path, target)
            return {"dry_run": False, "target": target, **result}
    finally:
        dispose = getattr(bind, "dispose", None)
        if dispose is not None:
            dispose()


def format_result(result: dict[str, Any], secrets_path: Path) -> str:
    """비밀번호 없이 요약한다."""
    head = "dry-run(기록 없음)" if result["dry_run"] else "적용 완료"
    lines = [f"[심사 시드] {head} · 대상 {result['target']}"]
    for acc in result.get("accounts", []):
        lines.append(f"  - {acc['role']}: {acc['email']} · 계정 {acc['action']} · 비밀번호 {acc['password']}")
    if "deactivate" in result:
        lines.append(f"  - 비활성 대상 {len(result['deactivate'])}건: {', '.join(result['deactivate']) or '없음'}")
    if "content_rows_to_create" in result:
        lines.append(f"  - 새로 만들 합성 행: {result['content_rows_to_create']}")
    if "content_rows_created" in result:
        lines.append(f"  - 새로 만든 합성 행: {result['content_rows_created']}")
        lines.append(f"  - 비밀번호는 비밀 파일에만 기록: {secrets_path} (권한 600)")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="스토어 심사 전용 계정·합성 샘플 시드(PostgreSQL)")
    parser.add_argument("--apply", action="store_true", help="실제로 기록한다(없으면 dry-run)")
    parser.add_argument("--allow-production", action="store_true", help="운영 DB 대상 실행을 명시적으로 허용")
    parser.add_argument("--deactivate", action="store_true", help="심사 후 비활성(suspended)")
    parser.add_argument("--secrets-file", type=Path, default=DEFAULT_SECRETS_PATH, help="비밀번호 기록 파일 경로")
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)
    try:
        from app.config import settings

        result = run(settings.database_url, settings.environment, do_apply=args.apply,
                     do_deactivate=args.deactivate, allow_production=args.allow_production,
                     secrets_path=args.secrets_file)
    except ValueError as exc:
        sys.exit(f"[심사 시드] 중단: {exc}")
    except Exception as exc:  # noqa: BLE001 — DB 오류 메시지에 접속 정보가 섞일 수 있어 종류만 알린다
        sys.exit(f"[심사 시드] 실패({type(exc).__name__}): 대상·스키마를 확인하세요. 변경은 롤백되었습니다")
    print(format_result(result, args.secrets_file))


if __name__ == "__main__":
    main()
