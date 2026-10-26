// 데이터 센터 화면에 내부 코드(영문 enum)를 그대로 보이지 않도록 일반 한국어로 바꾼다.
const EXCLUSION_REASONS: Record<string, string> = {
  consent_missing: '뇌파 수집 미동의',
  band_not_used: '밴드 미착용',
  not_collected: '측정 데이터 없음',
  not_completed: '회차 미종료',
  attribution_unknown: '소속 기관 확인 불가',
  unsupported_client: '지원하지 않는 기기에서 측정',
  expired: '보관 기간 만료',
  withdrawn: '동의 철회',
  lost: '데이터 유실',
  unknown: '확인할 수 없음',
  retention_deadline_unknown: '보관 기한 확인 불가',
  out_of_range: '선택한 구간 밖',
  pending_upload: '업로드 진행 중',
  policy_blocked: '정책상 내려받을 수 없음',
  manifest_not_connected: '측정 파일 목록을 아직 불러올 수 없음',
  no_eligible_targets: '내려받을 수 있는 데이터가 없음',
};
const SIGNALS: Record<string, string> = {
  eeg: '뇌파', ppg: '맥파', acc: '움직임', features: '분석 값', indices: '지표 이력', eeg_raw: '뇌파', ppg_raw: '맥파', acc_raw: '움직임',
};
const NOTICES: Record<string, string> = {
  raw_bin_redacted_packet_view: '원본 파일은 개인을 알아볼 수 있는 정보를 가린 형태로 제공됩니다.',
};
const AVAILABILITY: Record<string, string> = {
  available: '수집됨', not_collected: '수집되지 않음', unsupported_client: '지원하지 않는 기기', expired: '보관 기간 만료',
  withdrawn: '동의 철회', lost: '데이터 유실', unknown: '확인할 수 없음', blocked: '정책상 제한',
};
const MANIFEST_STATES: Record<string, string> = {
  not_connected: '준비 전', complete: '정상', partial: '일부만 있음', pending_upload: '업로드 중', unknown: '확인할 수 없음',
};
const CONSENT_STATES: Record<string, string> = { agreed: '동의', withdrawn: '철회', none: '미동의', unknown: '확인할 수 없음' };
const DEFAULT_VIEWS: Record<string, string> = { participant_player: '참여자 화면 기준', unavailable: '표시할 데이터 없음' };
const JOB_ERRORS: Record<string, string> = {
  queue_unavailable: '작업 대기열에 등록하지 못했습니다',
  package_builder_unavailable: '파일 생성기를 사용할 수 없습니다',
  scope_changed: '대상의 권한·동의가 바뀌어 중단되었습니다',
  access_revoked: '대상의 권한·동의가 바뀌어 중단되었습니다',
  source_expired: '원천 보관 기한이 지났습니다',
};
const AUDIT_EVENTS: Record<string, string> = {
  previewed: '다운로드할 데이터 확인', requested: '작업 요청', queued: '대기', preparing: '준비', ready: '준비 완료',
  failed: '실패', expired: '만료', cancelled: '취소', url_authorized: '다운로드 링크 발급', request_denied: '요청 거부',
  denied: '차단', reauth_issued: '본인 확인',
};
const AUDIT_RESULTS: Record<string, string> = { authorized: '허용', denied: '차단', queued: '대기', ready: '완료', failed: '실패', expired: '만료', ok: '정상' };

const pick = (map: Record<string, string>, code: string | null | undefined, fallback = '알 수 없음'): string =>
  code ? (map[code] ?? fallback) : fallback;

export const exclusionReasonLabel = (code: string): string => pick(EXCLUSION_REASONS, code);
export const signalLabel = (code: string | null | undefined): string => (code ? (SIGNALS[code.toLowerCase()] ?? code) : '대상');
export const rangeNoticeLabel = (code: string): string => NOTICES[code] ?? code;
export const availabilityLabel = (code: string): string => pick(AVAILABILITY, code);
export const manifestStateLabel = (code: string): string => pick(MANIFEST_STATES, code);
export const consentStateLabel = (code: string): string => pick(CONSENT_STATES, code);
export const defaultViewLabel = (code: string): string => pick(DEFAULT_VIEWS, code);
export const jobErrorLabel = (code: string): string => pick(JOB_ERRORS, code, '작업을 완료하지 못했습니다');
export const auditEventLabel = (code: string): string => AUDIT_EVENTS[code] ?? '기타 기록';
export const auditResultLabel = (code: string): string => {
  const head = code.split(':')[0];
  return AUDIT_RESULTS[head] ?? (/^http_\d+/.test(head) ? '차단' : '기타');
};

/** 제외 사유별 건수를 '뇌파 수집 미동의 1건, 밴드 미착용 2건' 형태로 합친다. */
export function summarizeExclusions(
  counts: Record<string, number> | undefined,
  sample: { reason: string }[],
): { total: number; text: string; reasons: string[] } {
  const merged: Record<string, number> = counts && Object.keys(counts).length > 0 ? counts : sample.reduce<Record<string, number>>((acc, item) => ({ ...acc, [item.reason]: (acc[item.reason] ?? 0) + 1 }), {});
  const entries = Object.entries(merged).filter(([, n]) => n > 0);
  return {
    total: entries.reduce((sum, [, n]) => sum + n, 0),
    reasons: entries.map(([code]) => exclusionReasonLabel(code)),
    text: entries.map(([code, n]) => `${exclusionReasonLabel(code)} ${n}건`).join(', '),
  };
}
