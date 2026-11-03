// SDD-279 V1~V8 — 시작 시각 값 변환(순수 함수) + reducer setTime
import { describe, expect, it } from 'vitest';
import { createInitialDraft, createInitialState, wizardReducer, MAX_TIME_MIN, MIN_TIME_MIN } from '../../src/lib/class/class-wizard';
import {
  allowedHours, hour24Of, minuteOptions, setHour, setMeridiem, setMinute, snapMinute, splitTime,
} from '../../src/lib/class/start-time';

describe('SDD-279 splitTime', () => {
  it('V1 경계 값을 오전/오후·12시간제·분으로 나눈다', () => {
    expect(splitTime(1140)).toEqual({ meridiem: 'pm', hour12: 7, minute: 0 });
    expect(splitTime(MIN_TIME_MIN)).toEqual({ meridiem: 'am', hour12: 7, minute: 0 });
    expect(splitTime(720)).toEqual({ meridiem: 'pm', hour12: 12, minute: 0 });
    expect(splitTime(MAX_TIME_MIN)).toEqual({ meridiem: 'pm', hour12: 10, minute: 0 });
    expect(splitTime(9 * 60 + 35)).toEqual({ meridiem: 'am', hour12: 9, minute: 35 });
  });
  it('V2 허용 시 목록: 오전 7~11, 오후 12·1~10', () => {
    expect(allowedHours('am')).toEqual([7, 8, 9, 10, 11]);
    expect(allowedHours('pm')).toEqual([12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(hour24Of('am', 9)).toBe(9);
    expect(hour24Of('pm', 12)).toBe(12);
    expect(hour24Of('pm', 7)).toBe(19);
  });
  it('V3 분 목록은 00~55 5분 단위 12개, 22시는 00 만 활성', () => {
    const regular = minuteOptions(15);
    expect(regular.map((m) => m.value)).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
    expect(regular.every((m) => !m.disabled)).toBe(true);
    const last = minuteOptions(22);
    expect(last.filter((m) => !m.disabled).map((m) => m.value)).toEqual([0]);
  });
});

describe('SDD-279 값 변경', () => {
  it('V4 오후 7:00 → 오전 은 오전 7:00', () => {
    expect(setMeridiem(1140, 'am')).toBe(420);
  });
  it('V5 오전 9:00 → 오후 는 오후 9:00, 허용 밖은 경계로', () => {
    expect(setMeridiem(540, 'pm')).toBe(1260);
    expect(setMeridiem(11 * 60, 'pm')).toBe(MAX_TIME_MIN);
    expect(setMeridiem(720, 'am')).toBe(MIN_TIME_MIN);
  });
  it('V6 오후 10시 + 분 30 은 22:00 으로 맞춘다', () => {
    expect(setMinute(setHour(1140, 'pm', 10), 30)).toBe(MAX_TIME_MIN);
    expect(setHour(1140 + 30, 'pm', 10)).toBe(MAX_TIME_MIN);
  });
  it('시·분 선택은 나머지를 보존한다', () => {
    expect(setHour(1140, 'am', 9)).toBe(540);
    expect(setMinute(540, 35)).toBe(575);
  });
  it('V7 5분 단위가 아닌 값은 표시용 snap 만 한다', () => {
    expect(snapMinute(17)).toBe(15);
    expect(snapMinute(18)).toBe(20);
    expect(snapMinute(58)).toBe(55);
    expect(snapMinute(0)).toBe(0);
  });
});

describe('SDD-279 reducer setTime', () => {
  it('V8 clamp(420..1320) 하고 다른 draft 필드는 건드리지 않는다', () => {
    const s = createInitialState({ ...createInitialDraft(), timeMin: 15 * 60 });
    const a = wizardReducer(s, { type: 'setTime', timeMin: 9 * 60 });
    expect(a.draft.timeMin).toBe(540);
    expect(a.draft).toEqual({ ...s.draft, timeMin: 540 });
    expect(wizardReducer(s, { type: 'setTime', timeMin: 100 }).draft.timeMin).toBe(MIN_TIME_MIN);
    expect(wizardReducer(s, { type: 'setTime', timeMin: 2000 }).draft.timeMin).toBe(MAX_TIME_MIN);
  });
});
