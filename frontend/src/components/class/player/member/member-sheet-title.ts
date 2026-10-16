// SDD-208 — 회원 시트 제목. 접촉 불량(leadoff)일 때 기기 시트는 "접촉 확인"이 된다(시안 M10).
import type { BandUi } from '../../../../lib/class/player-case';
import type { MemberSheetKey } from './member-view-types';

const TITLES: Record<MemberSheetKey, string> = { status: '내 상태', chat: '채팅', signal: '조용한 신호', sound: '소리', device: '기기' };

export function memberSheetTitle(key: MemberSheetKey, band: BandUi): string {
  return key === 'device' && band === 'leadoff' ? '접촉 확인' : TITLES[key];
}
