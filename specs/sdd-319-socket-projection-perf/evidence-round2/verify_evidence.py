"""DB/네트워크 없이 round-2 증거와 현재 소스를 독립 검산한다."""
import hashlib
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent
ROOT = BASE.parents[2]


def read(name):
    return json.loads((BASE / name).read_text())


def main():
    current = {key: hashlib.sha256((ROOT / path).read_bytes()).hexdigest() for key, path in {
        'namespace_sha256': 'backend/app/ws/session_live_namespace.py',
        'outbox_sha256': 'backend/app/services/session_live_outbox.py',
    }.items()}
    for n in (100, 40):
        before = read('socket-before-100-r2.json' if n == 100 else 'socket-before-40.json')
        after = read(f'socket-after-{n}.json')
        assert all(after[k] == v and before[k] != v for k, v in current.items())
        for data in (before, after):
            assert data['stored_count'] == data['expected_windows'] == n * data['ticks']
            assert data['closed_streams'] == data['counts']['close_status:applied:none'] == n
            assert data['broadcast_missing_pairs'] == data['client_missing_pairs'] == 0
            assert data['revision'] == data['applied_revision'] == data['emitted_revision']
            assert data['counts'].get('deadlock', 0) == 0
        assert after['p95_s']['renew'] <= 2
        assert after['counts'].get('close_projection_pending', 0) == 0
        assert after['counts']['metric_projected'] == n * after['ticks']
        assert not after['errors']
        if n == 40:
            for name in ('entry', 'renew'):
                assert after['p95_s'][name] <= before['p95_s'][name]
            assert after['cpu_process_mean_pct'] <= before['cpu_process_mean_pct']
        print(n, '소스·저장·close·방송·교착·renew 기준 검산 통과')
    for name in ('socket-before-100.json', 'socket-before-100-r2.json'):
        assert read(name)['errors']['live:metric:metric:TimeoutError'] == 1
    print('실패한 100명 baseline2개와 실제 metric timeout 각1건 보존 확인')
    before, after = read('regression-before-all.json'), read('regression-after-final-all.json')
    assert len(before) == len(after) == 12
    for b, a in zip(before, after):
        assert a['partition'] == b['partition'] and a['targets'] == b['targets']
        for key in ('passed', 'failed', 'skipped', 'error'):
            assert a['counts'].get(key, 0) == b['counts'].get(key, 0), (a['partition'], key)
        assert a['failed'] == b['failed'] and a['errors'] == b['errors']
        assert a['process_exitstatus'] != 'timeout'
    print('기존12묶음 전후 결과·실패 node ID 동일')


if __name__ == '__main__':
    main()
