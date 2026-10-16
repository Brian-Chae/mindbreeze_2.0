// @vitest-environment jsdom
// SDD-208 H2 — 칩 줄·배너·시트(손든 회원·필요 조치·대기·내 밴드·체크인·도구·채팅)
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playerCases } from '../src/lib/class/fixtures/host-cases';
import { HARNESS_BACKDROP_SRC, type PlayerCaseContext } from '../src/lib/class/player-harness';

let root: Root;
let container: HTMLDivElement;

function ctxFor(query = ''): PlayerCaseContext {
  const params = new URLSearchParams(query);
  return { sheet: params.get('sheet') || null, detail: params.get('detail') || null, backdropSrc: HARNESS_BACKDROP_SRC, params };
}
async function renderCase(id: string, query = ''): Promise<void> {
  const node: ReactNode = playerCases[id].render(ctxFor(query));
  await act(async () => { root.render(node); });
}
async function setViewport(width: number, height: number): Promise<void> {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  await act(async () => { window.dispatchEvent(new Event('resize')); });
}
const all = (sel: string, scope: ParentNode = document): HTMLElement[] => [...scope.querySelectorAll<HTMLElement>(sel)];
const one = (sel: string, scope: ParentNode = document): HTMLElement | null => scope.querySelector<HTMLElement>(sel);
const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const buttonByText = (label: string, scope: ParentNode = document): HTMLElement | null =>
  all('button', scope).find((b) => text(b).includes(label) || b.getAttribute('aria-label')?.includes(label)) ?? null;
async function click(el: HTMLElement | null): Promise<void> {
  expect(el, '클릭 대상').not.toBeNull();
  await act(async () => { el?.click(); });
}
const sheet = (): HTMLElement | null => one('[data-pz="sheet"]');

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await setViewport(1280, 720);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('H2 칩 줄 — 손든 회원·말하는 중·녹음·필요 조치·대기·내 밴드', () => {
  it('C02: 손든 회원 2 칩, 손든 회원 우선 칩, 타일 손들기 배지', async () => {
    await renderCase('C02');
    const line = text(one('[data-pz="chipline"]'));
    expect(line).toContain('손든 회원 2');
    expect(line).toContain('손든 회원 우선');
    const handTiles = all('[data-pz="tile"][data-hand="true"]');
    expect(handTiles.map((t) => t.dataset.participantId)).toEqual(['p2', 'p5']);
    expect(handTiles.every((t) => text(t).includes('손듦 · 대기 중'))).toBe(true);
  });

  it('C02: 손든 회원 칩 → 손든 회원 시트에서 발언권 부여 → 말하는 중 칩 + 회수', async () => {
    await renderCase('C02');
    await click(buttonByText('손든 회원 2', one('[data-pz="chipline"]') ?? document));
    expect(sheet()).not.toBeNull();
    expect(text(sheet())).toContain('발언권 관리');
    const minjunRow = all('div', sheet() ?? document).find((d) => text(d.querySelector('p')) === '민준' && d.querySelector('button'));
    expect(minjunRow).toBeTruthy();
    await click(buttonByText('발언권 부여', minjunRow ?? document));
    expect(text(one('[data-pz="chipline"]'))).toContain('민준 말하는 중');
    expect(one('[data-pz="tile"][data-participant-id="p2"]')?.getAttribute('data-speaking')).toBe('true');
    await click(buttonByText('민준 발언권 회수', one('[data-pz="chipline"]') ?? document));
    expect(text(one('[data-pz="chipline"]'))).not.toContain('말하는 중');
  });

  it('C03: 말하는 중 칩 + 회수 버튼(참가자 이름 포함 라벨)', async () => {
    await renderCase('C03');
    const line = one('[data-pz="chipline"]');
    expect(text(line)).toContain('지우 말하는 중');
    expect(buttonByText('지우 발언권 회수', line ?? document)).not.toBeNull();
    expect(one('[data-pz="tile"][data-participant-id="p3"]')?.getAttribute('data-speaking')).toBe('true');
  });

  it('C11: 녹음 중 08:12 칩(붉은 점) — 눌러도 칩 라벨은 녹음 상태', async () => {
    await renderCase('C11');
    expect(text(one('[data-pz="chipline"]'))).toContain('녹음 중 08:12');
  });

  it('C04 오프라인: 녹음 칩만 있고 손든 회원·발언권 UI 는 없다', async () => {
    await renderCase('C04');
    const line = text(one('[data-pz="chipline"]'));
    expect(line).toContain('녹음 중 08:12');
    expect(line).not.toContain('손든');
    expect(line).not.toContain('말하는 중');
  });

  it('C12: 접촉 확인 3 · 배터리 2 칩 → 필요 조치 시트(SessionMonitorSummary 재사용 + 참가자 목록)', async () => {
    await renderCase('C12');
    expect(text(one('[data-pz="chipline"]'))).toContain('접촉 확인 3 · 배터리 2');
    await click(buttonByText('접촉 확인 3', one('[data-pz="chipline"]') ?? document));
    const s = sheet();
    expect(text(s)).toContain('필요 조치');
    expect(text(s)).toContain('접촉불량');
    expect(text(s)).toContain('밴드 배터리 부족');
    for (const name of ['민준', '서아', '시우', '지우', '예린']) expect(text(s)).toContain(name);
  });

  it('C12: 모두에게 안내 보내기 버튼은 없다(대응 API 없음, D13)', async () => {
    await renderCase('C12', 'sheet=actions');
    expect(text(sheet())).not.toContain('안내 보내기');
    expect(buttonByText('안내 보내기')).toBeNull();
  });

  it('C12: 필요 조치 시트의 접촉불량 요약을 누르면 그리드가 접촉 불량 3명만 남는다(필터)', async () => {
    await renderCase('C12', 'sheet=actions');
    expect(all('[data-pz="tile"]')).toHaveLength(8);
    await click(buttonByText('접촉불량', sheet() ?? document));
    expect(all('[data-pz="tile"]').map((t) => t.dataset.participantId)).toEqual(['p2', 'p5', 'p8']);
    expect(text(one('[data-pz="chipline"]'))).toContain('접촉불량');
    await click(buttonByText('접촉불량', sheet() ?? document));
    expect(all('[data-pz="tile"]')).toHaveLength(8);
  });

  it('C14: 대기 3 칩 → 대기 시트는 읽기 전용(입장 승인 버튼 없음)', async () => {
    await renderCase('C14');
    expect(text(one('[data-pz="chipline"]'))).toContain('대기 3');
    await click(buttonByText('대기', one('[data-pz="chipline"]') ?? document));
    const s = sheet();
    for (const name of ['가은', '윤우', '채아']) expect(text(s)).toContain(name);
    expect(text(s)).toContain('자리가 나면 자동으로 입장해요');
    expect(buttonByText('입장 승인')).toBeNull();
    expect(buttonByText('모두 승인')).toBeNull();
  });

  it('C15: 내 밴드 연결됨 · 이완 72 칩 → 내 밴드 시트(배터리·접촉·신호)', async () => {
    await renderCase('C15');
    expect(text(one('[data-pz="chipline"]'))).toContain('내 밴드 연결됨 · 이완 72');
    await click(buttonByText('내 밴드 연결됨', one('[data-pz="chipline"]') ?? document));
    const s = sheet();
    expect(text(s)).toContain('내 밴드');
    expect(text(s)).toContain('배터리 78%');
    expect(text(s)).toContain('내 지표는 나에게만 보여요');
    expect(buttonByText('연결 해제', s ?? document)).not.toBeNull();
  });

  it('C15 미착용: 선택 사항이라는 안내와 밴드 연결 버튼(경고색 없음)', async () => {
    await renderCase('C15', 'selfband=off&sheet=myband');
    const s = sheet();
    expect(text(s)).toContain('미착용');
    expect(text(s)).toContain('선택 사항이에요');
    expect(buttonByText('밴드 연결', s ?? document)).not.toBeNull();
  });

  it('알림 전체 시트는 칩 목록을 열기 버튼과 함께 보여 준다', async () => {
    await renderCase('C02', 'sheet=alerts');
    const s = sheet();
    expect(text(s)).toContain('알림 전체');
    expect(text(s)).toContain('손든 회원 2');
    expect(all('button', s ?? document).filter((b) => text(b) === '열기').length).toBeGreaterThan(0);
  });
});

