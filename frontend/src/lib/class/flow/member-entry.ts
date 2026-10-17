// SDD-209 M0 — 코드 입장(FM04)·개인정보 입력(FM04b) 순수 로직.
// 코드는 선행 0 을 보존하는 문자열이다(숫자 변환 금지). 개인정보는 메모리에만 두고 요청 바디로만 보낸다.
import { ApiError } from '../../api/client';
import type { EnterPayload, EntryGender } from '../../api/class-flow';

export const CODE_LENGTH = 4;

/** 숫자만 남기고 4자리로 자른다 — 붙여넣기·자동완성에도 같은 규칙 */
export function sanitizeCodeInput(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, CODE_LENGTH);
}

export function isCompleteCode(code: string): boolean {
  return /^\d{4}$/.test(code);
}

export type CodeFailure = 'invalid' | 'throttled' | 'error';

/** 없는/틀린/종료 코드를 구분하지 않는다(정보 노출 방지) — 404·422 모두 invalid */
export function classifyCodeError(error: unknown): CodeFailure {
  if (error instanceof ApiError) {
    if (error.status === 404 || error.status === 422) return 'invalid';
    if (error.status === 429) return 'throttled';
  }
  return 'error';
}

export const GENDER_OPTIONS: ReadonlyArray<{ value: EntryGender; label: string }> = [
  { value: 'female', label: '여성' },
  { value: 'male', label: '남성' },
  { value: 'other', label: '선택 안 함' },
];

export interface EntryProfileDraft {
  name: string;
  gender: EntryGender | null;
  /** 화면 입력 그대로(전체 일자). 서버가 연·월만 보관한다 */
  birth: string;
  email: string;
  emailConfirm: string;
}

export function emptyProfileDraft(): EntryProfileDraft {
  return { name: '', gender: null, birth: '', email: '', emailConfirm: '' };
}

export type EntryProfileMode = 'guest' | 'member';

export interface EntryProfileErrors {
  name?: string;
  gender?: string;
  birth?: string;
  email?: string;
  emailConfirm?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** `1990.03.12`·`1990-3-2`·`19900312` → `1990-03-12`. 달력에 없는 날짜·미래·1900 이전은 null */
export function birthToIso(raw: string, now: Date = new Date()): string | null {
  const text = raw.trim();
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  const separated = /^(\d{4})([.\-/])(\d{1,2})\2(\d{1,2})$/.exec(text);
  if (!compact && !separated) return null;
  const year = Number(compact ? compact[1] : separated?.[1]);
  const month = Number(compact ? compact[2] : separated?.[3]);
  const day = Number(compact ? compact[3] : separated?.[4]);
  if (year < 1900 || month < 1 || month > 12 || day < 1) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  if (probe.getTime() > now.getTime()) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 항목별 인라인 오류(해요체). 로그인 회원은 계정 값을 쓰므로 검증하지 않는다 */
export function validateEntryProfile(draft: EntryProfileDraft, mode: EntryProfileMode): EntryProfileErrors {
  if (mode === 'member') return {};
  const errors: EntryProfileErrors = {};
  if (draft.name.trim().length === 0 || draft.name.trim().length > 100) errors.name = '이름을 입력해 주세요';
  if (draft.gender === null) errors.gender = '성별을 선택해 주세요';
  if (birthToIso(draft.birth) === null) errors.birth = '생년월일을 다시 확인해 주세요';
  if (!EMAIL_RE.test(draft.email.trim())) errors.email = '이메일 형식을 확인해 주세요';
  else if (draft.email.trim().toLowerCase() !== draft.emailConfirm.trim().toLowerCase()) errors.emailConfirm = '이메일이 서로 달라요';
  return errors;
}

/** 아무것도 입력하지 않은 상태 — 입장 버튼은 이때만 비활성 */
export function isProfilePristine(draft: EntryProfileDraft): boolean {
  return draft.name === '' && draft.gender === null && draft.birth === '' && draft.email === '' && draft.emailConfirm === '';
}

/** 요청 바디. 코드는 문자열 그대로. 로그인 회원은 코드만 보낸다(개인정보는 서버가 계정에서 채운다) */
export function toEnterPayload(code: string, draft: EntryProfileDraft, mode: EntryProfileMode): EnterPayload {
  if (mode === 'member') return { code };
  const birth = birthToIso(draft.birth);
  return {
    code,
    name: draft.name.trim(),
    gender: draft.gender ?? undefined,
    birth_date: birth ?? undefined,
    email: draft.email.trim(),
  };
}

/** `ji***@example.com` — 화면에는 마스킹한 값만 보인다 */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at < 1 || at === email.length - 1) return '';
  const local = email.slice(0, at);
  return `${local.slice(0, Math.min(2, local.length))}***${email.slice(at)}`;
}
