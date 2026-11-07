"""저장한 round-1 전후 JSON·현재 소스를 네트워크/DB 없이 독립 검산한다."""
import ast
import hashlib
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent
ROOT = BASE.parents[2]


def read(name):
    return json.loads((BASE / name).read_text())


def main():
    sources = {
        'cps_sha256': ROOT / 'backend/app/services/class_participation_service.py',
        'namespace_sha256': ROOT / 'backend/app/ws/session_live_namespace.py',
    }
    current = {k: hashlib.sha256(p.read_bytes()).hexdigest() for k, p in sources.items()}
    for name in ('socket-after-100-r2.json', 'socket-after-40.json'):
        data = read(name)
        assert all(data[k] == v for k, v in current.items()), name
        assert data['stored_count'] == data['expected_windows'] == data['n'] * data['ticks']
        assert data['counts'].get('projection_pending', 0) <= 49
        assert data['p95_s']['renew'] <= 2
        assert data['broadcast_missing_pairs'] == data['client_missing_pairs'] == 0
        assert data['revision'] == data['applied_revision'] == data['emitted_revision']
        assert data['counts'].get('deadlock', 0) == 0
        assert not data['errors'], data['errors']
        samples = [line for line in data['timing_logs'] if 'kind=capture.renew ' in line]
        assert samples and all(ast.literal_eval(line.split('max_ms=', 1)[1])['projection_ms'] == 0 for line in samples)
        print(name, 'renew/pending·저장·outbox coverage·소스 및 projection 대기0 검산 통과')
    failed = read('socket-after-100.json')
    assert failed['errors']['live:metric:TimeoutError'] == 1
    assert failed['broadcast_missing_pairs'] == (failed['revision'] - failed['emitted_revision']) * 2 == 438
    print('초기 실패 표본: 실제 metric timeout1 및 종료 전 미반영219행×2 보존 확인')
    baseline_runs = [read(name) for name in ('socket-before-100.json', 'socket-before-100-r2.json', 'socket-before-100-r3.json')]
    assert all(d['cps_sha256'] != current['cps_sha256'] for d in baseline_runs)
    assert all(d['counts'].get('projection_pending', 0) == d['single_flight_stats']['drain_timeout'] for d in baseline_runs)
    print('100명 baseline3표본 pending과 single-flight timeout 일치 확인')
    before, after = read('regression-before-all.json'), read('regression-after-all.json')
    assert len(before) == len(after) == 12
    for b, a in zip(before, after):
        assert b['partition'] == a['partition'] and b['targets'] == a['targets']
        for k in ('passed', 'failed', 'skipped', 'error'):
            assert b['counts'].get(k, 0) == a['counts'].get(k, 0), (a['partition'], k)
        assert b['failed'] == a['failed'] and b['errors'] == a['errors']
        assert a['process_exitstatus'] != 'timeout'
    print('회귀12묶음 전후 실패 node ID 및 통과/실패/생략 동일')


if __name__ == '__main__':
    main()
