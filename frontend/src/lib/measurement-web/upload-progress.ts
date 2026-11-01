// SDD-260 UI — 네이티브가 보내는 저장 진행 이벤트(feature.counts·archive.counts·reconcile.state)를 화면 문구로 바꾼다.
// 종료 비차단: "업로드 중 feature N창 · 원시 M건" → 대조 중 → "업로드 완료". summary 대조(complete)가 끝나기 전에는 완료라 하지 않는다.
export type ReconcileStateName = string;
export interface UploadProgress {
  featurePending: number; featureAcked: number; featureRejected: number;
  rawPending: number; rawUploading: number; rawVerified: number; rawQuarantined: number;
  featureState: ReconcileStateName; rawState: ReconcileStateName; complete: boolean;
}
export type UploadProgressKind = 'uploading' | 'checking' | 'needs_review' | 'done';
export interface UploadProgressView { kind: UploadProgressKind; text: string }

export const emptyUploadProgress = (): UploadProgress => ({
  featurePending: 0, featureAcked: 0, featureRejected: 0, rawPending: 0, rawUploading: 0, rawVerified: 0, rawQuarantined: 0,
  featureState: 'idle', rawState: 'idle', complete: false,
});

export function describeUploadProgress(p: UploadProgress | null): UploadProgressView | null {
  if (!p) return null;
  const raw = p.rawPending + p.rawUploading;
  // SDD-268: 회원 화면에는 내부 용어(feature·원시·업로드)를 쓰지 않는다.
  if (p.featurePending > 0 || raw > 0) return { kind: 'uploading', text: `전송 중 · 분석 데이터 ${p.featurePending}개 · 측정 기록 파일 ${raw}개` };
  if (!p.complete) return { kind: 'checking', text: '서버에 잘 도착했는지 확인하고 있어요' };
  if (p.featureRejected > 0 || p.rawQuarantined > 0) return { kind: 'needs_review', text: `확인이 필요한 데이터 ${p.featureRejected + p.rawQuarantined}건이 있어요` };
  return { kind: 'done', text: '모두 도착했어요' };
}

/** SDD-268: 기본은 숨김. 연결 아이콘으로 연 경우, 또는 이상(needs_review)이면 표시한다. */
export function shouldShowUploadNotice(view: UploadProgressView | null, open: boolean): boolean {
  if (!view) return false;
  return view.kind === 'needs_review' || open;
}

export interface UploadProgressStore {
  get(sessionId: string): UploadProgress | null;
  update(sessionId: string, patch: Partial<UploadProgress>): void;
  subscribe(fn: () => void): () => void;
}

export function createUploadProgressStore(): UploadProgressStore {
  const bySession = new Map<string, UploadProgress>();
  const subs = new Set<() => void>();
  return {
    get: (sessionId) => bySession.get(sessionId) ?? null,
    update: (sessionId, patch) => {
      bySession.set(sessionId, { ...(bySession.get(sessionId) ?? emptyUploadProgress()), ...patch });
      for (const fn of subs) fn();
    },
    subscribe: (fn) => { subs.add(fn); return () => { subs.delete(fn); }; },
  };
}

/** 앱 전역 단일 스토어 — 네이티브 이벤트가 쓰고 화면이 읽는다 */
export const uploadProgressStore: UploadProgressStore = createUploadProgressStore();
