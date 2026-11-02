// SDD-273 — 웹 WASM 경로 PPG 입력 진단(additive). 코어 판정(accepted/duplicate/out_of_order/conflict/invalid)과 JS 알림 도착 모양(정지 후 몰림)을 센다.
// 값은 개수뿐이라 민감정보가 없다. entry-state 쿼리 `pd` 로 서버 접근 로그에 남아 실기 호흡·HRV 차이 분석에 쓴다.
export interface PpgDiag { acc: number; dup: number; ooo: number; conf: number; inv: number; pkts: number; stall: number; burst: number }

const zero = (): PpgDiag => ({ acc: 0, dup: 0, ooo: 0, conf: 0, inv: 0, pkts: 0, stall: 0, burst: 0 });
let d: PpgDiag = zero();
let lastArrUs: number | null = null;

/** 코어 push 결과 status 집계 */
export function countPpgStatus(status: string | null): void {
  if (status === 'accepted') d.acc += 1;
  else if (status === 'duplicate') d.dup += 1;
  else if (status === 'out_of_order') d.ooo += 1;
  else if (status === 'conflict') d.conf += 1;
  else if (status) d.inv += 1;
}

/** 알림 도착 간격: 1.5초 넘게 비었다가 오면 stall, 직전과 5ms 이내면 burst(몰림) */
export function countPpgArrival(arrivalUs: number): void {
  d.pkts += 1;
  if (lastArrUs !== null) {
    const gap = arrivalUs - lastArrUs;
    if (gap > 1_500_000) d.stall += 1;
    else if (gap >= 0 && gap < 5_000) d.burst += 1;
  }
  lastArrUs = arrivalUs;
}

export function setPpgStatusTotals(t: Pick<PpgDiag, 'acc' | 'dup' | 'ooo' | 'conf' | 'inv'>): void {
  d = { ...d, ...t };
}

export function resetPpgDiag(): void {
  d = zero();
  lastArrUs = null;
}

export function ppgDiagSnapshot(): PpgDiag {
  return { ...d };
}

/** 예: a120.d0.o3.c0.i0.p125.s2.b40 */
export function ppgDiagCode(): string {
  return `a${d.acc}.d${d.dup}.o${d.ooo}.c${d.conf}.i${d.inv}.p${d.pkts}.s${d.stall}.b${d.burst}`;
}
