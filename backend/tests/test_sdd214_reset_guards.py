"""SDD-214 Z1 — 초기화 스크립트 안전장치 단위 테스트 (DB 접속 없음).

ZR-2(dry-run 기본·명시 플래그·환경 가드), ZR-5(범위 옵션), ZR-7(출력 개인정보 0), ZR-8(S3·Redis 범위).
"""

from __future__ import annotations

import fakeredis
import pytest

from app.core.database import Base
from app.services import dev_data_reset as dr

DEV_URL = "postgresql://u:secret-pw@dev-db.internal:5432/mindbreeze_dev"
PROD_URL = "postgresql://u:secret-pw@mindbreeze-prod.abc.rds.amazonaws.com:5432/mindbreeze"
SOCKET_URL = "postgresql://pgt@/postgres?host=/tmp/scratch&port=55432"
ALLOWED = ("dev-db.internal",)


# ── 환경 가드 ────────────────────────────────────────────────────────────────


def test_화이트리스트에_없는_호스트는_거부한다():
    with pytest.raises(dr.ResetGuardError, match="허용 목록"):
        dr.classify_target(PROD_URL.replace("mindbreeze-prod", "mystery"), allowed_hosts=ALLOWED)


def test_허용_목록의_dev_호스트는_통과한다():
    assert dr.classify_target(DEV_URL, allowed_hosts=ALLOWED) == "dev"


def test_로컬_소켓과_루프백은_허용한다():
    assert dr.classify_target(SOCKET_URL, allowed_hosts=()) == "local"
    assert dr.classify_target("postgresql://u@127.0.0.1/db", allowed_hosts=()) == "local"


def test_prod_호스트는_허용_목록에_있어도_기본_거부한다():
    with pytest.raises(dr.ResetGuardError, match="prod"):
        dr.classify_target(PROD_URL, allowed_hosts=(PROD_URL.split("@")[1].split(":")[0],))


def test_prod_호스트는_allow_prod_와_허용_목록이_모두_있어야_통과한다():
    host = PROD_URL.split("@")[1].split(":")[0]
    assert dr.classify_target(PROD_URL, allowed_hosts=(host,), allow_prod=True) == "prod"
    with pytest.raises(dr.ResetGuardError):
        dr.classify_target(PROD_URL, allowed_hosts=(), allow_prod=True)


def test_명시한_prod_호스트_목록도_prod_로_본다():
    with pytest.raises(dr.ResetGuardError, match="prod"):
        dr.classify_target(DEV_URL, allowed_hosts=ALLOWED, prod_hosts=("dev-db.internal",))


def test_오류_메시지에_접속_문자열과_비밀번호가_없다():
    with pytest.raises(dr.ResetGuardError) as exc:
        dr.classify_target(PROD_URL.replace("mindbreeze-prod", "mystery"), allowed_hosts=ALLOWED)
    assert "secret-pw" not in str(exc.value)
    assert "postgresql://" not in str(exc.value)


# ── 명시 플래그 ──────────────────────────────────────────────────────────────


def test_apply_만으로는_삭제하지_않는다():
    with pytest.raises(dr.ResetGuardError, match="i-understand-this-deletes-data"):
        dr.check_apply_flags(apply=True, confirmed=False, env="dev", scope="all")


def test_dry_run_은_플래그_없이_허용한다():
    dr.check_apply_flags(apply=False, confirmed=False, env="dev", scope="all")


def test_확인_플래그만_있으면_dry_run_이다_삭제_허용_아님():
    with pytest.raises(dr.ResetGuardError, match="--apply"):
        dr.check_apply_flags(apply=False, confirmed=True, env="dev", scope="all")


def test_prod_에서는_scope_all_을_거부한다():
    with pytest.raises(dr.ResetGuardError, match="sessions"):
        dr.check_apply_flags(apply=True, confirmed=True, env="prod", scope="all")
    dr.check_apply_flags(apply=True, confirmed=True, env="prod", scope="sessions")


