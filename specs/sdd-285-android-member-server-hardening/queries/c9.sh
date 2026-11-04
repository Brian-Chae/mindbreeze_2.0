journalctl --since "2026-11-04 01:00:00" --until "2026-11-04 08:00:00" --no-pager -o short-iso 2>/dev/null > /tmp/j285.txt
echo "== TimeoutError 분당(UTC)"
grep -E "uvicorn\[[0-9]+\]: TimeoutError" /tmp/j285.txt | cut -c12-16 | sort | uniq -c | head -30
echo "== TimeoutError 직전 호출경로 샘플"
n=$(grep -n "uvicorn\[[0-9]*\]: TimeoutError" /tmp/j285.txt | sed -n 5p | cut -d: -f1)
sed -n "$((n-25)),${n}p" /tmp/j285.txt | sed -E 's/^\S+ \S+ uvicorn\[[0-9]+\]: //; s#/opt/mindbreeze/[a-z0-9/_-]*/backend/##; s#/opt/mindbreeze/venvs/[0-9a-f]*/lib/python3.12/site-packages/##' | cut -c1-170
echo "== KeyError 'Session not found' 샘플"
n=$(grep -n "KeyError: 'Session not found'" /tmp/j285.txt | head -1 | cut -d: -f1)
sed -n "$((n-14)),${n}p" /tmp/j285.txt | sed -E 's/^\S+ \S+ uvicorn\[[0-9]+\]: //; s#/opt/mindbreeze/[a-z0-9/_-]*/backend/##; s#/opt/mindbreeze/venvs/[0-9a-f]*/lib/python3.12/site-packages/##' | cut -c1-170
rm -f /tmp/j285.txt
