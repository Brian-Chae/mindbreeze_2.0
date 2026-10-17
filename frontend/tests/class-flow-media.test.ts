// SDD-209 T2b — 기기 점검 순수 로직(class-media.ts) · 밴드 단계/전극 파생(band-step.ts) · 대기실 장치 상태 분리
import { describe, expect, it } from 'vitest';
import {
  MIC_QUIET_LEVEL, MIC_QUIET_WINDOW_MS, RING_SEGMENTS, classifyMediaError, classifyMicQuality, levelFromRms,
  mediaDeviceMessage, micChipLabel, needsMicOffWarning, peakInWindow, ringSteps, rmsFromTimeDomain,
} from '../src/lib/class/class-media';
import { deriveBandStep, deriveElectrodes } from '../src/lib/class/band-step';

const domErr = (name: string): DOMException => new DOMException('x', name);

describe('classifyMediaError — 오류를 하나의 값으로 뭉치지 않는다', () => {
  it.each([
    ['NotAllowedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError', 'nodevice'],
    ['OverconstrainedError', 'nodevice'],
    ['NotReadableError', 'inuse'],
    ['AbortError', 'inuse'],
  ])('%s → %s', (name, expected) => {
    expect(classifyMediaError(domErr(name))).toBe(expected);
  });
  it('알 수 없는 오류는 inuse(쓸 수 없음), 오류가 아닌 값도 예외 없이', () => {
    expect(classifyMediaError(new Error('boom'))).toBe('inuse');
    expect(classifyMediaError(undefined)).toBe('inuse');
  });
});

describe('레벨 · 5단계 링', () => {
  it('rms → level = min(1, rms×3), 이상값은 0..1 로 고정', () => {
    expect(levelFromRms(0)).toBe(0);
    expect(levelFromRms(0.1)).toBeCloseTo(0.3);
    expect(levelFromRms(0.5)).toBe(1);
    expect(levelFromRms(Number.NaN)).toBe(0);
    expect(levelFromRms(-1)).toBe(0);
  });
  it('rmsFromTimeDomain: 128 중심 무음은 0, 진폭이 크면 커진다', () => {
    expect(rmsFromTimeDomain(new Uint8Array(512).fill(128))).toBe(0);
    const loud = new Uint8Array(512).fill(128).map((_, i) => (i % 2 ? 192 : 64));
    expect(rmsFromTimeDomain(loud)).toBeCloseTo(0.5, 2);
    expect(rmsFromTimeDomain(new Uint8Array(0))).toBe(0);
  });
  it('ringSteps = ceil(level×5), 0..5', () => {
    expect(RING_SEGMENTS).toBe(5);
    expect(ringSteps(0)).toBe(0);
    expect(ringSteps(0.01)).toBe(1);
    expect(ringSteps(0.2)).toBe(1);
    expect(ringSteps(0.21)).toBe(2);
    expect(ringSteps(0.6)).toBe(3);
    expect(ringSteps(1)).toBe(5);
    expect(ringSteps(2)).toBe(5);
    expect(ringSteps(-1)).toBe(0);
  });
});

describe('조용해요 판정 — 최근 3초 피크', () => {
  it('피크가 임계 미만이면 quiet, 이상이면 normal', () => {
    expect(MIC_QUIET_WINDOW_MS).toBe(3000);
    expect(classifyMicQuality(MIC_QUIET_LEVEL - 0.01)).toBe('quiet');
    expect(classifyMicQuality(MIC_QUIET_LEVEL)).toBe('normal');
  });
  it('peakInWindow: 창 밖 표본은 무시, 표본이 없으면 null(판정 보류)', () => {
    const samples = [{ t: 0, level: 0.9 }, { t: 3500, level: 0.1 }, { t: 4000, level: 0.05 }];
    expect(peakInWindow(samples, 5000)).toBeCloseTo(0.1);
    expect(peakInWindow(samples, 20000)).toBeNull();
    expect(peakInWindow([], 100)).toBeNull();
  });
});