describe('H2 배너 — 마이크·네트워크', () => {
  it('C09: 마이크 꺼짐 info 배너 → 마이크 켜기를 누르면 배너가 사라지고 셀프뷰 마이크 아이콘이 켜짐', async () => {
    await renderCase('C09');
    const banner = one('[data-pz="banner"]');
    expect(text(banner)).toContain('마이크 꺼짐');
    expect(text(banner)).toContain('이 구간은 AI 기록에서 빠져요. 뇌파는 계속 기록돼요.');
    await click(buttonByText('마이크 켜기', banner ?? document));
    expect(one('[data-pz="banner"]')).toBeNull();
  });

  it('C10: 마이크 권한 거부 코랄 배너와 허용 방법 버튼', async () => {
    await renderCase('C10');
    const banner = one('[data-pz="banner"]');
    expect(banner?.getAttribute('data-tone')).toBe('coral');
    expect(text(banner)).toContain('마이크를 쓸 수 없어요');
    expect(text(banner)).toContain('허용하지 않아도 수업은 계속돼요');
    expect(buttonByText('허용 방법', banner ?? document)).not.toBeNull();
  });

  it('C16 재연결 중: 불안정 배너(버튼 없음), 연결된 타일은 수신 일시 중단 + 값 흐림', async () => {
    await renderCase('C16');
    const banner = one('[data-pz="banner"]');
    expect(text(banner)).toContain('연결이 불안정해요');
    expect(text(banner)).toContain('데이터 수신이 잠시 중단됐어요. 복구되면 이어서 기록돼요.');
    expect(banner?.querySelector('button')).toBeNull();
    const onTiles = all('[data-pz="tile"][data-band="on"]');
    expect(onTiles).toHaveLength(5);
    expect(onTiles.every((t) => text(t).includes('수신 일시 중단'))).toBe(true);
    expect(one('.hp-grid')?.getAttribute('data-net-bad')).toBe('true');
  });

  it('C16 끊김: 데이터 보관 안내 + 다시 연결 버튼', async () => {
    await renderCase('C16', 'net=down');
    const banner = one('[data-pz="banner"]');
    expect(text(banner)).toContain('연결이 끊겼어요');
    expect(text(banner)).toContain('밴드 데이터는 기기에 보관 중이에요');
    expect(buttonByText('다시 연결', banner ?? document)).not.toBeNull();
  });
});

