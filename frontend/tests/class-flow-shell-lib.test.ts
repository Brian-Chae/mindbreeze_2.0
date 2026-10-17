// SDD-209 SH1 — 셸형 순수 로직: 배지 키·시각 문구·히어로 선정·입장 CTA 판정
import { describe, expect, it } from 'vitest';
import {
  CLASS_CHIP_KEYS, CLASS_CHIP_LABELS, SOON_WINDOW_MIN, bandLabel, classTypeLabel, hostChipKey, memberChipKey, placeLabel, sizeLabel,
} from '../src/lib/class/class-labels';
import { formatClassWhen, formatElapsed, formatStartsIn, minutesUntil } from '../src/lib/class/class-when';
import { deriveDetailAction, deriveHeroAction } from '../src/lib/class/enter-action';
import { pickHeroClass } from '../src/lib/class/pick-hero-class';

// 2026-10-17(토) 12:00 — 실행 환경의 시간대와 무관하도록 로컬 시각으로 만든다
const NOW = new Date(2026, 9, 17, 12, 0);
const L = (day: number, hour: number, minute = 0): string => new Date(2026, 9, day, hour, minute).toISOString();

interface Fake { id: string; status: 'ready' | 'scheduled' | 'open' | 'in_progress' | 'completed' | 'cancelled'; scheduled_at: string | null; started_at: string | null }
const fake = (id: string, status: Fake['status'], scheduledAt: string | null, startedAt: string | null = null): Fake =>
  ({ id, status, scheduled_at: scheduledAt, started_at: startedAt });

describe('class-labels', () => {
  it('배지 키 8개가 라벨 표와 1:1', () => {
    expect([...CLASS_CHIP_KEYS].sort()).toEqual(['cancelled', 'done', 'invited', 'live', 'open', 'ready', 'scheduled', 'soon']);
    for (const key of CLASS_CHIP_KEYS) expect(CLASS_CHIP_LABELS[key].length).toBeGreaterThan(0);
    expect(CLASS_CHIP_LABELS.open).toBe('입장 가능');
    expect(CLASS_CHIP_LABELS.live).toBe('진행 중');
  });
  it('방식 라벨: 1:N 이 아니라 그룹, LB 가 아니라 LINK BAND', () => {
    expect(placeLabel('online')).toBe('온라인');
    expect(placeLabel('offline')).toBe('오프라인');
    expect(sizeLabel('group')).toBe('그룹');
    expect(sizeLabel('one_on_one')).toBe('1:1');
    expect(bandLabel('none')).toBe('LINK BAND 사용 안 함');
    expect(bandLabel('optional')).toBe('LINK BAND 선택');
    expect(bandLabel('required')).toBe('LINK BAND 필수');
  });
  it('유형 라벨: 명상 클래스, 기타는 사용자 이름 우선', () => {
    expect(classTypeLabel('meditation', null)).toBe('명상 클래스');
    expect(classTypeLabel('clinical', null)).toBe('임상심리상담');
    expect(classTypeLabel('custom', '호흡 모임')).toBe('호흡 모임');
    expect(classTypeLabel('custom', null)).toBe('기타');
  });
  it('회원 배지: 상태 → 키, 예약 60분 이내는 곧 열림', () => {
    expect(SOON_WINDOW_MIN).toBe(60);
    expect(memberChipKey('scheduled', L(20, 15, 0), NOW)).toBe('scheduled');
    expect(memberChipKey('scheduled', L(17, 12, 40), NOW)).toBe('soon');
    expect(memberChipKey('scheduled', L(17, 13, 0), NOW)).toBe('soon');
    expect(memberChipKey('scheduled', L(17, 13, 1), NOW)).toBe('scheduled');
    expect(memberChipKey('ready', null, NOW)).toBe('scheduled');
    expect(memberChipKey('open', null, NOW)).toBe('open');
    expect(memberChipKey('in_progress', null, NOW)).toBe('live');
    expect(memberChipKey('completed', null, NOW)).toBe('done');
    expect(memberChipKey('cancelled', null, NOW)).toBe('cancelled');
  });
  it('상담사 배지: 준비/예정/입장 가능/진행 중/완료/취소', () => {
    expect(hostChipKey('ready')).toBe('ready');
    expect(hostChipKey('scheduled')).toBe('scheduled');
    expect(hostChipKey('open')).toBe('open');
    expect(hostChipKey('in_progress')).toBe('live');
    expect(hostChipKey('completed')).toBe('done');
    expect(hostChipKey('cancelled')).toBe('cancelled');
  });
});

