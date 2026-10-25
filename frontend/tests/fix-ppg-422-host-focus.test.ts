import { describe, expect, it } from 'vitest';
import { normalizeArtifactMeta } from '../src/lib/biosignal/upload-queue';
import { hostMetricValues, type HostMetricExtra } from '../src/components/class/player/host/host-live-model';
import type { ArtifactMeta } from '../src/lib/api/biosignal';
import type { SessionLiveMetric } from '../src/lib/api/session';

const base = { artifact_alias: 'A', artifact_kind: 'feature', stream_id: null, segment_id: null, signal: 'eeg', sequence: 0, row_count: 1, schema_version: 'v', checksum: 'c', size_bytes: 1 } as ArtifactMeta;

describe('보관된 artifact 메타의 time_range 역전 복구(서버 TimeRange.ordered 422 방지)', () => {
  it('from > to 면 바꿔서 보내고 원본은 변경하지 않는다', () => {
    const meta = { ...base, time_range: { from_us: '200', to_us: '100' } };
    const fixed = normalizeArtifactMeta(meta);
    expect(fixed.time_range).toEqual({ from_us: '100', to_us: '200' });
    expect(meta.time_range).toEqual({ from_us: '200', to_us: '100' });
    expect(fixed.checksum).toBe(meta.checksum);
  });
  it('정상 범위·null 은 그대로 둔다', () => {
    const ok = { ...base, time_range: { from_us: '1', to_us: '1' } };
    expect(normalizeArtifactMeta(ok)).toBe(ok);
    expect(normalizeArtifactMeta(base)).toBe(base);
  });
});

describe('상담사 집중·이완 표시', () => {
  const row = { band_connected: true, device_status: 'ok', last_eeg_at: new Date(1_000_000).toISOString(), current_efficiency: 61.2, heart_rate: 70, respiratory_rate: 14, sdnn: 40 } as unknown as SessionLiveMetric;
  const extra = (at: number): HostMetricExtra => ({ at, focus: 55.4, emotionalStability: 48, hrv: 40, heartRate: 70, respiratoryRate: 14 });
  it('수신 시각 기준 extra 가 신선하면 집중·정서·이완이 모두 숫자다', () => {
    const v = hostMetricValues(row, extra(1_000_000), 1_003_000);
    expect(v.focus).toBe(55); expect(v.relaxation).toBe(61); expect(v.emotional).toBe(48);
  });
  it('extra 가 10초보다 오래되면 집중·정서만 비고 이완은 행 값으로 유지된다', () => {
    const v = hostMetricValues(row, extra(900_000), 1_003_000);
    expect(v.focus).toBeNull(); expect(v.relaxation).toBe(61);
  });
});
