// 계정 삭제 안내 문구 — 설정 화면과 공개 /account-deletion 페이지가 같은 내용을 쓴다.

export const DELETION_GRACE_DAYS = 30;

export const DELETION_NOTICE_LINES: string[] = [
  '탈퇴하면 바로 로그아웃되고, 같은 계정으로 다시 로그인할 수 없어요.',
  `탈퇴 후 ${DELETION_GRACE_DAYS}일 동안은 다른 분들께 “탈퇴한 사용자”로만 표시돼요. ${DELETION_GRACE_DAYS}일이 지나면 프로필, 상담·수업 기록, 뇌파 데이터, 업로드 파일이 영구 삭제돼요.`,
  '삭제된 정보는 복구할 수 없어요.',
  '같은 클래스에 함께한 다른 분들의 기록과 기관의 공용 자료는 그대로 남아요.',
  '법령에 따라 보관해야 하는 정보가 있다면 그 기간 동안만 따로 보관하고, 기간이 끝나면 삭제해요.',
  `영구 삭제가 끝나기 전에는 같은 이메일로 다시 가입할 수 없어요.`,
];

export const DELETION_BLOCK_HINTS: Record<string, string> = {
  SOLE_ORG_ADMIN: '기관의 유일한 관리자예요. 다른 관리자를 지정한 뒤 탈퇴해 주세요.',
  SCHEDULED_SESSIONS_EXIST: '예정된 진행 회차가 남아 있어요. 회차를 정리하거나 다른 진행자에게 넘긴 뒤 탈퇴해 주세요.',
  REAUTH_REQUIRED: '본인 확인에 실패했어요. 다시 확인해 주세요.',
};