describe('class-when', () => {
  it('오늘·내일·그 외 날짜 문구', () => {
    expect(formatClassWhen(L(17, 15, 0), NOW)).toBe('오늘 오후 3:00');
    expect(formatClassWhen(L(18, 10, 0), NOW)).toBe('내일 오전 10:00');
    expect(formatClassWhen(L(22, 19, 0), NOW)).toBe('10월 22일 (목) 오후 7:00');
    expect(formatClassWhen(L(16, 15, 0), NOW)).toBe('어제 오후 3:00');
    expect(formatClassWhen(null, NOW)).toBe('바로 입장할 수 있어요');
  });
  it('자정·정오 경계', () => {
    expect(formatClassWhen(L(17, 12, 5), NOW)).toBe('오늘 오후 12:05');
    expect(formatClassWhen(L(18, 0, 30), NOW)).toBe('내일 오전 12:30');
  });
  it('남은 시간', () => {
    expect(minutesUntil(L(17, 12, 30), NOW)).toBe(30);
    expect(minutesUntil(null, NOW)).toBeNull();
    expect(formatStartsIn(L(17, 12, 30), NOW)).toBe('30분');
    expect(formatStartsIn(L(18, 7, 0), NOW)).toBe('19시간');
    expect(formatStartsIn(L(20, 14, 0), NOW)).toBe('3일 2시간');
    expect(formatStartsIn(L(17, 11, 0), NOW)).toBe('');
  });
  it('진행 경과', () => {
    expect(formatElapsed(L(17, 11, 48), NOW)).toBe('12분째');
    expect(formatElapsed(null, NOW)).toBe('');
  });
});

describe('pick-hero-class', () => {
  it('진행 중 > 입장 가능 > 가장 임박한 예약 > 일정 없는 준비', () => {
    const list = [
      fake('r', 'ready', null),
      fake('s2', 'scheduled', L(22, 19, 0)),
      fake('s1', 'scheduled', L(20, 15, 0)),
      fake('o', 'open', L(17, 15, 0)),
      fake('l', 'in_progress', L(17, 11, 0), L(17, 11, 48)),
      fake('d', 'completed', L(16, 15, 0)),
    ];
    expect(pickHeroClass(list, NOW)?.id).toBe('l');
    expect(pickHeroClass(list.filter((s) => s.id !== 'l'), NOW)?.id).toBe('o');
    expect(pickHeroClass(list.filter((s) => !['l', 'o'].includes(s.id)), NOW)?.id).toBe('s1');
    expect(pickHeroClass(list.filter((s) => s.id === 'r' || s.id === 'd'), NOW)?.id).toBe('r');
  });
  it('시작 시각이 지났지만 아직 열리지 않은 예약도 버리지 않는다', () => {
    const list = [fake('late', 'scheduled', L(17, 11, 0)), fake('next', 'scheduled', L(20, 15, 0))];
    expect(pickHeroClass(list, NOW)?.id).toBe('late');
  });
  it('완료·취소만 있으면 null', () => {
    expect(pickHeroClass([fake('d', 'completed', null), fake('c', 'cancelled', null)], NOW)).toBeNull();
    expect(pickHeroClass([], NOW)).toBeNull();
  });
});

describe('enter-action', () => {
  it('상세 CTA: 열림 전엔 비활성, 열리면 입장, 완료는 리포트, 취소는 목록', () => {
    expect(deriveDetailAction('scheduled')).toMatchObject({ kind: 'disabled', label: '입장하기', disabled: true });
    expect(deriveDetailAction('soon')).toMatchObject({ kind: 'enter', label: '입장 대기하기', disabled: false });
    expect(deriveDetailAction('open')).toMatchObject({ kind: 'enter', label: '입장하기', disabled: false });
    expect(deriveDetailAction('live')).toMatchObject({ kind: 'enter', label: '입장하기', disabled: false });
    expect(deriveDetailAction('done')).toMatchObject({ kind: 'report', label: '리포트 보기', disabled: false });
    expect(deriveDetailAction('cancelled')).toMatchObject({ kind: 'list', label: '클래스 목록 보기', disabled: false });
    expect(deriveDetailAction('open').note).toBe('준비는 2분이면 끝나요');
    expect(deriveDetailAction('scheduled').note).toBe('클래스가 열리면 알려드려요');
  });
  it('홈 히어로 CTA: 예정은 클래스 보기(상세), 곧 열림은 입장 대기하기', () => {
    expect(deriveHeroAction('scheduled')).toMatchObject({ kind: 'view', label: '클래스 보기', line: true });
    expect(deriveHeroAction('soon')).toMatchObject({ kind: 'enter', label: '입장 대기하기', line: false });
    expect(deriveHeroAction('open')).toMatchObject({ kind: 'enter', label: '입장하기' });
    expect(deriveHeroAction('live')).toMatchObject({ kind: 'enter', label: '입장하기' });
  });
});
