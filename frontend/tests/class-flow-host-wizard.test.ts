// SDD-209 H1 — 만들기 마법사 순수 로직: 단계 전이·유형/방식/인원·녹음·서버 페이로드
import { describe, expect, it } from 'vitest';
import {
  buildCreatePayload, capacityMax, clampCapacity, createInitialDraft, createInitialState, fmtDay, fmtDuration, isDraftDirty, maskEmail, wizardReducer,
  type WizardDraft, type WizardMember, type WizardState,
} from '../src/lib/class/class-wizard';

const BASE = new Date(2026, 9, 17, 12, 0, 0);
const member = (n: number): WizardMember => ({ id: `m${n}`, name: `회원${n}`, email: `m${n}@example.com` });
const run = (state: WizardState, ...actions: Parameters<typeof wizardReducer>[1][]): WizardState => actions.reduce(wizardReducer, state);

describe('wizardReducer 단계 이동', () => {
  it('1~5 범위를 벗어나지 않는다', () => {
    const s0 = createInitialState();
    expect(run(s0, { type: 'prev' }).step).toBe(1);
    const s5 = run(s0, { type: 'next' }, { type: 'next' }, { type: 'next' }, { type: 'next' }, { type: 'next' }, { type: 'next' });
    expect(s5.step).toBe(5);
    expect(run(s5, { type: 'prev' }).step).toBe(4);
  });

  it('입력을 직접 바꾸지 않고 복사본을 돌려준다', () => {
    const s0 = createInitialState();
    const s1 = run(s0, { type: 'patch', patch: { title: '새 이름' } });
    expect(s0.draft.title).toBe('');
    expect(s1.draft.title).toBe('새 이름');
  });
});

describe('유형·방식·인원', () => {
  it('1:1 로 바꾸면 선택한 회원을 1명으로 줄인다', () => {
    const base = createInitialState({ ...createInitialDraft(), members: [member(1), member(2), member(3)] });
    const solo = run(base, { type: 'setSize', size: 'solo' });
    expect(solo.draft.members.map((m) => m.id)).toEqual(['m1']);
    const again = run(solo, { type: 'toggleMember', member: member(2) });
    expect(again.draft.members).toHaveLength(1);
  });

  it('그룹은 한도까지만 선택할 수 있다', () => {
    let s = createInitialState();
    for (let i = 1; i <= 12; i += 1) s = run(s, { type: 'toggleMember', member: member(i) });
    expect(s.draft.members).toHaveLength(10);
    expect(run(s, { type: 'toggleMember', member: member(1) }).draft.members).toHaveLength(9);
  });

  it('온라인/오프라인 전환은 영상 녹화 선택값을 건드리지 않는다', () => {
    const s = run(createInitialState(), { type: 'patch', patch: { video: false } }, { type: 'setPlace', place: 'offline' }, { type: 'setPlace', place: 'online' });
    expect(s.draft.video).toBe(false);
  });
});

describe('일정 스텝퍼', () => {
  it('소요 시간은 5분 단위로 5~480분 안에서만 움직인다', () => {
    const s = createInitialState({ ...createInitialDraft(), durationMin: 5 });
    expect(run(s, { type: 'stepDuration', delta: -5 }).draft.durationMin).toBe(5);
    expect(run(s, { type: 'stepDuration', delta: 5 }).draft.durationMin).toBe(10);
    const max = createInitialState({ ...createInitialDraft(), durationMin: 480 });
    expect(run(max, { type: 'stepDuration', delta: 5 }).draft.durationMin).toBe(480);
  });

  it('분 스텝퍼는 시를 바꾸지 않고 5분 단위로 돈다', () => {
    const s = createInitialState({ ...createInitialDraft(), timeMin: 15 * 60 + 55 });
    expect(run(s, { type: 'stepMinute', delta: 5 }).draft.timeMin).toBe(15 * 60);
    expect(run(createInitialState({ ...createInitialDraft(), timeMin: 15 * 60 }), { type: 'stepMinute', delta: -5 }).draft.timeMin).toBe(15 * 60 + 55);
  });

  it('날짜는 오늘~13일 뒤', () => {
    const s = createInitialState({ ...createInitialDraft(), dayOffset: 0 });
    expect(run(s, { type: 'stepDay', delta: -1 }).draft.dayOffset).toBe(0);
    expect(run(createInitialState({ ...createInitialDraft(), dayOffset: 13 }), { type: 'stepDay', delta: 1 }).draft.dayOffset).toBe(13);
  });
});

