// 밴드 없이 입장 선택 보존 — 준비 단계(EntryPage)의 선택이 플레이어 화면·재입장·앱 복귀까지 유지되게 한다.
// 선택은 회차 단위로 localStorage 에 둔다(민감 정보 아님). 사용자가 기기 탭에서 직접 연결하면 해제한다.
const PREFIX = 'mb:band-skip:';

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readBandSkip(sessionId: string): boolean {
  return storage()?.getItem(`${PREFIX}${sessionId}`) === '1';
}

export function writeBandSkip(sessionId: string, skipped: boolean): void {
  const s = storage();
  if (!s) return;
  try {
    if (skipped) s.setItem(`${PREFIX}${sessionId}`, '1');
    else s.removeItem(`${PREFIX}${sessionId}`);
  } catch {
    // 저장 실패는 무해(이번 화면 동안만 유지)
  }
}

/** 밴드 자동 스캔·연결·네이티브 측정 시작을 해도 되는가 — 밴드 사용 회차이고 '밴드 없이 입장'을 고르지 않았을 때만 */
export function shouldAutoConnectBand(linkbandMode: string | undefined, bandSkipped: boolean): boolean {
  return linkbandMode !== 'none' && !bandSkipped;
}

/** '밴드 없이 입장' 상태에서 연결된 적 없는 밴드는 'off'(밴드 없이 참여 중) 로 본다 — '연결하는 중' 표시 금지 */
export function applyBandSkipUi<T extends string>(ui: T, bandSkipped: boolean, everConnected: boolean): T | 'off' {
  if (bandSkipped && !everConnected && (ui === 'pending' || ui === 'lost')) return 'off';
  return ui;
}
