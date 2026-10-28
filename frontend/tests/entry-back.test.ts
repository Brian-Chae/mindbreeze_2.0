import { describe, expect, it } from 'vitest';
import { resolveEntryBack } from '../src/lib/class/entry-back';

// 경로별 뒤로가기 목적지 — 홈 카드·토스트·알림 목록은 history 가 있고, 푸시·초대 링크 직접 진입은 idx 0.
describe('resolveEntryBack', () => {
  it('로그인 회원이 홈 카드/토스트/알림 목록으로 들어오면(idx>0) 이전 화면으로', () => {
    expect(resolveEntryBack({ historyIdx: 2, isAuthenticated: true, isGuest: false })).toEqual({ kind: 'history' });
  });
  it('로그인 회원이 푸시 탭·초대 링크로 바로 열면(idx 0 / 없음) 회원 홈으로', () => {
    expect(resolveEntryBack({ historyIdx: 0, isAuthenticated: true, isGuest: false })).toEqual({ kind: 'path', path: '/app' });
    expect(resolveEntryBack({ historyIdx: undefined, isAuthenticated: true, isGuest: false })).toEqual({ kind: 'path', path: '/app' });
  });
  it('비로그인 코드 입장은 입장 코드 화면으로', () => {
    expect(resolveEntryBack({ historyIdx: 3, isAuthenticated: false, isGuest: true })).toEqual({ kind: 'path', path: '/join' });
  });
  it('로그인 상태라도 게스트 자격이면 코드 화면으로', () => {
    expect(resolveEntryBack({ historyIdx: 1, isAuthenticated: true, isGuest: true })).toEqual({ kind: 'path', path: '/join' });
  });
});
