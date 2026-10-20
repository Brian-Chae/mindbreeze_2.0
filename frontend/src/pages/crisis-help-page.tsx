import { OPERATIONS_EMAIL, TODO_VERIFIED_CRISIS_CONTACTS } from '../lib/legal-copy';
export function CrisisHelpPage() {
  return <main className="mx-auto max-w-3xl space-y-6 p-6 text-ink-primary">
    <h1 className="text-2xl font-bold">긴급한 도움이 필요할 때</h1>
    <p>이 서비스와 운영 이메일은 긴급 상황을 실시간으로 확인하거나 대응하는 창구가 아닙니다.</p>
    <p>지금 안전이 위협받고 있다면 혼자 있지 말고 가까운 사람에게 알리세요. 안전한 장소로 이동하고 가까운 응급실이나 현지 긴급 구조기관에 즉시 도움을 요청하세요.</p>
    {TODO_VERIFIED_CRISIS_CONTACTS.map((contact) => <p key={contact.name}><a href={`tel:${contact.phone}`}>{contact.name}: {contact.phone}</a> · <a href={contact.source}>공식 안내</a></p>)}
    <p>공공 긴급 연락처는 공식 안내 확인 후 게시할 예정입니다.</p>
    <a href={`mailto:${OPERATIONS_EMAIL}`}>일반 운영 문의</a>
  </main>;
}
