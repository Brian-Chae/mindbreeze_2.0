journalctl --since "2026-11-04 01:00:00" --until "2026-11-04 08:00:00" --no-pager -o short-iso 2>/dev/null > /tmp/j285.txt
echo "== 'parameters:' 라인 수 및 대상 테이블"
grep -c "\[parameters:" /tmp/j285.txt
grep -E "^\S+ \S+ uvicorn\[[0-9]+\]: \[SQL: " /tmp/j285.txt | sed -E 's/^\S+ \S+ uvicorn\[[0-9]+\]: //' | cut -c1-120 | sort | uniq -c | sort -rn | head -5
echo "== 오류 종류(예외 클래스 줄)"
grep -E "^\S+ \S+ uvicorn\[[0-9]+\]: (sqlalchemy|psycopg|app\.|[A-Za-z_.]+(Error|Exception))" /tmp/j285.txt | sed -E 's/^\S+ \S+ uvicorn\[[0-9]+\]: //' | sed -E 's/[0-9a-f]{8}-[0-9a-f-]{27}/<u>/g' | cut -c1-200 | sort | uniq -c | sort -rn | head -12
echo "== de8312 파라미터 라인 전후"
n=$(grep -n "de83126c" /tmp/j285.txt | head -1 | cut -d: -f1); a=$((n-14)); b=$((n+3)); sed -n "${a},${b}p" /tmp/j285.txt | sed -E 's/^\S+ (\S+) uvicorn\[[0-9]+\]: /\1 /' | cut -c1-230
rm -f /tmp/j285.txt
