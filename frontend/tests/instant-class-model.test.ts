// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultInstantSettings, instantSchedule, instantTitle, loadInstantSettings, saveInstantSettings } from '../src/lib/class-structure/instant-class-model';
import { scheduleProblems } from '../src/lib/class-structure/scheduling-model';
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
describe('즉석 클래스 모델', () => {
  it.each([['2026-10-21T06:20:00Z', '즉석 명상 · 10월 21일 오후 3:20'], ['2026-10-20T15:00:00Z', '즉석 명상 · 10월 21일 오전 12:00'], ['2026-10-21T03:00:00Z', '즉석 명상 · 10월 21일 오후 12:00']])('KST 이름 %s', (date, expected) => { expect(instantTitle(new Date(date))).toBe(expected); });
  it('첫 사용 기본값과 독립 객체를 제공한다', () => {
    expect(defaultInstantSettings()).toMatchObject({ duration_min: 30, location_type: 'online', location_address: null, capacity: 10, linkband_mode: 'optional', record_audio: true, record_video: false, chat_enabled: false });
    expect(defaultInstantSettings()).not.toBe(defaultInstantSettings());
  });
  it('기존 검사와 호환되는 단일 진행자 즉시 일정을 만든다', () => {
    const value = instantSchedule({ ...defaultInstantSettings(), duration_min: 45 }, 'host-1', '즉석 명상');
    expect(value).toMatchObject({ title: '즉석 명상', duration_min: 45, schedule_mode: 'fixed', planned_session_count: 1, rows: [], ends_on: null, recurrence_rule: { start_now: true }, assignment_rule: { mode: 'all_one', host_ids: ['host-1'] }, instructors: [{ user_id: 'host-1', role: 'lead' }], member_ids: [] });
    expect(scheduleProblems(value)).toEqual([]);
    expect(instantSchedule({ ...defaultInstantSettings(), host_id: 'saved-host' }, 'current-host', '명상')).not.toHaveProperty('host_id');
    expect(scheduleProblems(instantSchedule({ ...defaultInstantSettings(), location_type: 'offline' }, '', '명상')).join(' ')).toMatch(/장소.*지도사/);
  });
  it('사용자별 설정만 저장하고 이름과 초대를 제외한다', () => {
    const settings = { ...defaultInstantSettings(), duration_min: 60, host_id: 'h2', title: '비밀', member_ids: ['m1'] };
    saveInstantSettings('u1', settings);
    expect(loadInstantSettings('u1')).toMatchObject({ duration_min: 60, host_id: 'h2' });
    expect(loadInstantSettings('u2')).toEqual(defaultInstantSettings());
    const saved = JSON.parse(localStorage.getItem('mb:instant-class:last:u1') ?? '{}');
    expect(saved).not.toHaveProperty('title'); expect(saved).not.toHaveProperty('member_ids');
  });
  it.each(['{broken', 'null', '[]', '{"duration_min":3}', '{"record_audio":"false"}'])('손상 설정 무시 %s', (value) => {
    localStorage.setItem('mb:instant-class:last:u1', value); expect(loadInstantSettings('u1')).toEqual(defaultInstantSettings());
  });
  it('복원 시 유효 범위를 기존 편성 검사로 확인한다', () => {
    localStorage.setItem('mb:instant-class:last:u1', JSON.stringify({ ...defaultInstantSettings(), duration_min: 3 }));
    expect(loadInstantSettings('u1')).toEqual(defaultInstantSettings());
  });
  it('저장소 실패는 생성 성공을 방해하지 않는다', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('차단'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('차단'); });
    expect(loadInstantSettings('u1')).toEqual(defaultInstantSettings());
    expect(() => saveInstantSettings('u1', defaultInstantSettings())).not.toThrow();
  });
});
