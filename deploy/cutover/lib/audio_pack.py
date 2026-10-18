#!/usr/bin/env python3
"""SDD-210 C-4b — dev 서버에서 실행: audio_chunks 중 실제 파일이 있는 행을 tar.gz 로 묶는다(읽기 전용, DB·파일 무변경).

  audio_pack.py --env-file ENV --out DIR

산출물(DIR):
  audio-chunks.tar.gz   존재하는 파일(아카이브 이름 = 절대 경로에서 선행 '/' 제거 → 대상 서버에서 `tar -xzf … -C /` 로 같은 경로에 복원)
  present.tsv           id \t file_path \t size
  missing.ids           파일이 없는 행의 id (한 줄에 하나)
  skipped.tsv           허용 경로 밖이라 묶지 않은 행(있으면 중단 사유)
마지막 줄에 `RESULT present=N missing=M skipped=K bytes=B rows=R` 를 출력한다.
"""
import argparse
import os
import sys
import tarfile

import psycopg2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pgrun import read_url  # noqa: E402

ALLOWED_PREFIXES = ("/tmp/mindbreeze_audio/", "/var/lib/")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--env-file", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    conn = psycopg2.connect(read_url(args.env_file), connect_timeout=15)
    conn.set_session(readonly=True)
    cur = conn.cursor()
    cur.execute("SELECT id::text, file_path, coalesce(size_bytes,0) FROM audio_chunks ORDER BY created_at, id")
    rows = cur.fetchall()
    conn.close()

    present, missing, skipped, total = [], [], [], 0
    for cid, path, size in rows:
        norm = os.path.normpath(path or "")
        if not path or ".." in path.split("/") or not norm.startswith(ALLOWED_PREFIXES):
            skipped.append((cid, path))
        elif os.path.isfile(norm):
            present.append((cid, norm, os.path.getsize(norm)))
            total += os.path.getsize(norm)
        else:
            missing.append(cid)

    with tarfile.open(os.path.join(args.out, "audio-chunks.tar.gz"), "w:gz") as tf:
        for _cid, p, _s in present:
            tf.add(p, arcname=p.lstrip("/"), recursive=False)
    with open(os.path.join(args.out, "present.tsv"), "w", encoding="utf-8") as fh:
        for cid, p, s in present:
            fh.write(f"{cid}\t{p}\t{s}\n")
    with open(os.path.join(args.out, "missing.ids"), "w", encoding="utf-8") as fh:
        fh.write("".join(f"{c}\n" for c in missing))
    with open(os.path.join(args.out, "skipped.tsv"), "w", encoding="utf-8") as fh:
        for cid, p in skipped:
            fh.write(f"{cid}\t{p}\n")
    print(f"RESULT present={len(present)} missing={len(missing)} skipped={len(skipped)} bytes={total} rows={len(rows)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
