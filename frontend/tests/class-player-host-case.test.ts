// SDD-208 H1 — 상담사 케이스 파생 순수함수(deriveHostCase·그리드 열 수·정렬·지표 매핑)와 C01~C18 픽스처
import { describe, expect, it } from 'vitest';
import { PLAYER_METRICS } from '../src/lib/class/player-case';
import {
  LEGACY_HOST_METRIC_KEY_MAP,
  computeHostGrid,
  deriveHostCase,
  filterHostParticipants,
  fitChipCount,
  formatClock,
  groupAverage,
  nextMetricKey,
  pickGridColumns,
  sortHostParticipants,
  summarizeCheckins,
  summarizeMonitorCounts,
  trendDelta,
} from '../src/lib/class/host-player-case';
import { HOST_CASE_IDS, buildHostCaseInput, syntheticTrend } from '../src/lib/class/fixtures/host-cases';

describe('픽스처 — C01~C18 입력', () => {
  it('케이스 ID 는 C01~C18 18개이고 전부 입력을 만든다', () => {
    expect(HOST_CASE_IDS).toHaveLength(18);
    expect(HOST_CASE_IDS[0]).toBe('C01');
    expect(HOST_CASE_IDS[17]).toBe('C18');
    for (const id of HOST_CASE_IDS) {
      const spec = buildHostCaseInput(id);
      expect(spec.input.participants.length).toBeGreaterThan(0);
    }
  });

  it('기본 구성은 8명(정상 5 · 미착용 2 · 끊김 1)', () => {
    const { input } = buildHostCaseInput('C01');
    const bands = input.participants.map((p) => p.band);
    expect(bands.filter((b) => b === 'on')).toHaveLength(5);
    expect(bands.filter((b) => b === 'off')).toHaveLength(2);
    expect(bands.filter((b) => b === 'lost')).toHaveLength(1);
  });
});

describe('지표 정의 — PLAYER_METRICS 재사용 + 현행 키 매핑', () => {
  it('현행 HostMetricKey 6개가 PLAYER_METRICS 키 6개로 1:1 매핑된다', () => {
    const mapped = Object.values(LEGACY_HOST_METRIC_KEY_MAP).sort();
    const player = PLAYER_METRICS.map((m) => m.key).sort();
    expect(mapped).toEqual(player);
    expect(LEGACY_HOST_METRIC_KEY_MAP.emotionalStability).toBe('emotional');
    expect(LEGACY_HOST_METRIC_KEY_MAP.heartRate).toBe('bpm');
    expect(LEGACY_HOST_METRIC_KEY_MAP.respiratoryRate).toBe('respiration');
  });

  it('지표 순환은 PLAYER_METRICS 순서를 따르고 마지막에서 처음으로 돌아간다', () => {
    expect(nextMetricKey('relaxation')).toBe('emotional');
    expect(nextMetricKey('hrv')).toBe('focus');
  });
});

describe('열 수 선택(균형.md CS2) — 인원을 균등히 나누는 값 우선', () => {
  it.each([
    // [인원, 들어갈 수 있는 최대 열, 기대 열 수]
    [8, 2, 2],
    [8, 4, 4],
    [8, 5, 4],
    [6, 5, 3],
    [12, 5, 4],
    [12, 4, 4],
    [20, 5, 5],
    [7, 5, 4],
    [3, 2, 2],
  ])('%i명 · 최대 %i열 → %i열', (count, fit, expected) => {
    expect(pickGridColumns(count, fit)).toBe(expected);
  });
});

