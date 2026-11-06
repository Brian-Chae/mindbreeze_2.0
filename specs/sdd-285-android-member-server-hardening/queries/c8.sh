journalctl --since "2026-11-04 01:00:00" --until "2026-11-04 08:00:00" --no-pager -o short-iso 2>/dev/null > /tmp/j285.txt
echo "== deadlock 시각(UTC) + 직후 SQL/파라미터 참가자"
grep -n "DeadlockDetected) deadlock" /tmp/j285.txt | cut -d' ' -f1-2 | sed -E 's/\+0000//' | head -20
echo "== capture_stream INSERT 실패 4건: 시각·participant"
grep -n "INSERT INTO capture_stream" /tmp/j285.txt | cut -d: -f1 | while read n; do
  t=$(sed -n "${n}p" /tmp/j285.txt | cut -d' ' -f1); p=$(sed -n "$((n+1))p" /tmp/j285.txt | grep -o "participant_id': UUID('[0-9a-f]\{6\}"); echo "$t $p"; done
echo "== 데드락 traceback 호출 경로 (첫 건)"
n=$(grep -n "INSERT INTO capture_stream" /tmp/j285.txt | head -1 | cut -d: -f1)
sed -n "$((n-60)),$((n-12))p" /tmp/j285.txt | grep -E "File \"/opt/mindbreeze/current|app/" | sed -E 's/^\S+ \S+ uvicorn\[[0-9]+\]: //; s#/opt/mindbreeze/current/backend/##' | cut -c1-150
echo "== 정상 6명 capture_stream INSERT 성공 여부는 DB로 확인했음. KeyError 'Session not found' 16건 컨텍스트"
rm -f /tmp/j285.txt
