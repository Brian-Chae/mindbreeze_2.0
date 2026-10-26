// 자주 묻는 질문 — 랜딩 #support 절과 공개 /support 페이지가 같은 내용을 쓴다.
// 상담·AI 비공개(기본)에서는 첫 출시 범위(명상 클래스) 기준 문구만 쓴다. 플래그를 켜면 기존 문구로 돌아간다.

import { isAiEnabled, isCounselingEnabled } from './feature-flags';

export interface SupportQuestion {
  question: string;
  answer: string;
}

export function supportQuestions(): SupportQuestion[] {
  const counseling = isCounselingEnabled();
  return [
    { question: 'LINK BAND가 없어도 사용할 수 있나요?', answer: isAiEnabled() ? '네. LINK BAND 착용은 선택입니다. 기기 없이도 상담 기록, AI 요약, 리포트 기능을 사용할 수 있습니다.' : '네. LINK BAND 착용은 선택입니다. 기기 없이도 클래스 기록과 리포트를 사용할 수 있습니다. 생체신호 분석은 측정 데이터가 있을 때 제공됩니다.' },
    counseling
      ? { question: '상담센터와 개인 전문가 모두 사용할 수 있나요?', answer: '상담센터의 세션 운영부터 상담사와 명상 지도자의 기록·리포트까지 지원합니다. 회원가입 후 이용 목적에 맞게 시작해 보세요. 기관 도입에 관한 상담은 아래 문의 이메일을 이용하실 수 있습니다.' }
      : { question: '기관과 개인 지도자 모두 사용할 수 있나요?', answer: '기관의 명상 클래스 운영부터 개인 명상 지도자의 클래스 기록·리포트까지 지원합니다. 회원가입 후 이용 목적에 맞게 시작해 보세요. 기관 도입은 아래 문의 이메일로 알려 주세요.' },
    { question: '참여자는 어떻게 클래스에 들어가나요?', answer: '상단의 ‘코드로 입장’을 선택하고 진행자에게 안내받은 입장 코드 4자리를 입력하세요. 초대받은 회원은 알림이나 클래스 목록에서 바로 입장할 수 있습니다.' },
    { question: '기기는 어떤 브라우저에서 연결하나요?', answer: 'LINK BAND 연결에는 Web Bluetooth를 지원하는 Chrome·Edge 등 Chromium 기반 브라우저가 필요합니다. Safari와 Firefox에서는 기기 연결을 지원하지 않습니다. 운영체제와 기기의 Bluetooth 지원 여부도 확인해 주세요.' },
    { question: '리포트는 무엇을 보여주나요?', answer: counseling ? '세션 기록과, 측정한 데이터가 있다면 몸과 마음 지표의 흐름을 보여줍니다. 지표의 상승·하강만으로 좋고 나쁨을 판단하지 않으며, 데이터가 부족하면 부족한 상태를 안내합니다. 전문가의 검토와 자신의 경험을 함께 참고해 주세요.' : '클래스 기록과, 측정한 데이터가 있다면 몸과 마음 지표의 흐름을 보여줍니다. 지표의 상승·하강만으로 좋고 나쁨을 판단하지 않으며, 데이터가 부족하면 부족한 상태를 안내합니다. 진행자의 안내와 자신의 경험을 함께 참고해 주세요.' },
    { question: '계정은 어떻게 삭제하나요?', answer: '앱의 설정 > 개인정보 · 약관 > 계정 삭제에서 탈퇴할 수 있습니다. 로그인할 수 없다면 계정 삭제 안내 페이지(/account-deletion)에서 가입한 이메일로 요청해 주세요.' },
  ];
}
