#!/usr/bin/env python3
"""alembic 리비전 헤드가 1개인지 검사(정적 파싱, DB 불필요). 2개 이상이면 exit 1."""
import glob, os, re, sys
revs, downs = {}, set()
for f in glob.glob("backend/alembic/versions/*.py"):
    s = open(f, encoding="utf-8", errors="ignore").read()
    r = re.search(r"^revision\s*(?::\s*\w+)?\s*=\s*['\"]([^'\"]+)", s, re.M)
    d = re.search(r"^down_revision\s*(?::[^=]+)?=\s*(.+)$", s, re.M)
    if r:
        revs[r.group(1)] = os.path.basename(f)
        if d:
            downs.update(re.findall(r"['\"]([0-9a-zA-Z_]+)['\"]", d.group(1)))
heads = [v for v in revs if v not in downs]
print("alembic 리비전 %d개, 헤드 %d개: %s" % (len(revs), len(heads), ", ".join(heads[:5])))
sys.exit(0 if len(heads) == 1 else 1)
