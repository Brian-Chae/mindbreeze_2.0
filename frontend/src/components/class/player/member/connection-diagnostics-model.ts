// SDD-284 T4 — 연결 진단 패널의 상태 판정(순수 함수). 훅(useNativeMeasurementV2·useWebMeasurementV2)이 내보낸 값을
// 화면 문구로 바꾼다. 값이 없거나 아직 수집 전이면 0으로 만들지 않고 null 로 두어 화면이 "확인 전"으로 그리게 한다.
// 점수·종합점수·좋음·나쁨·완료·보증 같은 표현은 쓰지 않는다.
import { useEffect, useState } from 'react';
import { NATIVE_RESTART_MAX } from '../../../../lib/measurement-web/use-native-measurement';

/** 패널에 보이는 "값 없음" 표기 */
export const DIAG_UNKNOWN = '확인 전';

/**
 * 업로드 적체 임계값 — 가설이다. 평상시 pending 이 작다는 정황뿐이고 현장 실측으로 정한 값이 아니다(11/11 현장 로그 후 조정).
 * 분석 데이터(feature) 대기 > 60 또는 측정 기록 파일(raw) 대기 > 6 이 30초 이상 이어지면 "업로드 적체".
 */
export const DIAG_BACKLOG_FEATURE_PENDING = 60;
export const DIAG_BACKLOG_RAW_PENDING = 6;
export const DIAG_BACKLOG_HOLD_MS = 30_000;
/** 확정 대기가 이 시간을 넘으면 "시작 단계 정체"로 본다(NATIVE_CONFIRM_MS 20초 안에 알 수 있게 그보다 짧게) */
export const DIAG_START_STALL_MS = 10_000;

export type DiagSocketState = 'connected' | 'disconnected' | 'unknown';
export type DiagKind = 'normal' | 'start_stalled' | 'socket_down' | 'upload_backlog' | 'web_fallback' | 'recovering';

export interface DiagUploadCounts { featurePending: number; featureAcked: number; rawPending: number; rawVerified: number }

export interface ConnectionDiagnosticsInput {
  path: 'native' | 'web_wasm' | 'off';
  /** 훅 status 그대로(idle/starting/running/failed 또는 capturing 등) */
  status: string;
  code: string | null;
  nativeState: string | null;
  streamIdHead: string | null;
  restartCount: number | null;
  lastConfirmElapsedMs: number | null;
  /** 스트림 확정 실패가 반복돼 웹 경로로 하강한 회차 */
  nativeFailed: boolean;
  socket: DiagSocketState;
  /** 수집 전이면 null */
  upload: DiagUploadCounts | null;
  /** 업로드 적체 임계값을 넘기 시작한 시각(ms). 넘지 않으면 null */
  backlogSinceMs: number | null;
  nowMs: number;
}

export interface DiagAlert { kind: Exclude<DiagKind, 'normal'>; text: string; tone: 'caution' | 'info' }
export interface DiagRow { key: string; label: string; value: string }
export interface DiagCountRow { label: string; pending: string; arrived: string }

export interface ConnectionDiagnosticsView {
  kind: DiagKind;
  /** 이상 상태 목록(우선순위 순). 비어 있으면 정상 */
  alerts: readonly DiagAlert[];
  /** 정상 상태 문구(이상이 없을 때) */
  okText: string;
  rows: readonly DiagRow[];
  counts: readonly DiagCountRow[];
  abnormal: boolean;
}

const RESTART_CODES = new Set(['native_stream_unconfirmed', 'native_stream_lost']);

export function isUploadBacklog(u: DiagUploadCounts | null): boolean {
  if (!u) return false;
  return u.featurePending > DIAG_BACKLOG_FEATURE_PENDING || u.rawPending > DIAG_BACKLOG_RAW_PENDING;
}

/** 임계값을 넘기 시작한 시각을 기억한다(넘지 않으면 null). 화면이 열려 있지 않아도 센다. */
export function useBacklogSince(upload: DiagUploadCounts | null, nowMs: number): number | null {
  const over = isUploadBacklog(upload);
  const [since, setSince] = useState<number | null>(null);
  useEffect(() => { setSince((prev) => (over ? (prev ?? nowMs) : null)); }, [over, nowMs]);
  return over ? since : null;
}

const count = (n: number | null | undefined): string => (typeof n === 'number' && Number.isFinite(n) ? String(n) : DIAG_UNKNOWN);

