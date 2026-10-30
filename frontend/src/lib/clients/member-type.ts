import type { MemberType } from '../api/clients';

// 기관관리자 회원 목록의 회원/비회원 라벨 (비전문가용 문구)
export const MEMBER_TYPE_LABEL: Record<MemberType, string> = { member: '회원', non_member: '비회원' };
export const MEMBER_TYPE_HELP: Record<MemberType, string> = {
  member: '기관 클래스 또는 기관 상담에 등록된 회원',
  non_member: '기관 코치와 연결만 되어 있고 기관에는 아직 등록되지 않은 사람',
};