describe('그리드 레이아웃 계산', () => {
  it('모바일 8명은 2열이고 타일 높이는 112~150px', () => {
    const grid = computeHostGrid({ width: 358, height: 520, viewportWidth: 390, count: 8 });
    expect(grid.cols).toBe(2);
    expect(grid.tileHeight).toBeGreaterThanOrEqual(112);
    expect(grid.tileHeight).toBeLessThanOrEqual(150);
    expect(grid.gap).toBe(8);
  });

  it('데스크톱 8명은 4열(마지막 행 2개로 비지 않는다)', () => {
    const grid = computeHostGrid({ width: 1000, height: 420, viewportWidth: 1280, count: 8 });
    expect(grid.cols).toBe(4);
    expect(grid.maxWidth).toBe(grid.cols * grid.tileWidth + (grid.cols - 1) * grid.gap + 1);
  });

  it('20명이라도 타일 높이는 줄지 않는다(넘치면 스크롤)', () => {
    const grid = computeHostGrid({ width: 358, height: 400, viewportWidth: 390, count: 20 });
    expect(grid.tileHeight).toBe(112);
  });

  it('영역 크기를 아직 모르면(0) 기본 열 수로 안전하게 계산한다', () => {
    const grid = computeHostGrid({ width: 0, height: 0, viewportWidth: 1280, count: 8 });
    expect(grid.cols).toBeGreaterThanOrEqual(2);
    expect(Number.isFinite(grid.tileWidth)).toBe(true);
    expect(grid.ringSize).toBeGreaterThanOrEqual(56);
  });
});

describe('정렬 · 그룹 평균', () => {
  const { input } = buildHostCaseInput('C02');
  const ids = (list: readonly { id: string }[]): string[] => list.map((p) => p.id);

  it('입장순은 입력 순서를 유지한다', () => {
    const sorted = sortHostParticipants(input.participants, { metric: 'relaxation', sort: 'join', handsFirst: false });
    expect(ids(sorted)).toEqual(ids(input.participants));
  });

  it('낮은 순/높은 순은 값이 없는 참가자를 항상 뒤로 보낸다', () => {
    const low = sortHostParticipants(input.participants, { metric: 'relaxation', sort: 'low', handsFirst: false });
    const high = sortHostParticipants(input.participants, { metric: 'relaxation', sort: 'high', handsFirst: false });
    expect(low[0].values.relaxation).toBe(41);
    expect(high[0].values.relaxation).toBe(88);
    const noValue = (p: { band: string }): boolean => p.band !== 'on';
    expect(low.slice(-3).every(noValue)).toBe(true);
    expect(high.slice(-3).every(noValue)).toBe(true);
  });

  it('손든 회원 우선이 켜지면 손든·말하는 회원이 앞에 온다', () => {
    const sorted = sortHostParticipants(input.participants, { metric: 'relaxation', sort: 'join', handsFirst: true });
    expect(ids(sorted).slice(0, 2)).toEqual(['p2', 'p5']);
  });

  it('원본 배열을 바꾸지 않는다', () => {
    const before = ids(input.participants);
    sortHostParticipants(input.participants, { metric: 'relaxation', sort: 'high', handsFirst: true });
    expect(ids(input.participants)).toEqual(before);
  });

  it('그룹 평균은 값이 있는 연결 참가자만 반올림 평균한다(이완도 66)', () => {
    expect(groupAverage(buildHostCaseInput('C01').input.participants, 'relaxation')).toBe(66);
  });

  it('값이 하나도 없으면 null', () => {
    expect(groupAverage(buildHostCaseInput('C13').input.participants, 'relaxation')).toBeNull();
  });
});

