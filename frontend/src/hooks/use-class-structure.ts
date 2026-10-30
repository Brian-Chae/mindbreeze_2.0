import { membershipApi } from '../lib/api/class-operations';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  getClasses, getClass, getClassSessions, getCounseling, getCounselingDetail,
  type ListParams, type CounselingListResponse, type ClassDetailDto, type ClassSessionsResponse,
} from '../lib/api/class-structure';
import { subscribeClassReads, classReadRevision } from '../lib/class-structure/invalidation';
import { HOME_ACTIVE_CLASS_PARAMS } from '../lib/class-structure/home-params';
import { readListCache, writeListCache } from '../lib/class-structure/list-cache';
import { ApiError } from '../lib/api/client';
import { isCounselingEnabled } from '../lib/feature-flags';
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
const noSubscribe = (): (() => void) => () => {};
const noRevision = (): number => 0;
export interface StructureRead<T> { state: ReadState<T>; retry: () => void; refreshError?: string; errorStatus?:number }
function useRead<T>(resource: string, load: (signal: AbortSignal) => Promise<T>, publicRead = false, enabled = true): StructureRead<T> {
  const scope = useSyncExternalStore(subscribe, scopeSnapshot, scopeSnapshot);
  const isClassRead = resource.startsWith('class:') || resource.startsWith('classes:');
  const revision = useSyncExternalStore(isClassRead ? subscribeClassReads : noSubscribe, isClassRead ? classReadRevision : noRevision, noRevision);
  const [attempt, setAttempt] = useState(0);
  const resourceKey = JSON.stringify([scope, resource]);
  const key = JSON.stringify([resourceKey, attempt, revision]);
  const [result, setResult] = useState<{ key: string; resourceKey: string; state: ReadState<T>; refreshError?: string; errorStatus?:number } | null>(null);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  // 목록(classes:·counseling:)은 마지막 성공값을 먼저 보여 주고 뒤에서 새로 받는다(stale-while-revalidate).
  const isListRead = resource.startsWith('classes:') || resource.startsWith('counseling:');
  const cached = useMemo(() => (isListRead && enabled ? readListCache<T>(resource) : null), [isListRead, enabled, resource]);
  useEffect(() => {
    if (!enabled) return;
    const auth = useAuthStore.getState();
    if (!publicRead && (!auth.isAuthenticated || !auth.user)) return;
    let active = true;
    const request = acquire(key, load);
    request.promise.then((data) => {
      if (active && scopeSnapshot() === scope) {
        if (isListRead) writeListCache(resource, data);
        setResult({ key, resourceKey, state: { status: 'success', data } });
      }
    }, (error: unknown) => {
      if (!active || scopeSnapshot() !== scope) return;
      const state: ReadState<T> = error instanceof ApiError && error.status === 404
        ? { status: 'not_found', message: '내용을 찾을 수 없어요' }
        : { status: 'error', message: '목록을 불러오지 못했어요' };
      setResult(previous => {
        // 일시 재조회 실패도 열린 편집을 지우지 않는다. 404는 현재 접근 회수를 반영한다.
        if (isClassRead && (!(error instanceof ApiError) || error.status >= 500) && previous?.resourceKey === resourceKey && previous.state.status === 'success') {
          return { ...previous, key, refreshError: '최신 내용을 불러오지 못했어요. 입력을 유지하고 있어요.' };
        }
        return { key, resourceKey, state, errorStatus: error instanceof ApiError ? error.status : undefined };
      });
    });
    return () => { active = false; request.release(); };
  }, [key, resourceKey, scope, load, isClassRead, isListRead, resource, publicRead, enabled]);
  // 같은 계정·부모의 성공 화면은 재조회 중 유지하되 계정/부모 전환에는 노출하지 않는다.
  const current = result?.resourceKey === resourceKey && (result.key === key || isClassRead && result.state.status === 'success') ? result : null;
  const fallback: ReadState<T> = cached ? { status: 'success', data: cached } : { status: 'loading' };
  return { state: current?.state ?? fallback, retry, refreshError: current?.refreshError, errorStatus:current?.errorStatus };
}
function paramsKey(params?: ListParams): string {
  return JSON.stringify([params?.status ?? null, params?.page ?? null, params?.limit ?? null]);
}
export function useClasses(params?: ListParams, enabled = true) {
  const { status, page, limit } = params ?? {};
  const load = useCallback((signal: AbortSignal) => getClasses({ status, page, limit }, signal), [status, page, limit]);
  return useRead(`classes:${paramsKey(params)}`, load, false, enabled);
}
export function useCounseling(params?: ListParams, enabled = true) {
  const { status, page, limit } = params ?? {};
  const load = useCallback((signal: AbortSignal) => getCounseling({ status, page, limit }, signal), [status, page, limit]);
  return useRead(`counseling:${paramsKey(params)}`, load, false, enabled);
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
  const classes = useClasses(HOME_ACTIVE_CLASS_PARAMS);
  // SDD-219: 상담 비공개 시 상담 조회를 생략하고 빈 목록으로 취급한다.
  const counselingEnabled = isCounselingEnabled();
  const counseling = useCounseling(undefined, counselingEnabled);
  const retryClasses = classes.retry;
  const retryCounseling = counseling.retry;
  const retry = useCallback(() => { retryClasses(); retryCounseling(); }, [retryClasses, retryCounseling]);
  const counselingState: ReadState<CounselingListResponse> = counselingEnabled
    ? counseling.state : { status: 'success', data: { relationships: [], total: 0 } };
  return { classes: classes.state, counseling: counselingState, retry };
}

export function useMyClassMembership(id: string, credential?: string) {
  const load = useCallback((signal: AbortSignal) => membershipApi.membership(id, credential, signal), [id, credential]);
  return useRead(`class:${id}:membership:${credential ?? 'login'}`, load, credential !== undefined);
}
export function useMyClassAttendance(id: string, credential?: string) {
  const load = useCallback((signal: AbortSignal) => membershipApi.attendance(id, credential, signal), [id, credential]);
  return useRead(`class:${id}:attendance:${credential ?? 'login'}`, load, credential !== undefined);
}
