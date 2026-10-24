#!/usr/bin/env python3
"""구현 decoder를 import하지 않는 ZIP/CSV/Parquet/hash/count 독립 검사."""
import argparse
import csv
import hashlib
import io
import json
from pathlib import PurePosixPath
import zipfile


def verify(path, expected):
    with zipfile.ZipFile(path) as z:
        names=z.namelist()
        assert len(names)==len(set(names)), 'duplicate_path'
        assert set(names)==set(expected['files']), 'file_coverage'
        for name in names:
            assert not name.startswith('/') and '..' not in PurePosixPath(name).parts, 'unsafe_path'
            data=z.read(name); golden=expected['files'][name]
            assert hashlib.sha256(data).hexdigest()==golden['sha256'], 'sha256'
            assert len(data)==golden['size_bytes'], 'size_bytes'
            rows=None
            if name.endswith('.csv'): rows=list(csv.DictReader(io.StringIO(data.decode('utf-8'))))
            if name.endswith('.parquet'):
                import pyarrow.parquet as pq
                rows=pq.read_table(io.BytesIO(data)).to_pylist()
            if name.endswith('.jsonl'): rows=[json.loads(line) for line in data.splitlines()]
            if rows is not None:
                assert len(rows)==golden['row_count'], 'row_count'
                if 'columns' in golden and rows: assert set(rows[0])==set(golden['columns']), 'field_coverage'
                if 'rows' in golden: assert rows==golden['rows'], 'golden_rows'
            if name.endswith('.json'):
                body=json.loads(data)
                if 'expected' in golden: assert body==golden['expected'], 'metadata_or_gap'
    return len(names)


if __name__=='__main__':
    p=argparse.ArgumentParser(); p.add_argument('--input',required=True); p.add_argument('--expected',required=True)
    args=p.parse_args()
    with open(args.expected) as f: expected=json.load(f)
    print(json.dumps({'verified_files':verify(args.input,expected)}))