function socketLabel(s: DiagSocketState): string {
  return s === 'connected' ? '연결됨' : s === 'disconnected' ? '끊김' : DIAG_UNKNOWN;
}

function deriveAlerts(i: ConnectionDiagnosticsInput): DiagAlert[] {
  const alerts: DiagAlert[] = [];
  const restarts = i.restartCount ?? 0;
  const restartText = `자동 재시작 ${restarts}/${NATIVE_RESTART_MAX}`;
  if (i.nativeFailed) alerts.push({ kind: 'web_fallback', text: '웹 경로로 전환했어요. 이 회차에서는 웹 경로를 유지해요.', tone: 'info' });
  if (i.path === 'native') {
    const restartCode = i.code !== null && RESTART_CODES.has(i.code);
    const elapsed = i.lastConfirmElapsedMs;
    if (i.status === 'starting') {
      if (restartCode || (restarts > 0 && (elapsed === null || elapsed < DIAG_START_STALL_MS))) {
        alerts.push({ kind: 'recovering', text: `연결을 복구하고 있어요 · ${restartText}`, tone: 'caution' });
      } else if (elapsed !== null && elapsed >= DIAG_START_STALL_MS) {
        alerts.push({ kind: 'start_stalled', text: `확정 대기 ${Math.round(elapsed / 1000)}초 · ${restartText}`, tone: 'caution' });
      }
    } else if (i.status === 'failed') {
      alerts.push({ kind: 'start_stalled', text: `측정 시작이 멈췄어요 · ${restartText}`, tone: 'caution' });
    }
  }
  if (i.socket === 'disconnected') alerts.push({ kind: 'socket_down', text: '실시간 연결이 끊겼어요. 연결 상태를 확인해 주세요.', tone: 'caution' });
  if (isUploadBacklog(i.upload) && i.backlogSinceMs !== null && i.nowMs - i.backlogSinceMs >= DIAG_BACKLOG_HOLD_MS) {
    alerts.push({ kind: 'upload_backlog', text: '서버에 보내지 못한 데이터가 쌓이고 있어요.', tone: 'caution' });
  }
  return alerts;
}

export function deriveConnectionDiagnostics(i: ConnectionDiagnosticsInput): ConnectionDiagnosticsView {
  const alerts = deriveAlerts(i);
  const native = i.path === 'native';
  const running = i.status === 'running' || i.status === 'capturing';
  const streamId = i.streamIdHead ?? (native && i.status === 'starting' ? '확정 대기' : DIAG_UNKNOWN);
  const rows: DiagRow[] = [
    { key: 'path', label: '측정 경로', value: i.path },
    { key: 'status', label: '상태', value: i.status },
    { key: 'code', label: '코드', value: i.code ?? '—' },
  ];
  if (native) {
    rows.push({ key: 'nativeState', label: 'native 상태', value: i.nativeState ?? DIAG_UNKNOWN });
    rows.push({ key: 'streamId', label: '측정 식별자', value: streamId });
  }
  rows.push({ key: 'socket', label: '실시간 연결', value: socketLabel(i.socket) });
  if (native) rows.push({ key: 'restart', label: '재시작 횟수', value: i.restartCount === null ? DIAG_UNKNOWN : `${i.restartCount} / ${NATIVE_RESTART_MAX}` });
  const u = i.upload;
  const counts: DiagCountRow[] = [
    { label: '분석 데이터', pending: count(u?.featurePending), arrived: count(u?.featureAcked) },
    { label: '측정 기록 파일', pending: count(u?.rawPending), arrived: count(u?.rawVerified) },
  ];
  return {
    kind: alerts[0]?.kind ?? 'normal',
    alerts,
    okText: running ? '측정과 전송이 이어지고 있어요.' : '측정을 시작하는 중이에요.',
    rows,
    counts,
    abnormal: alerts.length > 0,
  };
}

/** 펼침 상태: 이상이면 자동 노출, 사용자가 접으면 같은 종류의 이상에서는 다시 열지 않고 새로운 종류가 생기면 다시 연다. */
export interface DiagOverride { open: boolean; forKind: DiagKind }
export function resolveDiagOpen(view: Pick<ConnectionDiagnosticsView, 'kind' | 'abnormal'>, override: DiagOverride | null): boolean {
  if (override && override.forKind === view.kind) return override.open;
  return view.abnormal;
}
