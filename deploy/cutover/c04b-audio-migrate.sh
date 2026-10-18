#!/usr/bin/env bash
# C-4b 서버 로컬 청크 이관 (Brian 승인 2026-10-18)
#  · 오디오: audio_chunks 1,405행 중 파일이 있는 1,072건(≈84MB)은 dev → (운영자 로컬 경유) → prod S3 _migration/ → prod 서버 같은 경로(/tmp/mindbreeze_audio …)에 복원
#            파일이 없는 333행은 prod DB 에서 정리(삭제). dev 원본 행·파일은 건드리지 않음(롤백·감사용으로 id 목록 보존).
#  · 영상: video_chunks 982행(로컬 경로, 파일 0건) — '파일 없음(만료)' 표시 컬럼이 기존 스키마에 있으면 그 방식을 우선하지만,
#          없으면 **그대로 두고 보고**한다(스키마 변경 금지). 이 스크립트는 영상 행을 수정하지 않는다.
# 옵션: --pack-only  dev 에서 묶기·로컬 보관만 수행(사전 안전 복사본. 점검창 밖에서 해도 읽기 전용이라 안전)
# 기대값(승인 수치): MB_EXPECT_AUDIO_PRESENT=1072 MB_EXPECT_AUDIO_MISSING=333 — 다르면 중단(MB_ALLOW_AUDIO_COUNT_DRIFT=1 로만 통과)
# 사용: bash c04b-audio-migrate.sh [--pack-only] [--dry-run]
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

PACK_ONLY=0
for _a in "$@"; do [ "$_a" = "--pack-only" ] && PACK_ONLY=1; done
EXP_PRESENT="${MB_EXPECT_AUDIO_PRESENT:-1072}"; EXP_MISSING="${MB_EXPECT_AUDIO_MISSING:-333}"
MIG_PREFIX="_migration/$RUN_ID"
OUT_DIR="$RUN_DIR/C4b"