# ── 범위 분류 ────────────────────────────────────────────────────────────────


def test_모든_ORM_테이블이_범위_분류에_들어_있다():
    classified = dr.SESSIONS_SCOPE_DELETE | dr.SESSIONS_SCOPE_KEEP
    missing = {t.name for t in Base.metadata.sorted_tables} - classified
    assert not missing, f"분류되지 않은 테이블(범위 sessions 가 거부된다): {sorted(missing)}"


def test_분류가_서로_겹치지_않고_alembic_version_은_어디에도_없다():
    assert not (dr.SESSIONS_SCOPE_DELETE & dr.SESSIONS_SCOPE_KEEP)
    assert "alembic_version" not in dr.SESSIONS_SCOPE_DELETE | dr.SESSIONS_SCOPE_KEEP


def test_계정_기관_테이블은_sessions_범위에서_보존한다():
    assert {"users", "organizations", "user_org_memberships"} <= dr.SESSIONS_SCOPE_KEEP
    assert {"sessions", "session_participants", "reports", "classes"} <= dr.SESSIONS_SCOPE_DELETE


# ── Redis ────────────────────────────────────────────────────────────────────


def test_redis_dry_run_은_건수만_세고_지우지_않는다():
    r = fakeredis.FakeRedis()
    r.set("k1", "v1")
    r.set("k2", "v2")
    assert dr.reset_redis(r, apply=False) == 2
    assert r.dbsize() == 2


def test_redis_apply_는_현재_DB_를_비운다():
    r = fakeredis.FakeRedis()
    r.set("k1", "v1")
    assert dr.reset_redis(r, apply=True) == 1
    assert r.dbsize() == 0


# ── S3 ───────────────────────────────────────────────────────────────────────


class FakeS3:
    def __init__(self, keys: list[str]):
        self.keys = list(keys)
        self.deleted: list[str] = []

    def count_prefix(self, bucket: str, prefix: str) -> int:
        return sum(1 for k in self.keys if k.startswith(prefix))

    def delete_prefix(self, bucket: str, prefix: str) -> int:
        doomed = [k for k in self.keys if k.startswith(prefix)]
        self.keys = [k for k in self.keys if not k.startswith(prefix)]
        self.deleted.extend(doomed)
        return len(doomed)


def test_s3_dry_run_은_프리픽스별_건수만_돌려주고_삭제하지_않는다():
    s3 = FakeS3(["video/a/1.webm", "video/b/2.webm", "eeg-raw/x/1", "other/keep"])
    counts = dr.reset_s3(s3, bucket="b", prefixes=("video/", "eeg-raw/"), apply=False)
    assert counts == {"video/": 2, "eeg-raw/": 1}
    assert s3.deleted == []


def test_s3_apply_는_지정_프리픽스_밖은_건드리지_않는다():
    s3 = FakeS3(["video/a/1.webm", "eeg-raw/x/1", "other/keep", "videos-archive/z"])
    dr.reset_s3(s3, bucket="b", prefixes=("video/",), apply=True)
    assert sorted(s3.keys) == ["eeg-raw/x/1", "other/keep", "videos-archive/z"]


@pytest.mark.parametrize("bad", ["", "/", "video", "a//"])
def test_s3_프리픽스는_슬래시로_끝나는_비어있지_않은_값만_허용한다(bad):
    with pytest.raises(dr.ResetGuardError, match="프리픽스"):
        dr.reset_s3(FakeS3([]), bucket="b", prefixes=(bad,), apply=False)


def test_sdd217_운영_종속_행은_삭제하고_append_only_감사는_보존한다():
    assert {"class_makeup_assignments", "class_guest_credentials", "class_guest_recoveries",
            "class_member_operations", "class_guest_join_operations", "session_presence_leases"} <= dr.SESSIONS_SCOPE_DELETE
    assert {"class_attendance_events", "class_guest_merges", "class_member_consent_events"} <= dr.SESSIONS_SCOPE_KEEP