describe('H2 시트 — 체크인·도구·채팅·지표 기준', () => {
  it('체크인 시트: 응답 수·질문별 분포·살펴볼 응답, 입장 전 체크인은 CheckinSummary 재사용', async () => {
    await renderCase('C01', 'sheet=checkin');
    const s = sheet();
    expect(text(s)).toContain('체크인 요약');
    expect(text(s)).toContain('7');
    expect(text(s)).toContain('/ 8명');
    expect(text(s)).toContain('마음의 날씨');
    expect(text(s)).toContain('살펴볼 응답');
    expect(text(s)).toContain('서아');
    expect(text(s)).toContain('어깨가 많이 뻐근해요');
    expect(text(s)).toContain('입장 전 체크인');
    expect(text(s)).toContain('집중 4');
  });

  it('도구 시트: 정렬(낮은 순)을 고르면 그리드가 값 오름차순이 된다', async () => {
    await renderCase('C01', 'sheet=tools');
    await click(buttonByText('낮은 순', sheet() ?? document));
    const ids = all('[data-pz="tile"]').map((t) => t.dataset.participantId);
    expect(ids.slice(0, 5)).toEqual(['p5', 'p2', 'p1', 'p7', 'p3']);
  });

  it('도구 시트: 표로 보기를 켜면 표가 나오고 타일은 사라진다', async () => {
    await renderCase('C01', 'sheet=tools');
    await click(one('[role="switch"][aria-label="표로 보기"]'));
    expect(one('[data-pz="table"]')).not.toBeNull();
    expect(all('[data-pz="tile"]')).toHaveLength(0);
    expect(all('[data-pz="table"] tbody tr')).toHaveLength(8);
  });

  it('도구 시트: 참여 코드와 코드 복사', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await renderCase('C01', 'sheet=tools');
    expect(text(sheet())).toContain('MIND24');
    await click(buttonByText('코드 복사', sheet() ?? document));
    expect(writeText).toHaveBeenCalledWith('MIND24');
  });

  it('도구 시트: 1:1·오프라인에서는 손든 회원 우선 스위치가 없다', async () => {
    await renderCase('C04', 'sheet=tools');
    expect(one('[role="switch"][aria-label="손든 회원 우선"]')).toBeNull();
    expect(one('[role="switch"][aria-label="표로 보기"]')).not.toBeNull();
  });

  it('채팅 시트: 메시지 목록과 입력창(채팅 켜기/끄기 스위치 포함)', async () => {
    await renderCase('C01', 'sheet=chat');
    const s = sheet();
    expect(text(s)).toContain('채팅');
    expect(text(s)).toContain('마음이 한결 편안해졌어요');
    expect(one('input[aria-label="메시지 입력"]', s ?? document)).not.toBeNull();
    expect(one('[role="switch"][aria-label="채팅 받기"]', s ?? document)).not.toBeNull();
  });

  it('도크 채팅 안읽음 배지는 채팅 시트를 열면 사라진다', async () => {
    await renderCase('C01');
    expect(text(all('[data-pz="dk"]')[1])).toContain('3');
    await click(all('[data-pz="dk"]')[1]);
    expect(text(all('[data-pz="dk"]')[1])).not.toContain('3');
  });

  it('지표 기준 시트에서 지표를 바꾸면 띠 이름과 타일 라벨이 함께 바뀐다', async () => {
    await renderCase('C01', 'sheet=metric');
    await click(buttonByText('집중도', sheet() ?? document));
    expect(one('[data-pz="mstrip"]')?.getAttribute('data-metric')).toBe('focus');
    const labels = all('[data-pz="tile"][data-band="on"] .hp-ring-label').map((el) => text(el));
    expect(new Set(labels)).toEqual(new Set(['집중']));
  });

  it('시트는 동시에 1개이고 도크 항목을 다시 누르면 닫힌다', async () => {
    await renderCase('C01', 'sheet=tools');
    expect(all('[data-pz="sheet"]')).toHaveLength(1);
    await click(buttonByText('채팅', one('[data-pz="dock"]') ?? document));
    expect(all('[data-pz="sheet"]')).toHaveLength(1);
    expect(text(sheet())).toContain('채팅');
    await click(buttonByText('채팅', one('[data-pz="dock"]') ?? document));
    expect(sheet()).toBeNull();
  });
});

