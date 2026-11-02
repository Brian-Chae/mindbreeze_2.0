// 게스트 라이브 소켓 진단 — 소켓이 안 열리는 사유를 entry-state 쿼리(ld)로 서버 접근 로그에 남긴다(민감값 없음, 짧은 코드만).
// 예: ld=a1.f1.c0.p-.e-  (a 활성, f v2 플래그, c 소켓 connected, p LiveState phase, e 마지막 connect_error / 예외 이름)
interface Diag { active: boolean; flag: boolean; connected: boolean; phase: string; err: string; created: boolean }
const d: Diag = { active: false, flag: false, connected: false, phase: '-', err: '-', created: false };

const clean = (s: string): string => s.toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, 24) || '-';

// 오류 코드 허용 목록 — 임의 메시지(토큰·이메일·URL 등)의 문자를 보존하지 않고 이 값으로만 매핑한다. 목록 밖은 'other'.
const ERR_ALLOW = new Set([
  '-', 'other',
  'ce_token_expired', 'ce_invalid_token_type', 'ce_account_inactive', 'ce_invalid_token', 'ce_unauthorized', 'ce_forbidden',
  'ce_websocket_error', 'ce_xhr_poll_error', 'ce_timeout', 'ce_unknown',
  'dc_io_server_disconnect', 'dc_io_client_disconnect', 'dc_ping_timeout', 'dc_transport_close', 'dc_transport_error', 'dc_parse_error',
  'create_error', 'create_typeerror', 'create_unknown',
]);
const mapErr = (s: string): string => {
  if (s === '-') return '-';
  const v = clean(s);
  return ERR_ALLOW.has(v) ? v : 'other';
};

export function setLiveDiag(patch: Partial<Diag>): void {
  if (patch.err !== undefined) patch = { ...patch, err: mapErr(patch.err) };
  if (patch.phase !== undefined) patch = { ...patch, phase: clean(patch.phase) };
  Object.assign(d, patch);
}

export function liveDiagCode(): string {
  return `a${d.active ? 1 : 0}.f${d.flag ? 1 : 0}.s${d.created ? 1 : 0}.c${d.connected ? 1 : 0}.p${d.phase}.e${d.err}`;
}
