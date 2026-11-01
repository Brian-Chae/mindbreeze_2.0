import { useLocation } from 'react-router-dom';
import { useAppUpdate, type AppUpdateState } from '../../lib/update/use-app-update';
import { formatBytes, isUpdateHomePath, type UpdateDecision } from '../../lib/update/update-config';

interface SheetProps {
  notice: UpdateDecision;
  phase: AppUpdateState['phase'];
  progress: AppUpdateState['progress'];
  errorMessage: string;
  installSupported: boolean;
  onStart: () => void;
  onOpenSettings: () => void;
  onDismiss: () => void;
}

/** 배너 + 업데이트 시트의 표시 부분(훅과 분리해 테스트 가능). */
export function AppUpdateView({ notice, phase, progress, errorMessage, installSupported, onStart, onOpenSettings, onDismiss }: SheetProps) {
  const size = formatBytes(notice.sizeBytes);
  const pct = progress && progress.total > 0 ? Math.min(100, Math.round((progress.received / progress.total) * 100)) : null;
  const busy = phase === 'downloading' || phase === 'installing';
  const isIos = notice.kind === 'ios';
  const startLabel = phase === 'error' ? '다시 시도' : isIos ? 'TestFlight 열기' : installSupported ? '업데이트' : '다운로드 사이트 열기';

  return (
    <div role="dialog" aria-label="새 버전 안내" className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl bg-white p-5 shadow-[0_-8px_30px_rgba(0,0,0,0.18)] md:inset-x-auto md:bottom-6 md:right-6 md:w-[380px] md:rounded-2xl">
      <p className="text-base font-semibold text-[#2B1A3A]">새 버전({notice.latestLabel})이 있어요</p>
      <p className="mt-1 text-sm text-[#5A4A68]">
        {isIos
          ? 'iPhone은 TestFlight에서 업데이트해요. 아래 버튼을 누르면 TestFlight가 열려요.'
          : installSupported
            ? `업데이트를 누르면 내려받고 설치 화면까지 이어 드려요.${size ? ` (${size})` : ''}`
            : '다운로드 사이트에서 최신 설치 파일을 받아 설치해 주세요.'}
      </p>
      {notice.notes ? <p className="mt-1 text-xs text-[#7A6A88]">{notice.notes}</p> : null}

      {phase === 'downloading' ? (
        <div className="mt-3" aria-live="polite">
          <div className="h-2 overflow-hidden rounded bg-[#EFE6F5]">
            <div className="h-full bg-[#5F0080]" style={{ width: `${pct ?? 5}%` }} />
          </div>
          <p className="mt-1 text-xs text-[#5A4A68]">{pct === null ? '내려받는 중…' : `내려받는 중… ${pct}%`}</p>
        </div>
      ) : null}
      {phase === 'installing' ? <p className="mt-3 text-sm text-[#5A4A68]">설치 화면을 열었어요. 화면의 안내에 따라 설치해 주세요.</p> : null}
      {phase === 'needs-permission' ? (
        <div className="mt-3 rounded-lg bg-[#F7F1FA] p-3 text-sm text-[#2B1A3A]">
          <p className="font-medium">설치 허용이 필요해요</p>
          <p className="mt-1 text-xs text-[#5A4A68]">처음 한 번만 설정 화면에서 “이 출처 허용”을 켜고 돌아와 주세요. 돌아오면 이어서 진행해요.</p>
          <button type="button" className="mt-2 rounded bg-[#5F0080] px-3 py-1.5 text-sm font-medium text-white" onClick={onOpenSettings}>설정 열기</button>
        </div>
      ) : null}
      {phase === 'error' ? <p role="alert" className="mt-3 text-sm text-red-600">{errorMessage}</p> : null}

      <div className="mt-4 flex justify-end gap-2">
        {!notice.forced ? (
          <button type="button" className="rounded px-3 py-1.5 text-sm text-[#5A4A68]" onClick={onDismiss} disabled={busy}>나중에</button>
        ) : null}
        {phase !== 'needs-permission' ? (
          <button type="button" className="rounded bg-[#5F0080] px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50" onClick={onStart} disabled={busy}>
            {startLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** 앱 안 "새 버전 있음" 안내 (SDD-259). 홈 경로에서만, 네이티브 + latest.json 의 updateBannerEnabled 가 켜져 있고 설치본이 낮을 때만 보인다. */
export default function AppUpdateBanner() {
  const { pathname } = useLocation();
  const u = useAppUpdate();
  if (!u.notice || !isUpdateHomePath(pathname)) return null;
  return (
    <AppUpdateView
      notice={u.notice}
      phase={u.phase}
      progress={u.progress}
      errorMessage={u.errorMessage}
      installSupported={u.installSupported}
      onStart={u.start}
      onOpenSettings={u.openSettings}
      onDismiss={u.dismiss}
    />
  );
}
