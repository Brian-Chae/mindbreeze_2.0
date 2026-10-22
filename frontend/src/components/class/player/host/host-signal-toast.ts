import { countSignals, signalCountParts, SIGNAL_ACTIVE_MS, type SignalMap } from '../../../../lib/class/quiet-signal';
export type SignalTopic = 'hands' | 'signals' | 'queue';
export interface SignalSnapshot {
  sessionId: string; connected: boolean; hands: readonly string[]; queue: readonly string[];
  signals: SignalMap; sheet: string | null; blocked: boolean;
}
export interface SignalToast { topic: SignalTopic; message: string; durationMs: number }
interface Pending { topic: SignalTopic; at: number; count: number; ids?: readonly string[] }
/** 알림에는 집계만 보관한다. 개인 식별자는 스냅샷 비교용 메모리 안에만 남는다. */
export class HostSignalToastPolicy {
  private previous: SignalSnapshot | null = null;
  private pending: Pending[] = [];
  private current: (SignalToast & { at: number }) | null = null;
  private lastQuietAt = -Infinity;
  private pausedAt: number | null = null;
  reset() { this.previous = null; this.pending = []; this.current = null; this.lastQuietAt = -Infinity; this.pausedAt = null; }
  dismiss() { this.current = null; this.pausedAt = null; }
  pause(now: number) { if (this.pausedAt === null) this.pausedAt = now; }
  resume(now: number) { if (this.current && this.pausedAt !== null) this.current.at += now - this.pausedAt; this.pausedAt = null; }
  update(input: SignalSnapshot, now: number): SignalToast | null {
    const prev = this.previous;
    this.previous = input;
    if (!prev || prev.sessionId !== input.sessionId || !input.connected || !prev.connected) {
      this.pending = []; this.current = null; this.lastQuietAt = -Infinity; return null;
    }
    const add = (topic: SignalTopic, count: number, ids?: readonly string[]) => {
      if (!count || input.sheet === topic) return;
      const pending = this.pending.find((p) => p.topic === topic);
      if (pending) { pending.count += count; if (ids) pending.ids = [...(pending.ids ?? []), ...ids]; }
      else this.pending.push({ topic, count, at: now, ids });
    };
    const newHands = input.hands.filter((id) => !prev.hands.includes(id));
    add('hands', newHands.length, newHands);
    const newQueue = input.queue.filter((id) => !prev.queue.includes(id));
    add('queue', newQueue.length, newQueue);
    add('signals', Object.entries(input.signals).filter(([id, value]) => {
      const old = prev.signals[id];
      return now - value.at < SIGNAL_ACTIVE_MS && (!old || old.at !== value.at || old.type !== value.type);
    }).length);
    const counts = countSignals(input.signals, now);
    const priority = (topic: SignalTopic) => topic === 'signals' && !counts.difficult && !counts.resting ? 2 : 1;
    const valid = (topic: SignalTopic) => topic === 'hands' ? input.hands.length > 0 : topic === 'queue' ? input.queue.length > 0 : countSignals(input.signals, now).total > 0;
    this.pending = this.pending.filter((p) => {
      if (p.ids) {
        const active = p.topic === 'hands' ? input.hands : input.queue;
        p.ids = p.ids.filter((id) => active.includes(id)); p.count = p.ids.length;
      }
      return p.count > 0 && p.topic !== input.sheet && valid(p.topic) && !(priority(p.topic) === 2 && now - p.at >= 10_000);
    });
    if (this.current && (this.current.topic === input.sheet || !valid(this.current.topic) || (this.pausedAt === null && now - this.current.at >= this.current.durationMs))) this.dismiss();
    if (this.current) {
      this.current.message = this.current.topic === 'hands' ? `손들기 · 대기 ${input.hands.length}명` : this.current.topic === 'queue' ? `입장 대기 ${input.queue.length}명` : `조용한 신호 · ${signalCountParts(counts).join(' · ')}`;
      const matching = this.pending.find((p) => p.topic === this.current?.topic);
      if (matching) {
        const counts = countSignals(input.signals, now);
        this.current.message = matching.topic === 'hands' ? `손들기 · 대기 ${input.hands.length}명` : matching.topic === 'queue' ? `입장 대기 ${input.queue.length}명` : `조용한 신호 · ${signalCountParts(counts).join(' · ')}`;
        // 최초 표시 기준만 사용하여 연속 이벤트가 표시 시간을 무한 연장하지 않는다.
        if (matching.topic === 'signals' && (counts.difficult || counts.resting)) this.current.durationMs = 6000;
        this.pending = this.pending.filter((p) => p !== matching);
      }
    }
    if (input.blocked) return null;
    if (!this.current) {
      this.pending.sort((a, b) => priority(a.topic) - priority(b.topic) || a.at - b.at);
      const index = this.pending.findIndex((p) => now - p.at >= (p.topic === 'queue' ? 3000 : 2000) && (p.topic !== 'signals' || now - this.lastQuietAt >= 10_000));
      if (index >= 0) {
        const [p] = this.pending.splice(index, 1);
        const counts = countSignals(input.signals, now);
        const durationMs = p.topic === 'signals' && !counts.difficult && !counts.resting ? 4000 : 6000;
        const message = p.topic === 'hands' ? `새 손들기 ${p.count}명 · 대기 ${input.hands.length}명` : p.topic === 'queue' ? `새 입장 대기 ${p.count}명 · 대기 ${input.queue.length}명` : `조용한 신호 · ${signalCountParts(counts).join(' · ')}`;
        this.current = { topic: p.topic, message, durationMs, at: now };
        if (p.topic === 'signals') this.lastQuietAt = now;
      }
    }
    if (!this.current) return null;
    const { topic, message, durationMs } = this.current;
    return { topic, message, durationMs };
  }
}