describe('서버 페이로드', () => {
  const draft = (patch: Partial<WizardDraft>): WizardDraft => ({ ...createInitialDraft(), ...patch });

  it('온라인 그룹: sfu·영상 녹화 켜짐, 주소 없음', () => {
    const p = buildCreatePayload(draft({ address: '서울' }), BASE, false);
    expect(p).toMatchObject({ location_type: 'online', participant_mode: 'group', sfu_enabled: true, record_video: true, location_address: undefined });
  });

  it('오프라인 1:1: 영상 녹화 없음·1명 고정·주소 포함', () => {
    const p = buildCreatePayload(draft({ place: 'offline', size: 'solo', address: ' 서울 강남구 ' }), BASE, false);
    expect(p).toMatchObject({ location_type: 'offline', participant_mode: 'one_on_one', sfu_enabled: false, record_video: false, max_participants: 1, location_address: '서울 강남구' });
  });

  it('기타 유형은 custom 으로 보내고 이름을 함께 넣는다', () => {
    const p = buildCreatePayload(draft({ type: 'other', customName: ' 감정 코칭 ' }), BASE, false);
    expect(p.type).toBe('custom');
    expect(p.custom_type_name).toBe('감정 코칭');
  });

  it('지금 바로는 일정·리마인더가 없고, 예약은 5분 단위 일정과 리마인더를 보낸다', () => {
    const now = buildCreatePayload(draft({ when: 'now', remind: 'day' }), BASE, false);
    expect(now.scheduled_at).toBeUndefined();
    expect(now.reminder_offsets).toEqual([]);
    const later = buildCreatePayload(draft({ when: 'later', dayOffset: 1, timeMin: 15 * 60 + 15, remind: 'hour' }), BASE, true);
    expect(later.reminder_offsets).toEqual([60]);
    expect(later.force).toBe(true);
    expect(new Date(later.scheduled_at as string).getMinutes()).toBe(15);
  });

  it('음성 녹음을 끄면 영상 녹화도 보내지 않는다', () => {
    const p = buildCreatePayload(draft({ voice: false, video: true }), BASE, false);
    expect(p.record_audio).toBe(false);
    expect(p.record_video).toBe(false);
  });
});

describe('표시 도우미', () => {
  it('날짜·시간·마스킹', () => {
    expect(fmtDay(BASE, 0)).toBe('오늘 · 10월 17일 토');
    expect(fmtDay(BASE, 1)).toBe('내일 · 10월 18일 일');
    expect(fmtDay(BASE, 3)).toBe('3일 뒤 · 10월 20일 화');
    expect(fmtDuration(45)).toBe('45분');
    expect(fmtDuration(90)).toBe('1시간 30분');
    expect(maskEmail('hana.park@example.com')).toBe('ha***@…');
  });

  it('기본값이면 이탈 가드가 필요 없고 입력이 생기면 필요하다', () => {
    expect(isDraftDirty(createInitialDraft())).toBe(false);
    expect(isDraftDirty({ ...createInitialDraft(), title: 'a' })).toBe(true);
  });
});

describe('정원 스텐퍼 (D-5 ③)', () => {
  it('상한: 온라인 그룹 50 · 오프라인 그룹 100 · 1:1 1명', () => {
    expect(capacityMax('online', 'group')).toBe(50);
    expect(capacityMax('offline', 'group')).toBe(100);
    expect(capacityMax('online', 'solo')).toBe(1);
    expect(capacityMax('offline', 'solo')).toBe(1);
  });

  it('기본 정원은 10명이고 2명 밑으로 내려가지 않는다', () => {
    const s = createInitialState();
    expect(s.draft.capacity).toBe(10);
    expect(run(s, ...Array.from({ length: 20 }, () => ({ type: 'stepCapacity', delta: -1 }) as const)).draft.capacity).toBe(2);
  });

  it('온라인 그룹은 50명에서 멈춘다', () => {
    const s = createInitialState({ ...createInitialDraft(), capacity: 49 });
    expect(run(s, { type: 'stepCapacity', delta: 1 }).draft.capacity).toBe(50);
    expect(run(s, { type: 'stepCapacity', delta: 1 }, { type: 'stepCapacity', delta: 1 }).draft.capacity).toBe(50);
  });

  it('오프라인 그룹은 100명까지, 온라인으로 돌아오면 50명으로 줄인다', () => {
    const off = run(createInitialState({ ...createInitialDraft(), capacity: 99 }), { type: 'setPlace', place: 'offline' }, { type: 'stepCapacity', delta: 1 }, { type: 'stepCapacity', delta: 1 });
    expect(off.draft.capacity).toBe(100);
    expect(run(off, { type: 'setPlace', place: 'online' }).draft.capacity).toBe(50);
  });

  it('정원을 줄이면 초과 선택 회원을 정리한다', () => {
    const members = Array.from({ length: 8 }, (_, i) => member(i + 1));
    const s = run(createInitialState({ ...createInitialDraft(), members }), { type: 'patch', patch: { capacity: 5 } }, { type: 'stepCapacity', delta: -1 });
    expect(s.draft.capacity).toBe(4);
    expect(s.draft.members).toHaveLength(4);
  });

  it('회원 선택 한도는 정원, 1:1 은 1명', () => {
    let s = createInitialState({ ...createInitialDraft(), capacity: 3 });
    for (let i = 1; i <= 5; i += 1) s = run(s, { type: 'toggleMember', member: member(i) });
    expect(s.draft.members).toHaveLength(3);
    expect(run(s, { type: 'setSize', size: 'solo' }).draft.members).toHaveLength(1);
  });

  it('서버 max_participants: 그룹은 정원, 1:1 은 1', () => {
    expect(buildCreatePayload({ ...createInitialDraft(), capacity: 30 }, BASE, false).max_participants).toBe(30);
    expect(buildCreatePayload({ ...createInitialDraft(), size: 'solo', capacity: 30 }, BASE, false).max_participants).toBe(1);
    expect(buildCreatePayload({ ...createInitialDraft(), place: 'offline', capacity: 100 }, BASE, false).max_participants).toBe(100);
    expect(clampCapacity(120, 'offline', 'group')).toBe(100);
  });
});
