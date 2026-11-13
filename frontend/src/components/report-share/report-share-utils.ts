// 리포트 공유 시트 순수 로직 (SDD-327 T15)
import { ApiError } from '../../lib/api/client';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/** 주소 추가 결과: 새 목록(불변) 또는 거절 사유. */
export type AddRecipientResult =
  | { ok: true; recipients: string[] }
  | { ok: false; reason: 'invalid' | 'duplicate' | 'limit' };

export function addRecipient(current: readonly string[], raw: string, max: number): AddRecipientResult {
  const email = raw.trim().toLowerCase();
  if (!isValidEmail(email)) return { ok: false, reason: 'invalid' };
  if (current.includes(email)) return { ok: false, reason: 'duplicate' };
  if (current.length >= max) return { ok: false, reason: 'limit' };
  return { ok: true, recipients: [...current, email] };
}

export type ShareFailureKind = 'limit' | 'invalid' | 'server';

/** 서버 응답 코드 → 시안의 상태 화면 종류. */
export function classifyShareError(error: unknown): ShareFailureKind {
  if (error instanceof ApiError) {
    if (error.status === 429) return 'limit';
    if (error.status >= 400 && error.status < 500) return 'invalid';
  }
  return 'server';
}

export function formatShareDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} · ${p(d.getHours())}:${p(d.getMinutes())}`;
}
