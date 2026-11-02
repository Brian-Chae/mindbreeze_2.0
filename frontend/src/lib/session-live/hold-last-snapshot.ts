// SDD-274 — 비회원(코드 입장) Android 자기 화면: 집중·이완·감정균형이 일시 무효/null 일 때 직전 유효값을 짧게 유지한다.
// 근거: 상담사 화면 holdLastValues 의 HOLD_LAST_VALUE_MS(15초)와 같은 값 — 두 화면이 같은 시점에 값이 사라진다.
// 순수 함수. 호흡·HRV·BPM 은 유지하지 않고, 접촉 불량·연결 해제·링크 stale(blocked)이면 즉시 가리고 보관분을 버린다.
import type { MetricSnapshot } from '../../components/class/player/member/member-metrics';

export const HOLD_MIND_MS = 15_000;

const MIND_KEYS = ['focus', 'relaxation', 'emotional'] as const;
type MindKey = (typeof MIND_KEYS)[number];

export type HeldMind = Readonly<Partial<Record<MindKey, { value: number; at: number }>>>;

export interface HoldOptions {
  /** 비회원 + Android 등 유지 대상일 때만 true. false 면 입력을 그대로 돌려준다 */
  enabled: boolean;
  /** lead_off · 연결 해제 · 링크 stale — 즉시 "-" 로 가린다 */
  blocked: boolean;
}

export function holdMindMetrics(
  snapshot: MetricSnapshot,
  prev: HeldMind,
  nowMs: number,
  opts: HoldOptions,
): { snapshot: MetricSnapshot; held: HeldMind } {
  if (!opts.enabled) return { snapshot, held: prev };
  if (opts.blocked) return { snapshot: { ...snapshot, focus: null, relaxation: null, emotional: null }, held: {} };
  const held: Partial<Record<MindKey, { value: number; at: number }>> = {};
  const out: MetricSnapshot = { ...snapshot };
  for (const k of MIND_KEYS) {
    const v = snapshot[k];
    if (v !== null && Number.isFinite(v)) {
      held[k] = { value: v, at: nowMs };
      continue;
    }
    const last = prev[k];
    if (last && nowMs - last.at <= HOLD_MIND_MS) {
      held[k] = last;
      out[k] = last.value;
    } else {
      out[k] = null;
    }
  }
  return { snapshot: out, held };
}