describe('deriveHostCase — 기본·전원 미착용·대규모(C01·C13·C18)', () => {
  it('C01: 셀프뷰 슬롯, 배너 없음, 칩은 밴드 요약 하나, 접속 7/8', () => {
    const c = deriveHostCase(buildHostCaseInput('C01').input);
    expect(c.loc).toBe('online');
    expect(c.solo).toBe(false);
    expect(c.headSlot).toBe('selfview');
    expect(c.banner).toBeNull();
    expect(c.allOff).toBe(false);
    expect(c.chips.map((chip) => chip.key)).toEqual(['band']);
    expect(c.stats).toEqual({ joined: 7, total: 8 });
    const band = c.chips[0];
    expect(band.key === 'band' && band.on).toBe(5);
    expect(band.key === 'band' && band.off).toBe(2);
    expect(band.key === 'band' && band.lost).toBe(1);
  });

  it('C13: 전원 미착용 — allOff, 체크인 칩 + 밴드 요약 칩, 코랄 요소 없음', () => {
    const c = deriveHostCase(buildHostCaseInput('C13').input);
    expect(c.allOff).toBe(true);
    expect(c.chips.map((chip) => chip.key)).toEqual(['checkin', 'band']);
    expect(c.banner).toBeNull();
    const band = c.chips.find((chip) => chip.key === 'band');
    expect(band && band.key === 'band' && band.on).toBe(0);
  });

  it('C18: 20명, 손든 회원 3명, 손든 회원 우선 정렬 옵션 on', () => {
    const spec = buildHostCaseInput('C18');
    expect(spec.input.participants).toHaveLength(20);
    expect(spec.input.participants.filter((p) => p.hand).map((p) => p.id)).toEqual(['p10', 'p13', 'p18']);
    expect(spec.ui.handsFirst).toBe(true);
    const sorted = sortHostParticipants(spec.input.participants, { metric: 'relaxation', sort: 'join', handsFirst: true });
    expect(sorted.slice(0, 3).map((p) => p.id)).toEqual(['p10', 'p13', 'p18']);
  });
});

describe('칩 줄 넘침(CS4) — 한 줄을 넘으면 뒤에서부터 생략하고 +N', () => {
  const widths = [120, 120, 120, 120, 120, 120, 120, 120, 120];

  it('전부 들어가면 생략 없음', () => {
    expect(fitChipCount({ widths: [100, 100], optional: [false, false], avail: 400, gap: 4, moreWidth: 48 })).toEqual({ visible: [0, 1], hidden: 0 });
  });

  it('9개 중 한 줄(avail 600)에 들어가는 만큼만 보이고 나머지는 +N', () => {
    const fit = fitChipCount({ widths, optional: widths.map(() => false), avail: 600, gap: 4, moreWidth: 48 });
    expect(fit.visible.length).toBeLessThan(9);
    expect(fit.hidden).toBe(9 - fit.visible.length);
    expect(fit.hidden).toBeGreaterThan(0);
    expect(fit.visible).toEqual([...fit.visible].sort((a, b) => a - b));
  });

  it('선택 칩(범위)이 먼저 생략되고 필수 칩은 유지된다', () => {
    const fit = fitChipCount({ widths: [200, 200, 120], optional: [false, false, true], avail: 410, gap: 4, moreWidth: 48 });
    expect(fit.visible).toEqual([0, 1]);
    expect(fit.hidden).toBe(0);
  });
});

describe('시간 표기', () => {
  it('mm:ss', () => {
    expect(formatClock(492)).toBe('08:12');
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(3725)).toBe('62:05');
  });
});

/* ───────── H2 — 칩 줄·배너 파생 ───────── */

