// 회원 상담사 추가·관리 화면 문구 모음 (SDD-256)
// 용어를 '코치'로 일괄 변경하는 SDD-257 에서 이 파일만 고치면 되도록 한 곳에 모은다.

export const COUNSELOR_COPY = {
  listTitle: '담당 상담사',
  addButton: '상담사 추가',
  settingsTitle: '상담사 관리',
  settingsDescription: '연결된 상담사 · 코드로 추가',
  settingsAddButton: '코드로 상담사 추가',
  emptyList: '아직 연결된 상담사가 없어요',
  noOrg: '소속 기관 정보 없음',
  sheetTitle: '상담사 추가',
  sheetDescription: '상담사에게 받은 영문·숫자 6자리 코드를 입력해 주세요. 클래스 입장 코드는 사용할 수 없어요.',
  codeLabel: '상담사 코드',
  submit: '상담사 추가',
  submitting: '추가 중…',
  done: '완료',
  success: '상담사를 추가했어요.',
  successRefreshFailed: '추가했어요. 목록을 새로 확인하려면 다시 시도해 주세요.',
  invalidFormat: '영문·숫자 6자리만 입력할 수 있어요.',
  notFound: '유효하지 않은 상담사 코드입니다',
  duplicate: '이미 연결된 상담사입니다',
  orgInactive: '소속 기관이 비활성 상태라 연결할 수 없어요.',
  networkUnknown: '연결 결과를 확인하지 못했어요. 목록을 새로고침해 주세요.',
  generic: '상담사를 추가하지 못했어요. 잠시 후 다시 시도해 주세요.',
  loadFailed: '상담사 목록을 불러오지 못했어요.',
  retry: '다시 시도',
} as const;