step_main() {
  guard_prod_account
  mkdir -p "$OUT_DIR"

  # 1) dev: 존재 확인·묶기 (읽기 전용)
  dev_put "$CUT_DIR/lib/pgrun.py" "$CUT_DIR/lib/audio_pack.py" /tmp/
  remote_dev "audio_chunks 파일 존재 확인·tar.gz 묶기(읽기 전용, 허용 경로 /tmp/mindbreeze_audio·/var/lib)" <<EOF | tee "$OUT_DIR/pack.log" >&2
set -euo pipefail
rm -rf /tmp/mb-audio /tmp/mb-cut && mkdir -p /tmp/mb-audio /tmp/mb-cut && mv -f /tmp/pgrun.py /tmp/audio_pack.py /tmp/mb-cut/
$DEV_PY /tmp/mb-cut/audio_pack.py --env-file $DEV_ENV_FILE --out /tmp/mb-audio
sha256sum /tmp/mb-audio/audio-chunks.tar.gz | cut -d' ' -f1 | sed 's/^/SHA /'
EOF
  local f
  for f in audio-chunks.tar.gz present.tsv missing.ids skipped.tsv; do dev_get "/tmp/mb-audio/$f" "$OUT_DIR/$f"; done

  local present missing skipped sha
  if is_dry; then
    note "pack.log 의 RESULT 줄에서 present/missing/skipped 파싱 → 기대값($EXP_PRESENT/$EXP_MISSING)·skipped=0 확인, 로컬 tar sha256 == dev sha256 확인"
    present=$EXP_PRESENT; missing=$EXP_MISSING; skipped=0; sha="<sha256>"
  else
    present="$(sed -n 's/.*present=\([0-9]*\).*/\1/p' "$OUT_DIR/pack.log" | tail -1)"
    missing="$(sed -n 's/.* missing=\([0-9]*\).*/\1/p' "$OUT_DIR/pack.log" | tail -1)"
    skipped="$(sed -n 's/.*skipped=\([0-9]*\).*/\1/p' "$OUT_DIR/pack.log" | tail -1)"
    sha="$(sed -n 's/^SHA //p' "$OUT_DIR/pack.log" | tail -1)"
    [ "$skipped" = "0" ] || die "허용 경로 밖 청크 ${skipped}건($OUT_DIR/skipped.tsv) — 처리 방침 확인 필요"
    if [ "$present" != "$EXP_PRESENT" ] || [ "$missing" != "$EXP_MISSING" ]; then
      [ "${MB_ALLOW_AUDIO_COUNT_DRIFT:-0}" = "1" ] || die "오디오 청크 수가 승인값과 다름(present=$present/$EXP_PRESENT, missing=$missing/$EXP_MISSING) — Brian 확인 후 MB_ALLOW_AUDIO_COUNT_DRIFT=1"
    fi
    [ "$(shasum -a 256 "$OUT_DIR/audio-chunks.tar.gz" | cut -d' ' -f1)" = "$sha" ] || die "tar sha256 불일치(전송 손상)"
    [ "$(tar -tzf "$OUT_DIR/audio-chunks.tar.gz" | wc -l | tr -d ' ')" = "$present" ] || die "tar 항목 수 ≠ present"
    note "오디오: 존재 ${present}건 / 유실 ${missing}건 / 로컬 보관 $OUT_DIR"
  fi
  if [ "$PACK_ONLY" = "1" ]; then note "--pack-only: 여기까지(prod 변경 없음)"; return 0; fi

  # 2) 로컬 → prod 버킷 임시 접두사 → prod 서버 복원
  x "prod 버킷 임시 접두사에 업로드" aws s3 cp "$OUT_DIR/audio-chunks.tar.gz" "s3://mindbreeze-prod/$MIG_PREFIX/audio-chunks.tar.gz" --only-show-errors
  remote_prod "prod 서버에 오디오 청크 복원(원래 절대 경로 그대로, 소유자 mindbreeze) 및 전수 존재 확인" 900 <<EOF
D=/opt/mindbreeze/incoming/audio-migration-$RUN_ID; mkdir -p "\$D"; cd "\$D"
aws s3 cp s3://mindbreeze-prod/$MIG_PREFIX/audio-chunks.tar.gz . --only-show-errors
echo "$sha  audio-chunks.tar.gz" | sha256sum -c -
n=\$(tar -tzf audio-chunks.tar.gz | wc -l); echo "아카이브 항목: \$n"
[ "\$n" = "$present" ]
tar -xzf audio-chunks.tar.gz -C / --no-same-owner
miss=0
while IFS= read -r p; do [ -f "/\$p" ] || miss=\$((miss+1)); done < <(tar -tzf audio-chunks.tar.gz)
echo "복원 후 누락: \$miss"
[ "\$miss" = 0 ]
tar -tzf audio-chunks.tar.gz | sed 's#^#/#' | xargs -d '\n' chown mindbreeze:mindbreeze
[ -d /tmp/mindbreeze_audio ] && chown mindbreeze:mindbreeze /tmp/mindbreeze_audio || true
echo "OK 복원 \${n}건"
EOF

  # 3) 파일 없는 오디오 행 정리 (prod DB 에서만; id 목록은 보존)
  if is_dry; then
    pg_prod "유실 오디오 행 ${EXP_MISSING}건 정리(사전 건수 확인 → DELETE → 잔여 = present 확인)" \
      "SELECT count(*) FROM audio_chunks WHERE id IN (<missing.ids ${EXP_MISSING}건>)
--;--
DELETE FROM audio_chunks WHERE id IN (<missing.ids>)
--;--
SELECT count(*) FROM audio_chunks"
  else
    local idlist; idlist="$(python3 - "$OUT_DIR/missing.ids" <<'PY'
import re, sys
ids = [l.strip() for l in open(sys.argv[1]) if l.strip()]
assert all(re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", i) for i in ids), "uuid 형식 오류"
print(",".join("'%s'" % i for i in ids))
PY
)" || die "missing.ids 검증 실패"
    if [ "$missing" -gt 0 ]; then
      local pre; pre="$(pg_prod "정리 대상 건수 확인" "SELECT count(*) FROM audio_chunks WHERE id IN ($idlist)" --readonly)"
      [ "$pre" = "$missing" ] || die "prod 에서 정리 대상이 ${pre}건(기대 ${missing})"
      pg_prod "유실 오디오 행 정리" "DELETE FROM audio_chunks WHERE id IN ($idlist)" >/dev/null
    fi
    local left; left="$(pg_prod "audio_chunks 잔여 확인" "SELECT count(*) FROM audio_chunks" --readonly)"
    [ "$left" = "$present" ] || die "정리 후 잔여 ${left}행 ≠ 이관 ${present}건"
    note "오디오 행 정리 완료: 삭제 ${missing}행 · 잔여 ${left}행(= 복원 파일 수). 삭제 id 목록: $OUT_DIR/missing.ids"
    aws s3 rm "s3://mindbreeze-prod/$MIG_PREFIX/audio-chunks.tar.gz" --only-show-errors || true
  fi

  # 4) 영상 로컬 경로 행: 스키마에 만료 표시가 있는지 확인(변경 없음, 보고 전용)
  local vcols vlocal
  vcols="$(pg_prod "video_chunks 컬럼 확인(만료/없음 표시 컬럼 존재 여부)" "SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name='video_chunks'" --readonly)"
  vlocal="$(pg_prod "video_chunks 로컬 경로 행 수" "SELECT count(*) FROM video_chunks WHERE file_path LIKE '/%'" --readonly)"
  if ! is_dry; then
    {
      echo "video_chunks 컬럼: $vcols"
      echo "로컬 경로(파일 0건) 행: $vlocal"
      if printf '%s' "$vcols" | grep -Eq '(^|,)(expired|expired_at|file_missing|purged_at|deleted_at|status)(,|$)'; then
        echo "판정: 만료/상태 표시 후보 컬럼이 있음 → 수동 검토 후 표시 방식 적용(자동 변경 안 함)"
      else
        echo "판정: '파일 없음(만료)' 표시 컬럼 없음(file_path·size_bytes 뿐) → 스키마 변경 없이 행을 그대로 둠. 컷오버 후 sweep_stale_media 가 정리 가능."
      fi
    } | tee "$OUT_DIR/video-report.txt" >&2
  else
    note "영상 행은 수정하지 않음. 표시 컬럼 없으면 그대로 두고 보고(video-report.txt)"
  fi
}
run_step "C-4b" "서버 로컬 청크 이관(오디오 1,072건 복원·333행 정리, 영상 982행 보고)" "$@"