describe('마이크 꺼짐 경고 필요 여부', () => {
  it('온라인에서 마이크가 실제로 켜져 있지 않으면 경고', () => {
    expect(needsMicOffWarning({ place: 'online', micState: 'on', micWanted: true })).toBe(false);
    expect(needsMicOffWarning({ place: 'online', micState: 'on', micWanted: false })).toBe(true);
    expect(needsMicOffWarning({ place: 'online', micState: 'denied', micWanted: true })).toBe(true);
    expect(needsMicOffWarning({ place: 'online', micState: 'pending', micWanted: true })).toBe(true);
  });
  it('오프라인은 마이크 UI 가 없어 경고하지 않는다', () => {
    expect(needsMicOffWarning({ place: 'offline', micState: 'off', micWanted: false })).toBe(false);
  });
});

describe('문구', () => {
  it('칩과 상세 메시지가 같은 상태에서 나온다', () => {
    expect(micChipLabel('on', false)).toBe('정상');
    expect(micChipLabel('on', true)).toBe('조용해요');
    expect(micChipLabel('denied', false)).toBe('권한 필요');
    expect(micChipLabel('nodevice', false)).toBe('마이크를 찾지 못했어요');
    expect(micChipLabel('unsupported', false)).toBe('지원 안 됨');
    expect(mediaDeviceMessage('마이크', 'denied')).toContain('권한이 꺼져 있어요');
    expect(mediaDeviceMessage('마이크', 'nodevice')).toContain('찾지 못했어요');
    expect(mediaDeviceMessage('마이크', 'inuse')).toContain('쓸 수 없어요');
    expect(mediaDeviceMessage('카메라', 'denied')).toContain('카메라 없이도');
  });
});

describe('deriveElectrodes — ch1→왼쪽, ch2→오른쪽, 기준=둘 다 양호', () => {
  it('접촉 정보가 없으면 전부 미확인(거짓 불량 표시 금지)', () => {
    expect(deriveElectrodes(null)).toEqual({ left: 'unknown', ref: 'unknown', right: 'unknown' });
  });
  it('true = 분리(불량)', () => {
    expect(deriveElectrodes({ ch1: false, ch2: false })).toEqual({ left: 'good', ref: 'good', right: 'good' });
    expect(deriveElectrodes({ ch1: true, ch2: false })).toEqual({ left: 'bad', ref: 'bad', right: 'good' });
    expect(deriveElectrodes({ ch1: false, ch2: true })).toEqual({ left: 'good', ref: 'bad', right: 'bad' });
    expect(deriveElectrodes({ ch1: true, ch2: true })).toEqual({ left: 'bad', ref: 'bad', right: 'bad' });
  });
});

describe('deriveBandStep — L/R 분할·연결 실패·접촉 미확인', () => {
  const base = {
    connectionState: 'connected' as const, everConnected: true, deviceStatus: null, signalQualityLevel: 'good' as const,
    battery: 80, lastEegAt: new Date(1_000_000).toISOString(),
  };
  const now = 1_000_000;
  it('미지원/연결 중/미연결', () => {
    expect(deriveBandStep({ ...base, connectionState: 'unsupported' }, null, now)).toBe('unsupported');
    expect(deriveBandStep({ ...base, connectionState: 'connecting', everConnected: false }, null, now)).toBe('connecting');
    expect(deriveBandStep({ ...base, connectionState: 'disconnected', everConnected: false, lastEegAt: null }, null, now)).toBe('idle');
  });
  it('연결 후 끊김(lost)도 단계에서는 연결 안 됨', () => {
    expect(deriveBandStep({ ...base, connectionState: 'disconnected' }, null, now)).toBe('idle');
  });
  it('연결됨 + 접촉 양호 / 미확인(null)은 connected', () => {
    expect(deriveBandStep(base, { ch1: false, ch2: false }, now)).toBe('connected');
    expect(deriveBandStep(base, null, now)).toBe('connected');
  });
  it('전극별 접촉 불량 3종', () => {
    expect(deriveBandStep(base, { ch1: true, ch2: false }, now)).toBe('leadoffl');
    expect(deriveBandStep(base, { ch1: false, ch2: true }, now)).toBe('leadoffr');
    expect(deriveBandStep(base, { ch1: true, ch2: true }, now)).toBe('leadoff');
  });
  it('서버식 lead_off 판정만 있고 채널 정보가 없으면 둘 다 불량으로 본다', () => {
    expect(deriveBandStep({ ...base, deviceStatus: 'lead_off' }, null, now)).toBe('leadoff');
  });
});
