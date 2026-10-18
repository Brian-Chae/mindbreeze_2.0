import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  getClasses, getClass, getClassSessions, getCounseling, getCounselingDetail,
  type ListParams, type ClassDetailDto, type ClassSessionsResponse,
} from '../lib/api/class-structure';
import { ApiError } from '../lib/api/client';
import { useAuthStore } from '../stores/authStore';
import type { ClassId, RelationshipId, ReadState } from '../lib/class-structure/read-model';

interface PendingRead {
  promise: Promise<unknown>;
  controller: AbortController;
  consumers: number;
}
const pending = new Map<string, PendingRead>();
let generation = 0;
function identity(): string {
  const { user, isAuthenticated } = useAuthStore.getState();
  return JSON.stringify([isAuthenticated, user?.id, user?.role]);
}
let currentIdentity = identity();
// 계정 전환 순간 무효화한다. 같은 계정으로 빠르게 돌아와도 이전 응답은 재사용하지 않는다.
useAuthStore.subscribe(() => {
  const next = identity();
  if (next === currentIdentity) return;
  currentIdentity = next;
  generation += 1;
  for (const entry of pending.values()) entry.controller.abort();
  pending.clear();
});
const subscribe = (notify: () => void): (() => void) => useAuthStore.subscribe(notify);
const scopeSnapshot = (): string => `${generation}:${currentIdentity}`;

function acquire<T>(key: string, load: (signal: AbortSignal) => Promise<T>): { promise: Promise<T>; release: () => void } {
  let entry = pending.get(key);
  if (!entry) {
    const controller = new AbortController();
    // 다음 마이크로태스크에서 시작해 동시 소비자의 요청을 한 번으로 합친다.
    const created: PendingRead = { controller, consumers: 0, promise: Promise.resolve().then(() => load(controller.signal)) };
    entry = created;
    pending.set(key, entry);
    const discard = () => { if (pending.get(key) === created) pending.delete(key); };
    created.promise.then(discard, discard);
  }
  const shared = entry;
  shared.consumers += 1;
  return {
    promise: shared.promise as Promise<T>,
    release: () => {
      shared.consumers -= 1;
      if (shared.consumers === 0) {
        shared.controller.abort();
        if (pending.get(key) === shared) pending.delete(key);
      }
    },
  };
}
export interface StructureRead<T> { state: ReadState<T>; retry: () => void }
function useRead<T>(resource: string, load: (signal: AbortSignal) => Promise<T>): StructureRead<T> {
  const scope = useSyncExternalStore(subscribe, scopeSnapshot, scopeSnapshot);
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([scope, resource, attempt]);
  const [result, setResult] = useState<{ key: string; state: ReadState<T> } | null>(null);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    const auth = useAuthStore.getState();
    if (!auth.isAuthenticated || !auth.user) return;
    let active = true;
    const request = acquire(key, load);
    request.promise.then((data) => {
      if (active && scopeSnapshot() === scope) setResult({ key, state: { status: 'success', data } });
    }, (error: unknown) => {
      if (!active || scopeSnapshot() !== scope) return;
      const state: ReadState<T> = error instanceof ApiError && error.status === 404
        ? { status: 'not_found', message: '내용을 찾을 수 없어요' }
        : { status: 'error', message: '목록을 불러오지 못했어요' };
      setResult({ key, state });
    });
    return () => { active = false; request.release(); };
  }, [key, scope, load]);
  // effect 정리 이전 렌더에서도 다른 계정/부모의 이전 결과를 노출하지 않는다.
  return { state: result?.key === key ? result.state : { status: 'loading' }, retry };
}
function paramsKey(params?: ListParams): string {
  return JSON.stringify([params?.status ?? null, params?.page ?? null, params?.limit ?? null]);
}
export function useClasses(params?: ListParams) {
  const { status, page, limit } = params ?? {};
  const load = useCallback((signal: AbortSignal) => getClasses({ status, page, limit }, signal), [status, page, limit]);
  return useRead(`classes:${paramsKey(params)}`, load);
}
export function useCounseling(params?: ListParams) {
  const { status, page, limit } = params ?? {};
  const load = useCallback((signal: AbortSignal) => getCounseling({ status, page, limit }, signal), [status, page, limit]);
  return useRead(`counseling:${paramsKey(params)}`, load);
}
export interface ClassDetailRead { detail: ClassDetailDto; sessions: ClassSessionsResponse }
export function useClassDetail(id: ClassId): StructureRead<ClassDetailRead> {
  const load = useCallback(async (signal: AbortSignal): Promise<ClassDetailRead> => {
    const [detail, sessions] = await Promise.all([getClass(id, signal), getClassSessions(id, signal)]);
    return { detail, sessions };
  }, [id]);
  return useRead(`class:${id}`, load);
}
export function useCounselingDetail(id: RelationshipId) {
  const load = useCallback((signal: AbortSignal) => getCounselingDetail(id, signal), [id]);
  return useRead(`relationship:${id}`, load);
}
export function useMixedHome() {
  const classes = useClasses();
  const counseling = useCounseling();
  const retryClasses = classes.retry;
  const retryCounseling = counseling.retry;
  const retry = useCallback(() => { retryClasses(); retryCounseling(); }, [retryClasses, retryCounseling]);
  return { classes: classes.state, counseling: counseling.state, retry };
}
