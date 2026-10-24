import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalysisMetricsService } from '../src/lib/eeg/AnalysisMetricsService';
import { PPGSignalProcessor } from '../src/lib/eeg/PPGSignalProcessor';
import { ALGORITHM_VERSIONS, PPG_ALGORITHM_HISTORY } from '../src/lib/biosignal/feature-collector';

// 호흡성 부정맥(RSA) 흉내: 0.25Hz(15회/분)로 RR이 출렁이는 박동 열. endTs[k] = k번째 박동을 닫는 피크의 시각(ms).
function beats(count: number, startMs = 100_000, freqHz = 0.25) {
  const rr: number[] = [], endTs: number[] = [];
  let t = startMs;
  for (let k = 0; k < count; k++) {
    const interval = 1000 + 60 * Math.sin(2 * Math.PI * freqHz * (t / 1000));
    t += interval; rr.push(interval); endTs.push(t);
  }
  return { rr, endTs };
}
const hr = { vitals: { heartRate: 60 } };
/** 처리기가 4Hz로 emit하는 상황: 매번 최근 window개 박동을 통째로 다시 돌려준다(중첩). */
async function feedSliding(service: AnalysisMetricsService, all: ReturnType<typeof beats>, window: number, upToBeat: number) {
  for (let end = window; end <= upToBeat; end++) {
    vi.setSystemTime(new Date(all.endTs[end - 1]));
    await service.processPPGAnalysisMetrics(hr, Date.now(), 90, true, all.rr.slice(end - window, end), all.endTs.slice(end - window, end));
  }
}
const fresh = () => { (AnalysisMetricsService as unknown as { instance: null }).instance = null; return AnalysisMetricsService.getInstance(); };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(100_000)); });
afterEach(() => vi.useRealTimers());

describe('SDD244 T10 PPG 중첩 창 RR 중복', () => {
  it('같은 창을 반복 emit해도 RR 버퍼는 박동 수만큼만 늘어난다(재현된 결함)', async () => {
    const service = fresh(); const data = beats(12);
    for (let i = 0; i < 10; i++) {
      vi.setSystemTime(new Date(data.endTs[11] + i * 1100));
      await service.processPPGAnalysisMetrics(hr, Date.now(), 90, true, data.rr, data.endTs);
    }
    expect(service.getRRBufferStatus().bufferLength).toBe(12);
  });

  it('실제 경과 60초 전에는 호흡수를 내지 않고, 60초 뒤에는 15회/분 근처를 낸다', async () => {
    const service = fresh(); const all = beats(100);
    await feedSliding(service, all, 20, 50);                 // 박동 50개 ≈ 50초 경과
    expect(service.getCurrentRespiratoryRate()).toBeNull();  // 중복 누적이면 여기서 이미 열려 버린다
    await feedSliding(service, all, 20, 90);                 // ≈ 90초 경과
    const rate = service.getCurrentRespiratoryRate();
    expect(rate).not.toBeNull();
    expect(rate!).toBeGreaterThan(12); expect(rate!).toBeLessThan(18);
  });

  it('호흡 null 사유를 화면 snapshot에 줄 수 있다(경과 부족 → insufficient_window, 충족 → 사유 없음)', async () => {
    const service = fresh(); const all = beats(100);
    expect(service.getRespiratoryNullReason()).toBe('no_ppg_data');
    await feedSliding(service, all, 40, 50);
    expect(service.getCurrentRespiratoryRate()).toBeNull();
    expect(service.getRespiratoryNullReason()).toBe('insufficient_window');
    await feedSliding(service, all, 40, 100);
    expect(service.getCurrentRespiratoryRate()).not.toBeNull();
    expect(service.getRespiratoryNullReason()).toBeNull();
  });

  it('재연결로 시각 기준이 되돌아가도(리셋) 새 박동은 버리지 않는다', async () => {
    const service = fresh(); const first = beats(100, 500_000);
    await service.processPPGAnalysisMetrics(hr, Date.now(), 90, true, first.rr, first.endTs);
    const second = beats(100, 10_000);                          // 시각이 크게 과거로 돌아감
    await feedSliding(service, second, 20, 50);
    expect(service.getCurrentRespiratoryRate()).toBeNull();
    await feedSliding(service, second, 20, 90);
    expect(service.getRRBufferStatus().bufferLength).toBe(90);
    expect(service.getCurrentRespiratoryRate()).toBeGreaterThan(12);
    expect(service.getCurrentRespiratoryRate()).toBeLessThan(18);
  });

  it('시각을 주지 않는 기존 호출은 예전 동작 그대로다(호환)', async () => {
    const service = fresh(); const data = beats(12);
    await service.processPPGAnalysisMetrics(hr, Date.now(), 90, true, data.rr);
    await service.processPPGAnalysisMetrics(hr, Date.now(), 90, true, data.rr);
    expect(service.getRRBufferStatus().bufferLength).toBe(24);
  });

  it('SDNN과 RMSSD는 같은 값이 아니다(화면 HRV=SDNN 근거)', async () => {
    const service = fresh();
    const all = beats(60);
    await feedSliding(service, all, 30, 60);
    expect(service.getCurrentSDNN()).not.toBeNull();
    expect(service.getCurrentRMSSD()).not.toBeNull();
    expect(service.getCurrentSDNN()).not.toBe(service.getCurrentRMSSD());
  });
});

describe('SDD244 T10 LF/HF 방향 독립 확인(재현된 결함 없음 → 수정 없음)', () => {
  it('0.1Hz 변조는 LF 우세, 0.28Hz 변조는 HF 우세로 나온다', async () => {
    const lf = fresh(); await feedSliding(lf, beats(130, 100_000, 0.1), 40, 130);
    const hf = fresh(); await feedSliding(hf, beats(130, 100_000, 0.28), 40, 130);
    expect(lf.getCurrentLfHfRatio()).not.toBeNull(); expect(hf.getCurrentLfHfRatio()).not.toBeNull();
    expect(lf.getCurrentLfHfRatio()!).toBeGreaterThan(1);
    expect(hf.getCurrentLfHfRatio()!).toBeLessThan(1);
  });
});

describe('SDD244 T10 처리기 RR 시각과 알고리즘 버전', () => {
  it('처리기가 RR 인터벌마다 닫는 피크의 시각을 결과 객체별로 돌려준다', async () => {
    vi.useRealTimers();
    const processor = new PPGSignalProcessor();
    const samples = Array.from({ length: 1000 }, (_, i) => ({ timestamp: 1_000_000 + i * 20, red: 1000 + 200 * Math.sin(2 * Math.PI * 1.2 * i / 50), ir: 2000 + 400 * Math.sin(2 * Math.PI * 1.2 * i / 50), leadOff: { ch1: false, ch2: false } }));
    const result = await processor.processPPGData(samples);
    const stamps = processor.getRrEndTimestamps(result);
    expect(result.rrIntervals.length).toBeGreaterThan(5);
    expect(stamps).toHaveLength(result.rrIntervals.length);
    for (let i = 1; i < stamps.length; i++) expect(stamps[i] - stamps[i - 1]).toBeCloseTo(result.rrIntervals[i], -1);
  });
  it('수정은 새 algorithm version이고 이전 버전 기록은 유지한다', () => {
    expect(ALGORITHM_VERSIONS.ppg).toBe('2');
    expect(Object.keys(PPG_ALGORITHM_HISTORY)).toEqual(['1', '2']);
    expect(PPG_ALGORITHM_HISTORY['1']).toMatch(/append/);
  });
});