describe('deriveHostCase — 칩 줄(C02·C03·C11·C12·C14·C15) 우선순위와 문구', () => {
  const keys = (id: string, query = ''): string[] => deriveHostCase(buildHostCaseInput(id, new URLSearchParams(query)).input).chips.map((c) => c.key);
  const chip = <K extends string>(id: string, key: K) => deriveHostCase(buildHostCaseInput(id).input).chips.find((c) => c.key === key);

  it('C02: 손든 회원 2 칩이 밴드 요약 앞에 오고 손든 회원 우선 칩도 둔다', () => {
    expect(keys('C02')).toEqual(['hands', 'first', 'band']);
    const hands = chip('C02', 'hands');
    expect(hands && hands.key === 'hands' && hands.count).toBe(2);
    expect(hands?.label).toBe('손든 회원 2');
  });

  it('C03: 말하는 중 칩에 회원 이름과 참가자 id(회수 대상)가 실린다', () => {
    expect(keys('C03')).toEqual(['speak', 'band']);
    const speak = chip('C03', 'speak');
    expect(speak && speak.key === 'speak' && speak.name).toBe('지우');
    expect(speak && speak.key === 'speak' && speak.participantId).toBe('p3');
    expect(speak?.label).toBe('지우 말하는 중');
  });

  it('C11: 녹음 중 08:12 / 일시정지는 "기록 일시정지"', () => {
    const rec = chip('C11', 'rec');
    expect(rec?.label).toBe('녹음 중 08:12');
    const paused = deriveHostCase(buildHostCaseInput('C11', new URLSearchParams('rec=paused')).input).chips[0];
    expect(paused.key).toBe('rec');
    expect(paused.label).toBe('기록 일시정지');
  });

  it('C04 오프라인: 녹음 칩은 있고 발언권 칩·손든 회원 칩은 없다', () => {
    expect(keys('C04')).toEqual(['rec', 'band']);
  });

  it('C12: 접촉 확인 3 · 배터리 2 칩(접촉 불량이 있으면 경고 톤)', () => {
    const actions = chip('C12', 'actions');
    expect(actions && actions.key === 'actions' && [actions.leadOff, actions.lowBattery]).toEqual([3, 2]);
    expect(actions?.label).toBe('접촉 확인 3 · 배터리 2');
  });

  it('C14: 대기 3 칩과 대기자 명단(읽기 전용)', () => {
    const spec = buildHostCaseInput('C14');
    expect(spec.input.queue.map((q) => q.name)).toEqual(['가은', '윤우', '채아']);
    const queue = chip('C14', 'queue');
    expect(queue?.label).toBe('입장 대기 3');
  });

  it('C15: 내 밴드 칩(연결됨 · 이완 72) — 미착용이면 "내 밴드 미착용 · 선택"', () => {
    const connected = chip('C15', 'myband');
    expect(connected?.label).toBe('내 밴드 연결됨');
    expect(connected && connected.key === 'myband' && connected.relaxation).toBe(72);
    const unworn = deriveHostCase(buildHostCaseInput('C15', new URLSearchParams('selfband=off')).input).chips.find((c) => c.key === 'myband');
    expect(unworn?.label).toBe('내 밴드 미착용');
  });

  it('조용한 신호 응답이 있으면 칩이 생기고 0이면 없다', () => {
    const base = buildHostCaseInput('C01').input;
    expect(deriveHostCase({ ...base, quietSignalCount: 0 }).chips.some((c) => c.key === 'signals')).toBe(false);
    const withSignals = deriveHostCase({ ...base, quietSignalCount: 3 }).chips.find((c) => c.key === 'signals');
    expect(withSignals?.label).toBe('조용한 신호 3');
  });
});

