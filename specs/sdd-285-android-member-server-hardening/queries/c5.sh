U=$(systemctl list-units --type=service --no-legend | awk '{print $1}' | grep -i mindbreeze | tr '\n' ' '); echo "units: $U"
for u in mindbreeze-api mindbreeze-backend; do systemctl cat $u >/dev/null 2>&1 && echo "has $u"; done
journalctl --since "2026-11-04 01:10:00" --until "2026-11-04 01:40:00" --no-pager -o cat 2>/dev/null | grep -v "log_truncated" | sed -E 's/[0-9a-f]{8}-[0-9a-f-]{27}/<uuid>/g; s/[0-9]+/N/g' | cut -c1-140 | sort | uniq -c | sort -rn | head -25
