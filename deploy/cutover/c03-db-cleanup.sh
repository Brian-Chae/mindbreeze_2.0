#!/usr/bin/env bash
# C-3 prod DB 검증·정리 (리허설 실측 3분)
#  1) alembic 리비전 = dev(C-0) 와 동일  2) 테이블별 행 수 = C-1 동결 기준과 완전 일치(정리 전)
#  3) 정리(한 트랜잭션): dev 계정(auth_provider='dev') 정지 · refresh_tokens 전체 폐기 · 기기 토큰(device_tokens) 비활성(revoked_at)
#  4) 정리 결과 검증: 활성 dev 계정 0 · refresh_tokens 0 · 활성 기기 토큰 0
# 주의: prod DB 에만 쓴다(dev 는 읽기). dev 계정은 FK 참조 행이 많아 삭제하지 않고 정지(plan §4).
# 사용: bash c03-db-cleanup.sh [--dry-run]
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

CLEANUP_SQL="UPDATE users SET status='suspended' WHERE auth_provider='dev' AND status <> 'suspended'
--;--
DELETE FROM refresh_tokens
--;--
UPDATE device_tokens SET revoked_at = now() WHERE revoked_at IS NULL"

VERIFY_SQL="SELECT
  (SELECT count(*) FROM users WHERE auth_provider='dev' AND status <> 'suspended'),
  (SELECT count(*) FROM refresh_tokens),
  (SELECT count(*) FROM device_tokens WHERE revoked_at IS NULL)"

step_main() {
  local rev counts
  # 1) 리비전
  rev="$(pg_prod "prod alembic 리비전" "SELECT version_num FROM alembic_version" --readonly)"
  if is_dry; then
    note "비교: prod 리비전 == $RUN_DIR/C0-alembic.txt (dev). 불일치면 중단"
  else
    [ "$rev" = "$(tr -d '[:space:]' < "$RUN_DIR/C0-alembic.txt")" ] || die "alembic 리비전 불일치(prod=$rev, dev=$(cat "$RUN_DIR/C0-alembic.txt"))"
    note "alembic 일치: $rev"
  fi

  # 2) 행 수 대조 (정리 전)
  if is_dry; then
    pg_prod "prod 테이블별 정확 행 수" "" --counts
    note "비교: $RUN_DIR/C3-prod-counts.tsv == $RUN_DIR/C1-freeze-counts.tsv (diff 0줄이어야 함, 불일치면 중단·롤백 판단)"
  else
    pg_prod "prod 테이블별 정확 행 수" "" --counts > "$RUN_DIR/C3-prod-counts.tsv"
    if ! diff "$RUN_DIR/C1-freeze-counts.tsv" "$RUN_DIR/C3-prod-counts.tsv" > "$RUN_DIR/C3-counts.diff"; then
      cat "$RUN_DIR/C3-counts.diff" >&2; die "행 수 불일치(위 diff) — 복원본이 동결 시점과 다름. 롤백 판단(dev 는 무변경)"
    fi
    note "행 수 일치: $(wc -l < "$RUN_DIR/C3-prod-counts.tsv" | tr -d ' ')개 테이블, 합계 $(awk -F'\t' '{s+=$2} END{print s}' "$RUN_DIR/C3-prod-counts.tsv")행"
  fi

  # 3) 정리
  pg_prod "dev 계정 정지·토큰 폐기·기기 토큰 비활성(단일 트랜잭션)" "$CLEANUP_SQL" > "$RUN_DIR/C3-cleanup.log"

  # 4) 검증
  local v; v="$(pg_prod "정리 결과 검증(활성 dev 계정·refresh_tokens·활성 기기 토큰)" "$VERIFY_SQL" --readonly)"
  if ! is_dry; then
    echo "$v" > "$RUN_DIR/C3-verify.txt"
    [ "$v" = "$(printf '0\t0\t0')" ] || die "정리 검증 실패: '$v' (기대 0 0 0)"
    note "정리 완료: 활성 dev 계정 0 · refresh_tokens 0 · 활성 기기 토큰 0"
  else
    note "기대값: 0 0 0 (아니면 중단)"
  fi
  pg_prod "(기록) 알림 outbox 대기 현황 — prod 가 컷오버 후 처리" "SELECT channel, status, count(*) FROM notification_outbox GROUP BY 1,2 ORDER BY 1,2" --readonly > "$RUN_DIR/C3-outbox.txt" || true
}
run_step "C-3" "prod DB 검증(리비전·행 수)·dev 계정 정지·토큰 폐기" "$@"
