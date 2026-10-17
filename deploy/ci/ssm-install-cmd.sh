#!/usr/bin/env bash
# SDD-210 T-5: 서버에서 실행할 설치/롤백 명령 스크립트 텍스트를 출력한다(SSM Run Command 본문).
# 사용: ssm-install-cmd.sh install <release-id> <bucket> [allow-destructive]
#       ssm-install-cmd.sh rollback [<release-id>]
#       ssm-install-cmd.sh status
# 입력은 엄격히 검증한다(명령 주입 방지). 서버측 정본 로직은 릴리스에 포함된 deploy/install-release.sh.
set -euo pipefail
MODE="${1:?install|rollback|status}"
PREFIX=/opt/mindbreeze
RID_RE='^[0-9]{8}-[0-9]{6}-[0-9a-f]{7}$'
case "$MODE" in
  install)
    RID="${2:?release-id}"; BUCKET="${3:?bucket}"; ALLOW="${4:-}"
    [[ "$RID" =~ $RID_RE ]] || { echo "release-id 형식 오류" >&2; exit 2; }
    [[ "$BUCKET" =~ ^[a-z0-9][a-z0-9.-]{2,62}$ ]] || { echo "bucket 형식 오류" >&2; exit 2; }
    EXTRA=""; [ "$ALLOW" = "allow-destructive" ] && EXTRA=" --allow-destructive"
    cat <<CMD
set -euo pipefail
DIR=$PREFIX/incoming/$RID
mkdir -p "\$DIR"; cd "\$DIR"
aws s3 cp "s3://$BUCKET/releases/$RID/mindbreeze-$RID.tar.gz" . --only-show-errors
aws s3 cp "s3://$BUCKET/releases/$RID/mindbreeze-$RID.tar.gz.sha256" . --only-show-errors
sha256sum -c "mindbreeze-$RID.tar.gz.sha256"
tar -xzf "mindbreeze-$RID.tar.gz" -C "\$DIR" --wildcards '*deploy/install-release.sh'
bash "\$DIR/deploy/install-release.sh" install --release-id "$RID" --dir "\$DIR"$EXTRA
CMD
    ;;
  rollback)
    TO="${2:-}"
    ARGS=""
    if [ -n "$TO" ]; then [[ "$TO" =~ $RID_RE ]] || { echo "release-id 형식 오류" >&2; exit 2; }; ARGS=" --to $TO"; fi
    cat <<CMD
set -euo pipefail
bash $PREFIX/current/deploy/install-release.sh rollback$ARGS
CMD
    ;;
  status)
    cat <<CMD
set -euo pipefail
bash $PREFIX/current/deploy/install-release.sh status
CMD
    ;;
  *) echo "사용법: $0 install|rollback|status" >&2; exit 2 ;;
esac
