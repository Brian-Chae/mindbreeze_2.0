"""네트워크 없이 round-3 결과와 현재 소스의 대응을 검산한다."""
import hashlib
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent
ROOT = BASE.parents[2]


def read(name):
    return json.loads((BASE / name).read_text())


def main():
    for n, suffix in ((100, ''), (40, ''), (100, '-r2'), (40, '-r2')):
        before, after = (read(f'socket-{stage}-{n}{suffix}.json') for stage in ('before', 'sql-after'))
        source = read(f'socket-sql-after-{n}{suffix}-source.json')
        for path, digest in source['sha256'].items():
            assert hashlib.sha256((ROOT / 'backend' / path).read_bytes()).hexdigest() == digest
        # 기존 metric timeout이 남은 표본은 실패 상태 자체를 보존한다.
        assert source['exitstatus'] == (1 if after['errors'] else 0)
        for data in (before, after):
            assert data['stored_count'] == data['expected_windows'] == n * data['ticks']
            assert data['closed_streams'] == data['counts']['close_status:applied:none'] == n
            assert data['revision'] == data['applied_revision'] == data['emitted_revision']
            assert data['broadcast_missing_pairs'] == data['client_missing_pairs'] == 0
            assert data['counts'].get('deadlock', 0) == 0
        # 이 검산은 기록의 정합성 검증이며 알려진 metric timeout을 시험 통과로 바꾸지 않는다.
        print(n, suffix, '전후 오류(실패 표본 포함)', before['errors'], after['errors'])
        assert after['p95_s']['renew'] <= 2
        assert after['counts'].get('close_projection_pending', 0) == 0
        print(n, '소스·저장·close·방송·renew 검산 통과',
              {k: [before['p95_s'][k], after['p95_s'][k]] for k in ('entry', 'renew', 'close')})
        if n == 40:
            print('40명 전후 무악화 여부', {
                **{k: after['p95_s'][k] <= before['p95_s'][k] for k in ('entry', 'renew')},
                'cpu': after['cpu_process_mean_pct'] <= before['cpu_process_mean_pct']})
    before, after = read('regression-before-all.json'), read('regression-after-all.json')
    assert len(before) == len(after) == 12
    for b, a in zip(before, after):
        assert b['partition'] == a['partition'] and b['targets'] == a['targets']
        for key in ('passed', 'failed', 'skipped', 'error'):
            assert b['counts'].get(key, 0) == a['counts'].get(key, 0), (a['partition'], key)
        assert b['failed'] == a['failed'] and b['errors'] == a['errors']
        assert a['process_exitstatus'] != 'timeout'
    print('기존12묶음 전후 결과와 실패 node ID 동일')


if __name__ == '__main__':
    main()
