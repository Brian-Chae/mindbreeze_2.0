journalctl --since "2026-11-04 01:00:00" --until "2026-11-04 08:00:00" --no-pager -o short-iso 2>/dev/null > /tmp/j285.txt; wc -l /tmp/j285.txt
for p in de8312 6a2172 518675 ac1a78; do echo "== $p"; grep -c "$p" /tmp/j285.txt; grep "$p" /tmp/j285.txt | grep -v "log_truncated" | sed -E 's/^[^ ]+ [^ ]+ //' | cut -c1-200 | head -8; done
echo "== WARNING/ERROR 유형 집계 (01:10~01:40Z, log_truncated 제외)"
grep -E "WARNING|ERROR|Traceback|Exception" /tmp/j285.txt | grep -v log_truncated | sed -E 's/^[^ ]+ [^ ]+ //; s/[0-9a-f]{8}-[0-9a-f-]{27}/<u>/g; s/[0-9]+/N/g' | cut -c1-160 | sort | uniq -c | sort -rn | head -20
rm -f /tmp/j285.txt
