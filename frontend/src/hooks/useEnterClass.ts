// SDD-209 SH4 — 초대된 회원의 편의 입장. 코드 없이 POST /sessions/{id}/enter 로 입장 자격을 받아 입장 흐름으로 이동한다.
// 입장 조건이 아니라 편의 경로다: 초대 행이 없으면 403 이고 코드 입장(/join)으로 안내한다. 구 API 폴백은 없다.
import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient, ApiError } from '../lib/api/client';

/** 입장 자격 저장 키 접두어(plan §5.2: `mb_entry_<sessionId>`, 탭 단위 sessionStorage) */
export const ENTRY_STORAGE_PREFIX = 'mb_entry_';

export interface EnterClassResponse {
  entry_credential: string | null;
  expires_at: string | null;
  participant_id: string | null;
  is_guest: boolean;
  is_waitlisted: boolean;
}

export type EnterClassErrorKind = 'invite-required' | 'closed' | 'not-found' | 'failed';

export interface EnterClassError {
  kind: EnterClassErrorKind;
  message: string;
}

/** 서버 원문(detail)은 쓰지 않는다 — 상태 코드로만 분기해 문구를 정한다 */
function toEnterError(error: unknown): EnterClassError {
  if (error instanceof ApiError) {
    if (error.status === 403) return { kind: 'invite-required', message: '초대받은 클래스가 아니에요. 코치에게 받은 코드로 입장해 주세요.' };
    if (error.status === 409 || error.status === 400) return { kind: 'closed', message: '이미 끝났거나 닫힌 클래스예요.' };
    if (error.status === 404) return { kind: 'not-found', message: '클래스를 찾을 수 없어요.' };
  }
  return { kind: 'failed', message: '입장하지 못했어요. 잠시 후 다시 시도해 주세요.' };
}

function storeEntry(sessionId: string, response: EnterClassResponse): void {
  const stored: EnterClassResponse = {
    entry_credential: response.entry_credential ?? null,
    expires_at: response.expires_at ?? null,
    participant_id: response.participant_id ?? null,
    is_guest: Boolean(response.is_guest),
    is_waitlisted: Boolean(response.is_waitlisted),
  };
  sessionStorage.setItem(`${ENTRY_STORAGE_PREFIX}${sessionId}`, JSON.stringify(stored));
}

/** 입장 흐름 경로(통합 단계 I1 에서 라우트가 연결된다) */
export const classEnterPath = (sessionId: string): string => `/class/${sessionId}/enter`;

export function useEnterClass() {
  const navigate = useNavigate();
  const [enteringId, setEnteringId] = useState<string | null>(null);
  const [error, setError] = useState<EnterClassError | null>(null);
  const busyRef = useRef(false);

  const enter = useCallback(async (sessionId: string): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setEnteringId(sessionId);
    setError(null);
    try {
      const response = await apiClient.post<EnterClassResponse>(`/sessions/${sessionId}/enter`, {});
      storeEntry(sessionId, response);
      navigate(classEnterPath(sessionId));
      return true;
    } catch (e: unknown) {
      setError(toEnterError(e));
      return false;
    } finally {
      busyRef.current = false;
      setEnteringId(null);
    }
  }, [navigate]);

  const clearError = useCallback(() => setError(null), []);
  return { enter, enteringId, error, clearError };
}
