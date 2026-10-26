#!/usr/bin/env bash
# Android 16KB 페이지 정렬 검증. 사용: scripts/check-16kb-align.sh <app.apk|app.aab|디렉터리>
#  - 모든 .so 의 모든 PT_LOAD 가 p_align>=16384 이고 (vaddr-offset)%16384==0 인지 표로 출력. 위반 시 exit 1.
#  - APK 면 zipalign -c -P 16 -v 4 도 실행한다.
set -euo pipefail
IN="${1:?사용법: $0 <apk|aab|dir>}"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/Volumes/Brian_SSD/androidsdk}}"
READELF="${LLVM_READELF:-$(ls "$SDK"/ndk/*/android-ndk-*/toolchains/llvm/prebuilt/*/bin/llvm-readelf 2>/dev/null | tail -1)}"
ZIPALIGN="${ZIPALIGN:-$(ls "$SDK"/build-tools/*/zipalign 2>/dev/null | sort -V | tail -1)}"
[ -x "$READELF" ] || { echo "llvm-readelf 없음" >&2; exit 2; }
WORK="$(mktemp -d "${TMPDIR:-/tmp}/check16kb.XXXXXX")"; trap 'rm -rf "$WORK"' EXIT
if [ -d "$IN" ]; then ROOT="$IN"; else unzip -q -o "$IN" '*.so' -d "$WORK" || true; ROOT="$WORK"; fi
fail=0; n=0
printf '%-62s %-8s %-8s %s\n' "SO" "LOAD수" "최소align" "결과"
while IFS= read -r so; do
  n=$((n+1))
  res=$("$READELF" -lW "$so" | awk '$1=="LOAD"{c++; off=strtonum($2); va=strtonum($3); al=strtonum($NF); if(m==0||al<m)m=al; if(al<16384||((va-off)%16384)!=0)bad++} END{printf "%d %d %d", c, m, bad}' 2>/dev/null) || res=$("$READELF" -lW "$so" | python3 -I -c '
import sys
c=m=bad=0
for l in sys.stdin:
    f=l.split()
    if f and f[0]=="LOAD":
        off,va,al=int(f[1],16),int(f[2],16),int(f[-1],16)
        c+=1; m=al if (m==0 or al<m) else m
        if al<16384 or (va-off)%16384: bad+=1
print(c,m,bad)')
  set -- $res; c=$1; m=$2; bad=$3
  st=OK; [ "$bad" -gt 0 ] && { st="FAIL($bad)"; fail=1; }
  printf '%-62s %-8s %-8s %s\n' "${so#$ROOT/}" "$c" "$m" "$st"
done < <(find "$ROOT" -name '*.so' | sort)
echo "검사한 .so: $n"
[ "$n" -gt 0 ] || { echo "so 없음" >&2; exit 2; }
if [[ "$IN" == *.apk ]]; then
  echo "== zipalign -c -P 16 -v 4 =="; "$ZIPALIGN" -c -P 16 -v 4 "$IN" | tail -3 || fail=1
fi
[ "$fail" -eq 0 ] && echo "PASS" || { echo "FAIL"; exit 1; }
