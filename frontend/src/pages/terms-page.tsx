import { OPERATIONS_EMAIL, PRIVACY_OFFICER, WELLNESS_DISCLAIMER } from '../lib/legal-copy';
export function TermsPage() {
  return <main className="mx-auto max-w-3xl space-y-6 p-6 text-ink-primary">
    <h1 className="text-2xl font-bold">서비스 이용약관</h1>
    <section><h2>이용 대상과 서비스</h2><p>만 14세 이상 이용할 수 있습니다. MIND BREEZE는 기관·진행자·회원의 상담 및 명상 운영, 기록, 선택적 뇌파 측정과 참고 리포트를 돕습니다. LINK BAND 없이도 이용할 수 있습니다. 현재 AI 기능은 제공하지 않습니다.</p></section>
    <section><h2>동의와 개인정보</h2><p>이용약관·개인정보 처리 및 클래스 기록의 민감정보 동의는 필수입니다. 뇌파 수집과 연구 활용은 각각 독립된 선택 동의이며, 거부해도 기본 서비스를 이용할 수 있습니다. 회차별 녹음·녹화 동의가 없으면 해당 클래스에 입장할 수 없습니다.</p><a href="/privacy">개인정보 처리방침</a></section>
    <section><h2>금지행위와 제재</h2><p>타인 사칭, 괴롭힘, 불법 정보 게시, 동의 없는 개인정보 공유, 무단 접근 및 서비스 운영 방해를 금지합니다. 위반 시 사안에 따라 게시물 제한, 이용 정지 또는 계정 해지 조치를 할 수 있으며, 운영 이메일로 이의를 제기할 수 있습니다.</p></section>
    <section><h2>계정 탈퇴</h2><p>설정에서 탈퇴를 요청하면 접근이 즉시 차단됩니다. 탈퇴일부터 30일 후 개인 데이터를 영구 삭제하며, 삭제가 완료되기 전까지 동일 이메일로 재가입할 수 없습니다. 타인의 자료와 비식별 그룹 집계는 유지될 수 있습니다. 공유 세션의 혼합 녹음·영상은 세션 소유자의 자료로 보존되며, 개인 식별 텍스트는 삭제하거나 익명화합니다.</p></section>
    <section><h2>참고 정보의 한계</h2><p>{WELLNESS_DISCLAIMER}</p><a href="/measurement-guide">측정 방법</a> · <a href="/crisis-help">긴급 도움 안내</a></section>
    <section><h2>운영 및 문의</h2><p>개인정보 보호책임자: {PRIVACY_OFFICER}</p><a href={`mailto:${OPERATIONS_EMAIL}`}>{OPERATIONS_EMAIL}</a><p>기관 도입은 웹 또는 영업 문의로 진행됩니다.</p></section>
  </main>;
}
