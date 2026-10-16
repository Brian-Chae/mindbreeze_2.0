// SDD-208 T1 — 클래스 진행 화면 공용 케이스 모델(밴드 8상태·네트워크 3상태·공용 지표 정의)
import { describe, expect, it } from 'vitest';
import {
  NET_DOWN_AFTER_MS,
  PLAYER_METRICS,
  deriveBandUi,
  deriveNetUi,
  type BandInput,
  type BandUi,
} from '../src/lib/class/player-case';
import { EEG_STALE_MS } from '../src/lib/session-live/signal-status';

const NOW = Date.parse('2026-10-16T09:00:00Z');
const FRESH = new Date(NOW - 1_000).toISOString();
const STALE = new Date(NOW - EEG_STALE_MS - 1_000).toISOString();

/** 정상 착용·연결 상태 — 각 케이스는 여기서 필요한 키만 바꾼다 */
const BASE: BandInput = {
  connectionState: 'connected',
  everConnected: true,
  deviceStatus: 'ok',
  signalQualityLevel: 'ok',
  battery: 80,
  lastEegAt: FRESH,
};
const band = (override: Partial<BandInput>): BandUi => deriveBandUi({ ...BASE, ...override }, NOW);

describe('deriveBandUi — 8상태', () => {
  const cases: Array<[BandUi, string, Partial<BandInput>]> = [
    ['on', '연결·접촉 정상·신호 양호', {}],
    ['off', '한 번도 연결한 적 없고 끊긴 상태(미착용)', {
      connectionState: 'disconnected', everConnected: false, deviceStatus: 'disconnected', battery: null, lastEegAt: null,
    }],
    ['pending', '연결 시도 중', { connectionState: 'connecting', everConnected: false, deviceStatus: 'disconnected' }],
    ['weak', '신호 저하(degraded)', { signalQualityLevel: 'degraded' }],
    ['weak', '신호 불량(invalid)', { signalQualityLevel: 'invalid' }],
    ['leadoff', '접촉 불량(lead_off)', { deviceStatus: 'lead_off' }],
    ['lost', '연결했던 밴드가 끊김', { connectionState: 'disconnected', deviceStatus: 'disconnected' }],
    ['lost', '연결했던 밴드가 오류로 끊김', { connectionState: 'error', deviceStatus: 'disconnected' }],
    ['lost', '연결은 유지되나 EEG 수신이 끊김(stale)', { lastEegAt: STALE }],
    ['low', '배터리 25%(경계 포함)', { battery: 25 }],
    ['unsupported', '이 브라우저는 BLE 미지원', { connectionState: 'unsupported', everConnected: false }],
  ];
  it.each(cases)('%s — %s', (expected, _label, override) => {
    expect(band(override)).toBe(expected);
  });

  it('배터리 26%는 부족이 아니다(25% 이하만 low)', () => {
    expect(band({ battery: 26 })).toBe('on');
  });

  it('배터리·신호품질 값이 없거나 unknown 이어도 on 으로 본다(unknown 을 weak 로 승격하지 않음)', () => {
    expect(band({ battery: null, signalQualityLevel: 'unknown' })).toBe('on');
  });

  it('연결 직후 첫 EEG 샘플 전(lastEegAt=null)은 끊김이 아니라 on 이다', () => {
    expect(band({ lastEegAt: null })).toBe('on');
  });

  it('EEG 수신 간격이 정확히 EEG_STALE_MS 이면 아직 stale 이 아니다', () => {
    const edge = new Date(NOW - EEG_STALE_MS).toISOString();
    expect(band({ lastEegAt: edge })).toBe('on');
  });
});

describe('deriveBandUi — everConnected 로 미착용(off)과 끊김(lost) 구분', () => {
  it.each(['disconnected', 'error'] as const)('연결한 적 없고 %s → off (경고 아님)', (connectionState) => {
    expect(band({ connectionState, everConnected: false, deviceStatus: 'disconnected', lastEegAt: null, battery: null })).toBe('off');
  });
  it.each(['disconnected', 'error'] as const)('연결한 적 있고 %s → lost', (connectionState) => {
    expect(band({ connectionState, everConnected: true, deviceStatus: 'disconnected' })).toBe('lost');
  });
  it('미착용 상태에서 이전 값(배터리·신호)이 남아 있어도 off 를 유지한다', () => {
    expect(band({
      connectionState: 'disconnected', everConnected: false, deviceStatus: 'disconnected',
      battery: 10, signalQualityLevel: 'invalid', lastEegAt: null,
    })).toBe('off');
  });
});

describe('deriveBandUi — 우선순위 충돌 (unsupported > pending > leadoff > lost > weak > low > on > off)', () => {
  const conflicts: Array<[string, BandUi, Partial<BandInput>]> = [
    ['리드오프 + 배터리 부족 → leadoff', 'leadoff', { deviceStatus: 'lead_off', battery: 10 }],
    ['리드오프 + 신호 약함 → leadoff', 'leadoff', { deviceStatus: 'lead_off', signalQualityLevel: 'invalid' }],
    ['리드오프 + EEG 끊김(stale) → leadoff', 'leadoff', { deviceStatus: 'lead_off', lastEegAt: STALE }],
    ['끊김(stale) + 신호 약함 → lost', 'lost', { lastEegAt: STALE, signalQualityLevel: 'degraded' }],
    ['끊김(disconnected) + 배터리 부족 값 잔존 → lost', 'lost', {
      connectionState: 'disconnected', deviceStatus: 'disconnected', battery: 10, signalQualityLevel: 'invalid',
    }],
    ['신호 약함 + 배터리 부족 → weak', 'weak', { signalQualityLevel: 'degraded', battery: 10 }],
    ['미지원 + 이전 값 잔존(리드오프·약함·부족) → unsupported', 'unsupported', {
      connectionState: 'unsupported', deviceStatus: 'lead_off', signalQualityLevel: 'invalid', battery: 5, lastEegAt: STALE,
    }],
    ['연결된 적 있는 밴드의 자동 재연결(connecting) → lost(깜박임 방지)', 'lost', { connectionState: 'connecting', everConnected: true, deviceStatus: 'disconnected' }],
    ['최초 연결 중 + 리드오프 값 잔존 → pending', 'pending', { connectionState: 'connecting', everConnected: false, deviceStatus: 'lead_off' }],
  ];
  it.each(conflicts)('%s', (_label, expected, override) => {
    expect(band(override)).toBe(expected);
  });
});

