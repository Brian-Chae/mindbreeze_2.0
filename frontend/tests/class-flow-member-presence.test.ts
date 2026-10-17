// SDD-209 BE-10 — 회원 준비 현황(presence) 계약 변환과 호스트 로비 전극 접촉 표시
import { describe, expect, it } from 'vitest';
import { buildMemberReadiness, leadOffFromBand, toWaitingRoomBand } from '../src/lib/class/flow/member-presence';
import { deriveLobbyRow } from '../src/lib/class/flow/host-lobby-model';

const base = { place: 'online', bandMode: 'opt', survey: 'none', bandOutcome: 'none', mic: 'unknown', band: null } as const;

describe('buildMemberReadiness', () => {
  it('아무것도 안 했으면 완료 boolean 3종이 모두 false(서버 규칙: 3종이 모두 boolean 이어야 통과)', () => {
    const r = buildMemberReadiness(base);
    expect(r).toMatchObject({ surveyDone: false, bandDone: false, deviceDone: false, surveySkipped: false, bandSkipped: false });
    expect(r.band).toBeNull();
  });

  it('설문 건너뜀·밴드 없이 계속 → 완료 + skipped', () => {
    const r = buildMemberReadiness({ ...base, survey: 'skipped', bandOutcome: 'skipped', mic: 'on' });
    expect(r).toMatchObject({ surveyDone: true, surveySkipped: true, bandDone: true, bandSkipped: true, deviceDone: true });
  });

  it('밴드를 쓰지 않는 클래스·오프라인은 해당 단계를 완료로 보고 band 는 보내지 않는다', () => {
    const r = buildMemberReadiness({ ...base, place: 'offline', bandMode: 'none', band: { state: 'connected', leadOff: null, battery: 80 } });
    expect(r).toMatchObject({ bandDone: true, bandSkipped: false, deviceDone: true });
    expect(r.band).toBeNull();
  });

  it('밴드 스냅샷은 서버 계약(state·lead_off{ch1,ch2}·battery)으로 변환', () => {
    const r = buildMemberReadiness({ ...base, bandOutcome: 'connected', band: { state: 'leadoffl', leadOff: { ch1: true, ch2: false }, battery: 64 } });
    expect(r.band).toEqual({ state: 'leadoffl', lead_off: { ch1: true, ch2: false }, battery: 64 });
  });
});

describe('toWaitingRoomBand — 서버가 버릴 값은 미리 null', () => {
  it('식별자 형식 위반·배터리 범위 밖·소수는 null', () => {
    expect(toWaitingRoomBand({ state: 'Bad-State', leadOff: null, battery: 101 })).toEqual({ state: null, lead_off: null, battery: null });
    expect(toWaitingRoomBand({ state: 'connected', leadOff: null, battery: 55.5 })?.battery).toBeNull();
    expect(toWaitingRoomBand(null)).toBeNull();
  });
});

describe('leadOffFromBand + 호스트 로비 행', () => {
  it('두 채널이 boolean 일 때만 접촉 상태로 본다', () => {
    expect(leadOffFromBand({ state: 'x', lead_off: { ch1: true, ch2: false }, battery: null })).toEqual({ ch1: true, ch2: false });
    expect(leadOffFromBand({ state: 'x', lead_off: { ch1: true, ch2: null }, battery: null })).toBeNull();
    expect(leadOffFromBand({ state: 'x', lead_off: null, battery: null })).toBeNull();
    expect(leadOffFromBand(undefined)).toBeNull();
  });

  it('중계된 접촉 불량이 로비 행의 밴드 셀을 bad 로 만들고 전극을 채운다', () => {
    const ctx = { place: 'online', size: 'group', band: 'opt' } as const;
    const readiness = { surveyDone: true, bandDone: true, deviceDone: true };
    const bad = deriveLobbyRow('p1', '회원 A', { participantId: 'p1', nickname: null, readiness, leadOff: leadOffFromBand({ state: 'leadoffl', lead_off: { ch1: true, ch2: false }, battery: 50 }) }, ctx);
    expect(bad.band).toBe('bad');
    expect(bad.ready).toBe(false);
    expect(bad.electrodes).toEqual({ left: 'bad', ref: 'bad', right: 'good' });
    const good = deriveLobbyRow('p1', '회원 A', { participantId: 'p1', nickname: null, readiness, leadOff: { ch1: false, ch2: false } }, ctx);
    expect(good.band).toBe('ok');
  });
});
