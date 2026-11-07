"""독립 검산: 네트워크/DB 접속 없이 저장된 전후 증거와 현재 소스를 비교한다."""
import hashlib
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent
ROOT = BASE.parents[2]


def read(name):
    return json.loads((BASE / name).read_text())


def main():
    current_sha = hashlib.sha256((ROOT / 'backend/app/services/class_participation_service.py').read_bytes()).hexdigest()
    for n in (100, 40):
        before, after = read(f'before-{n}.json'), read(f'after-{n}.json')
        assert before['broadcast_source_sha256'] != current_sha
        assert after['broadcast_source_sha256'] == current_sha
        details = before['broadcast_missing_details']
        assert len(details) == before['broadcast_missing_pairs']
        for d in details:
            assert d['cause'] == 'seq_shift'
            calls = [r for a in d['attempts'] for r in a['replays']]
            assert any(r['error'] is None and not r['returned'] and d['stream_seq'] <= r['cursor'] for r in calls)
        assert after['broadcast_missing_pairs'] == 0
        assert after['broadcast_actual_pairs'] == after['broadcast_expected_pairs']
        assert after['applied_revision'] == after['emitted_revision'] == after['revision']
        counts = after['counts']
        assert counts.get('deadlock', 0) == counts.get('http500', 0) == 0
        assert counts.get('projection_pending', 0) <= 49 and after['renew_p95_s'] <= 2
        assert counts['entered'] == counts['started'] == counts['completed'] == n
        assert counts['metric_projected'] == n * 32 and counts.get('metric_failed', 0) == 0
        assert not after['failures']
        print(f'{n}명: 누락 원인 전수 및 수정 후 기준 검산 통과')
    before, after = read('regression-before-all.json'), read('regression-after-all.json')
    assert len(before) == len(after) == 12
    for b, a in zip(before, after):
        assert b['partition'] == a['partition'] and b['targets'] == a['targets']
        for key in ('passed', 'failed', 'skipped', 'error'):
            assert b['counts'].get(key, 0) == a['counts'].get(key, 0), (b['partition'], key)
        assert b['failed'] == a['failed'] and b['errors'] == a['errors']
        assert a['process_exitstatus'] != 'timeout'
    print('12개 회귀 묶음 전후 통과/실패/생략 및 실패 node ID 동일')


if __name__ == '__main__':
    main()