describe('deriveNetUi — 3상태', () => {
  it('소켓 연결 + 브라우저 온라인 → ok', () => {
    expect(deriveNetUi({ socketConnected: true, browserOnline: true, downForMs: 0 })).toBe('ok');
  });

  it('정상이면 downForMs 값이 남아 있어도 ok', () => {
    expect(deriveNetUi({ socketConnected: true, browserOnline: true, downForMs: NET_DOWN_AFTER_MS * 10 })).toBe('ok');
  });

  it('소켓이 끊기고 임계 시간 전이면 reconnecting', () => {
    expect(deriveNetUi({ socketConnected: false, browserOnline: true, downForMs: 0 })).toBe('reconnecting');
    expect(deriveNetUi({ socketConnected: false, browserOnline: true, downForMs: NET_DOWN_AFTER_MS - 1 })).toBe('reconnecting');
  });

  it('소켓이 끊긴 채 NET_DOWN_AFTER_MS 에 도달하면 down', () => {
    expect(deriveNetUi({ socketConnected: false, browserOnline: true, downForMs: NET_DOWN_AFTER_MS })).toBe('down');
  });

  it('브라우저가 오프라인이면 소켓 플래그가 true 여도 정상으로 보지 않는다', () => {
    expect(deriveNetUi({ socketConnected: true, browserOnline: false, downForMs: 0 })).toBe('reconnecting');
    expect(deriveNetUi({ socketConnected: true, browserOnline: false, downForMs: NET_DOWN_AFTER_MS })).toBe('down');
  });

  it('NET_DOWN_AFTER_MS 는 양의 정수(ms)다', () => {
    expect(Number.isInteger(NET_DOWN_AFTER_MS)).toBe(true);
    expect(NET_DOWN_AFTER_MS).toBeGreaterThan(0);
  });
});

describe('PLAYER_METRICS — 공용 6지표 정의', () => {
  it('집중·이완·감정·BPM·호흡·HRV 순서의 6개다', () => {
    expect(PLAYER_METRICS.map((m) => m.short)).toEqual(['집중', '이완', '감정', 'BPM', '호흡', 'HRV']);
  });

  it('지표명·단위가 시안(member.html)과 같다', () => {
    expect(PLAYER_METRICS.map((m) => [m.label, m.unit])).toEqual([
      ['집중도', '%'], ['이완도', '%'], ['감정균형도', '%'], ['BPM', 'bpm'], ['호흡', '회/분'], ['HRV', 'ms'],
    ]);
  });

  it('MIND 3개 → BODY 3개 순서로 묶인다', () => {
    expect(PLAYER_METRICS.map((m) => m.group)).toEqual(['MIND', 'MIND', 'MIND', 'BODY', 'BODY', 'BODY']);
  });

  it('key 는 중복이 없다', () => {
    expect(new Set(PLAYER_METRICS.map((m) => m.key)).size).toBe(6);
  });

  it('회원 스케일은 현행 GuestMeditationPanel·member.html 과 같다', () => {
    expect(PLAYER_METRICS.map((m) => m.scale.member)).toEqual([
      [0, 100], [0, 100], [0, 100], [40, 140], [5, 30], [10, 100],
    ]);
  });

  it('상담사 스케일은 시안(counselor.html)과 같다', () => {
    expect(PLAYER_METRICS.map((m) => m.scale.host)).toEqual([
      [0, 100], [0, 100], [0, 100], [50, 110], [6, 24], [10, 90],
    ]);
  });

  it('모든 스케일은 min < max 다', () => {
    for (const m of PLAYER_METRICS) {
      expect(m.scale.member[0]).toBeLessThan(m.scale.member[1]);
      expect(m.scale.host[0]).toBeLessThan(m.scale.host[1]);
    }
  });

  it('지표 고유색은 tokens.css 의 --m-* 토큰 이름을 가리킨다', () => {
    expect(PLAYER_METRICS.map((m) => m.colorVar)).toEqual([
      '--m-focus', '--m-relax', '--m-emotion', '--m-bpm', '--m-resp', '--m-hrv',
    ]);
  });

  it('호흡 지시 문구가 정의에 없다(지표 라벨 "호흡"·단위 "회/분"만 허용)', () => {
    const instruction = /호흡에 집중|숨을 (들이|내쉬)|들이쉬|내쉬|호흡하세요|천천히 호흡|심호흡/;
    const texts = PLAYER_METRICS.flatMap((m) => [m.label, m.short, m.unit]);
    expect(texts.filter((t) => instruction.test(t))).toEqual([]);
  });
});
