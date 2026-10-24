#!/usr/bin/env python3
"""SDD-243 데이터 센터 반출 패키지 독립 검증기 (stdlib 전용).

제품 코드(decoder/package)를 import 하지 않는다. 생성된 part ZIP 들과 기대값 JSON 만으로 다음을 검사한다.
  - 각 part 가 단독으로 열리고 루트 README_ko.md / data_dictionary.json / manifest.json 을 포함
  - 최종 크기 ≤ --max-bytes(기본 1,000,000,000), 중첩 ZIP 없음, 안전한 경로
  - manifest 의 part 수/번호, 파일별 bytes·sha256·rows 가 실제 내용과 일치, 이어진 조각 연속성·헤더 반복
  - 금지 문자열(원 UUID·실명·이메일 등)이 어떤 엔트리에도 없음
  - 기대값(expected.json): {"rows": {논리경로: 총 행수}, "forbidden": [...], "values": [{"path","row","column","value"}]}
종료 코드 0 = 통과, 1 = 실패(사유 목록을 stderr 에 출력).
"""
import argparse
import csv
import hashlib
import io
import json
import sys
import zipfile
from pathlib import Path

ROOT_FILES = ('README_ko.md', 'data_dictionary.json', 'manifest.json')


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--artifacts', required=True, help='part ZIP 이 있는 디렉터리')
    ap.add_argument('--expected', required=True, help='기대값 JSON')
    ap.add_argument('--max-bytes', type=int, default=1_000_000_000)
    args = ap.parse_args()
    expected = json.loads(Path(args.expected).read_text(encoding='utf-8'))
    errors: list[str] = []
    zips = sorted(Path(args.artifacts).glob('*.zip'))
    if not zips:
        errors.append('part ZIP 없음')
    manifests: dict[int, dict] = {}
    contents: dict[str, dict[int, bytes]] = {}  # 논리경로 -> {piece_index: bytes}
    forbidden = [f.encode() for f in expected.get('forbidden', []) if f]
    for z in zips:
        size = z.stat().st_size
        if size > args.max_bytes:
            errors.append(f'{z.name}: 크기 초과 {size}')
        try:
            zf = zipfile.ZipFile(z)
        except zipfile.BadZipFile:
            errors.append(f'{z.name}: ZIP 열기 실패')
            continue
        with zf:
            bad = zf.testzip()
            if bad:
                errors.append(f'{z.name}: CRC 불일치 {bad}')
            names = zf.namelist()
            for root in ROOT_FILES:
                if root not in names:
                    errors.append(f'{z.name}: 루트 {root} 없음')
            if len(set(names)) != len(names):
                errors.append(f'{z.name}: 중복 엔트리')
            for n in names:
                parts = n.split('/')
                if n.startswith('/') or '..' in parts or '' in parts[:-1] or '\\' in n:
                    errors.append(f'{z.name}: 안전하지 않은 경로 {n}')
                data = zf.read(n)
                if n.lower().endswith(('.zip', '.z01')) or data[:4] == b'PK\x03\x04':
                    errors.append(f'{z.name}: 중첩 ZIP {n}')
                for bad_s in forbidden:
                    if bad_s in data:
                        errors.append(f'{z.name}: 금지 문자열 노출 {n}')
                        break
            if 'manifest.json' not in names:
                continue
            manifest = json.loads(zf.read('manifest.json'))
            manifests[manifest['part_no']] = manifest
            listed = {f['path'] for f in manifest['files']}
            actual = {n for n in names if n not in ROOT_FILES}
            if listed != actual:
                errors.append(f'{z.name}: manifest 파일 목록 불일치 +{sorted(actual - listed)[:3]} -{sorted(listed - actual)[:3]}')
            for f in manifest['files']:
                if f['path'] not in actual:
                    continue
                data = zf.read(f['path'])
                if len(data) != f['bytes']:
                    errors.append(f'{f["path"]}: bytes 불일치')
                if hashlib.sha256(data).hexdigest() != f['sha256']:
                    errors.append(f'{f["path"]}: sha256 불일치')
                if f['format'] == 'csv':
                    rows = list(csv.reader(io.StringIO(data.decode('utf-8'), newline='')))
                    if f['rows'] is not None and len(rows) - 1 != f['rows']:
                        errors.append(f'{f["path"]}: 행수 불일치 manifest={f["rows"]} 실제={len(rows) - 1}')
                elif f['format'] == 'jsonl':
                    count = sum(1 for line in data.decode('utf-8').splitlines() if line.strip())
                    if f['rows'] is not None and count != f['rows']:
                        errors.append(f'{f["path"]}: 레코드 수 불일치')
                logical = f['path'].replace('.cont-%04d' % f['piece_index'], '') if f['piece_index'] > 1 else f['path']
                contents.setdefault(logical, {})[f['piece_index']] = data
    if manifests:
        counts = {m['part_count'] for m in manifests.values()}
        if counts != {len(zips)} or sorted(manifests) != list(range(1, len(zips) + 1)):
            errors.append(f'part 수/번호 불일치 count={counts} nos={sorted(manifests)}')
        for m in manifests.values():
            if [p['part_no'] for p in m['parts']] != list(range(1, m['part_count'] + 1)):
                errors.append('manifest part 목록 불연속')
    # 이어진 조각: 연속 번호, 헤더 반복, 총 행수
    totals: dict[str, int] = {}
    for logical, pieces in contents.items():
        if sorted(pieces) != list(range(1, len(pieces) + 1)):
            errors.append(f'{logical}: 조각 누락 {sorted(pieces)}')
            continue
        if logical.endswith('.csv'):
            header = None
            total = 0
            for i in sorted(pieces):
                rows = list(csv.reader(io.StringIO(pieces[i].decode('utf-8'), newline='')))
                if header is None:
                    header = rows[0]
                elif rows[0] != header:
                    errors.append(f'{logical}: 조각 {i} 헤더 불일치')
                total += len(rows) - 1
            totals[logical] = total
        elif logical.endswith('.jsonl'):
            totals[logical] = sum(sum(1 for ln in pieces[i].decode('utf-8').splitlines() if ln.strip()) for i in pieces)
    for path, rows in expected.get('rows', {}).items():
        if totals.get(path) != rows:
            errors.append(f'{path}: 총 행수 기대 {rows} 실제 {totals.get(path)}')
    for spec in expected.get('values', []):
        pieces = contents.get(spec['path'])
        if not pieces:
            errors.append(f'{spec["path"]}: 값 검사 대상 없음')
            continue
        rows: list[list[str]] = []
        header = None
        for i in sorted(pieces):
            parsed = list(csv.reader(io.StringIO(pieces[i].decode('utf-8'), newline='')))
            header = header or parsed[0]
            rows += parsed[1:]
        got = rows[spec['row']][header.index(spec['column'])]
        if got != spec['value']:
            errors.append(f'{spec["path"]}[{spec["row"]}].{spec["column"]}: 기대 {spec["value"]!r} 실제 {got!r}')
    if errors:
        print('FAIL', file=sys.stderr)
        for e in errors:
            print(' -', e, file=sys.stderr)
        return 1
    print(json.dumps({'ok': True, 'parts': len(zips), 'files': len(contents)}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