describe('deriveHostCase — 배너(C09·C10·C16)', () => {
  const banner = (id: string, query = '') => deriveHostCase(buildHostCaseInput(id, new URLSearchParams(query)).input).banner;

  it('C09 마이크 꺼짐: info 배너 + 마이크 켜기', () => {
    const b = banner('C09');
    expect(b?.tone).toBe('info');
    expect(b?.title).toBe('마이크 꺼짐');
    expect(b?.detail).toBe('이 구간은 AI 기록에서 빠져요. 뇌파는 계속 기록돼요.');
    expect(b?.action).toEqual({ kind: 'act', act: 'mic', label: '마이크 켜기' });
  });

  it('C10 마이크 권한 거부: 코랄 배너 + 허용 방법(permmic 시트)', () => {
    const b = banner('C10');
    expect(b?.tone).toBe('coral');
    expect(b?.title).toBe('마이크를 쓸 수 없어요');
    expect(b?.detail).toBe('허용하면 AI 기록이 시작돼요. 허용하지 않아도 수업은 계속돼요.');
    expect(b?.action).toEqual({ kind: 'sheet', sheet: 'permmic', label: '허용 방법' });
  });

  it('오프라인에서는 마이크 배너가 없다(녹음 마이크 상태만)', () => {
    expect(banner('C09', 'loc=offline')).toBeNull();
  });

  it('C16 재연결 중: 연결이 불안정해요(버튼 없음) / 끊김: 다시 연결 버튼', () => {
    const reconnecting = banner('C16');
    expect(reconnecting?.title).toBe('연결이 불안정해요');
    expect(reconnecting?.detail).toBe('데이터 수신이 잠시 중단됐어요. 복구되면 이어서 기록돼요.');
    expect(reconnecting?.action).toBeNull();
    const down = banner('C16', 'net=down');
    expect(down?.title).toBe('연결이 끊겼어요');
    expect(down?.action).toEqual({ kind: 'act', act: 'retry', label: '다시 연결' });
  });

  it('네트워크 배너가 마이크 배너보다 우선한다', () => {
    expect(banner('C09', 'net=reconnecting')?.title).toBe('연결이 불안정해요');
  });
});

describe('summarizeCheckins — 체크인 요약(필요 조치 아님)', () => {
  it('C01: 응답 7명 중 질문별 분포와 살펴볼 응답을 만든다', () => {
    const summary = summarizeCheckins(buildHostCaseInput('C01').input.participants);
    expect(summary.total).toBe(8);
    expect(summary.responded).toBe(7);
    expect(summary.questions.map((q) => q.question)).toEqual(['마음의 날씨', '몸 상태', '수면']);
    expect(summary.attention.map((a) => a.name)).toEqual(['서아', '도윤']);
  });
});

describe('필요 조치 필터(기존 SessionMonitorSummary 필터 계승)', () => {
  const list = buildHostCaseInput('C12').input.participants;
  const ids = (filter: Parameters<typeof filterHostParticipants>[1]): string[] => filterHostParticipants(list, filter).map((p) => p.id);

  it('필터 없음·참여자는 전원', () => {
    expect(ids(null)).toHaveLength(8);
    expect(ids('participants')).toHaveLength(8);
  });

  it('접촉불량·배터리 부족·기기연결 실패는 해당 참가자만', () => {
    expect(ids('leadOff')).toEqual(['p2', 'p5', 'p8']);
    expect(ids('lowBattery')).toEqual(['p3', 'p7']);
    expect(ids('connectionFailed')).toEqual(['p6']);
  });

  it('필터가 켜지면 칩 줄에 해제 칩이 생긴다', () => {
    const input = buildHostCaseInput('C12').input;
    const c = deriveHostCase({ ...input, filter: 'leadOff' });
    const chip = c.chips.find((x) => x.key === 'filter');
    expect(chip?.label).toBe('필터 · 접촉불량');
  });

  it('카운트 요약은 SessionMonitorSummary 와 같은 4개 값', () => {
    expect(summarizeMonitorCounts(list)).toEqual({ participants: 8, leadOff: 3, connectionFailed: 1, lowBattery: 2 });
  });
});

describe('5분 추이 요약(H3)', () => {
  it('trendDelta 는 처음과 마지막 값의 차(반올림)이고 점이 2개 미만이면 null', () => {
    expect(trendDelta([60, 58, 53])).toBe(-7);
    expect(trendDelta([40.4, 49.6])).toBe(9);
    expect(trendDelta([50])).toBeNull();
    expect(trendDelta([])).toBeNull();
  });

  it('하니스 합성 추이는 60점이고 지표 범위를 벗어나지 않는다', () => {
    const p = buildHostCaseInput('C01').input.participants[0];
    const series = syntheticTrend(p, 'relaxation');
    expect(series).toHaveLength(60);
    expect(Math.min(...series)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...series)).toBeLessThanOrEqual(100);
    expect(series.at(-1)).toBeCloseTo(70, 0);
  });
});
