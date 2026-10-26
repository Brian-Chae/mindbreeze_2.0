import { countSignals, CLASS_SIGNAL_META, SIGNAL_ACTIVE_MS, type SignalMap } from '../../../../lib/class/quiet-signal';
export type SignalTopic = 'hands' | 'signals' | 'queue';
export interface SignalSnapshot {
  sessionId: string; connected: boolean; hands: readonly string[]; queue: readonly string[];
  handNames?: Readonly<Record<string, string>>; speakingCount?: number;
  signals: SignalMap; sheet: string | null; blocked: boolean;
}
export interface SignalToastRow { topic: SignalTopic; message: string; detail?: string; durationMs: number }
export interface SignalToast extends SignalToastRow { rows?: readonly SignalToastRow[] }
interface ActiveToast extends SignalToastRow { firstShown: number; expiry: number; ids: string[] }
const nameOf = (value?: string) => value?.trim() && value.trim() !== '익명' ? value.trim() : '참가자';
/** 이름과 식별자는 현재 세션 메모리에서만 보관하며 주제마다 독립 만료한다. */
export class HostSignalToastPolicy {
  private previous: SignalSnapshot | null = null;
  private active = new Map<SignalTopic, ActiveToast>();
  private pausedAt: number | null = null;
  reset() { this.previous = null; this.active.clear(); this.pausedAt = null; }
  dismiss(topic?: SignalTopic) {
    if (topic) this.active.delete(topic); else this.active.clear();
    if (!this.active.size) this.pausedAt = null;
  }
  pause(now: number) { if (this.pausedAt === null) this.pausedAt = now; }
  resume(now: number) {
    if (this.pausedAt !== null) for (const row of this.active.values()) row.expiry = Math.max(row.expiry + now - this.pausedAt, now + 3000);
    this.pausedAt = null;
  }
  update(input: SignalSnapshot, now: number): SignalToast | null {
    const prev = this.previous; this.previous = input;
    if (!prev || prev.sessionId !== input.sessionId || !input.connected || !prev.connected) { this.active.clear(); this.pausedAt = null; return null; }
    const fresh = Object.entries(input.signals).filter(([, value]) => now - value.at < SIGNAL_ACTIVE_MS);
    const changed = fresh.filter(([id, value]) => { const old = prev.signals[id]; return !old || value.at > old.at || (value.at === old.at && value.type !== old.type); });
    const events: Record<SignalTopic, string[]> = {
      hands: input.hands.filter((id) => !prev.hands.includes(id)),
      queue: input.queue.filter((id) => !prev.queue.includes(id)), signals: changed.map(([id]) => id),
    };
    for (const topic of ['hands', 'signals', 'queue'] as const) {
      const members = topic === 'hands' ? input.hands : topic === 'queue' ? input.queue : fresh.map(([id]) => id);
      let row = this.active.get(topic);
      // 상한에 도달한 업데이트에서는 새 주기를 시작하지 않는다.
      const expired = row && this.pausedAt === null && now >= row.expiry;
      const capped = expired && row && now >= row.firstShown + 10000;
      if (expired || !members.length || input.sheet === topic) { this.active.delete(topic); row = undefined; }
      if (!members.length || input.sheet === topic || input.blocked) continue;
      const newIds = events[topic];
      if (newIds.length && !capped) {
        const counts = countSignals(input.signals, now);
        if (!row) {
          const durationMs = topic === 'signals' && !counts.difficult && !counts.resting ? 4000 : 6000;
          row = { topic, message: '', durationMs, firstShown: now, expiry: now + durationMs, ids: [] };
          this.active.set(topic, row);
        } else {
          if (topic === 'signals' && (counts.difficult || counts.resting)) row.durationMs = 6000;
          row.expiry = Math.min(row.firstShown + 10000, Math.max(row.expiry, row.firstShown + row.durationMs, now + 3000));
        }
        row.ids = [...new Set([...row.ids, ...newIds])];
      }
      if (!row) continue;
      row.ids = row.ids.filter((id) => members.includes(id));
      if (!row.ids.length) { this.active.delete(topic); continue; }
      if (topic === 'hands') {
        const name = nameOf(input.handNames?.[row.ids[0]]);
        row.message = row.ids.length === 1 ? `${name}님이 손을 들었어요` : `${name} 외 ${row.ids.length - 1}명이 손을 들었어요`;
        row.detail = `현재 대기 ${input.hands.length}명 · 발언권 ${input.speakingCount ?? 0}명`;
      } else if (topic === 'queue') { row.message = `입장 대기 ${input.queue.length}명`; row.detail = '탭해서 입장 대기 확인'; }
      else {
        const latest = [...fresh].sort((a, b) => b[1].at - a[1].at)[0][1];
        row.message = `${nameOf(latest.displayName)} · ${CLASS_SIGNAL_META[latest.type].label}`;
        const counts = countSignals(input.signals, now);
        row.detail = `전체: ${(['difficult', 'resting', 'following'] as const).filter((type) => counts[type] > 0).map((type) => `${type === 'difficult' ? '어려워요' : CLASS_SIGNAL_META[type].label} ${counts[type]}`).join(' · ')}`;
      }
    }
    if (!this.active.size) this.pausedAt = null;
    if (input.blocked) return null;
    const rows = (['hands', 'signals', 'queue'] as const).flatMap((topic) => {
      const row = this.active.get(topic); return row ? [{ topic, message: row.message, detail: row.detail, durationMs: row.durationMs }] : [];
    });
    return rows.length ? { ...rows[0], rows } : null;
  }
}
