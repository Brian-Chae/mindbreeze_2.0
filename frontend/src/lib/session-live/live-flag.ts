// SDD-246 T06 — v2 실시간 프로토콜 플래그. 기본 off: 켜지 않으면 현행(v1) 경로 그대로다(회귀 0).
// (lib/feature-flags.ts 는 T06 소유 경로가 아니라 여기에 둔다. 통합 시 옮길지는 T12 가 결정.)
export function isLiveProtocolV2Enabled(
  env: { VITE_LIVE_PROTOCOL_V2?: string } = import.meta.env as { VITE_LIVE_PROTOCOL_V2?: string },
): boolean {
  return env.VITE_LIVE_PROTOCOL_V2 === 'true';
}
