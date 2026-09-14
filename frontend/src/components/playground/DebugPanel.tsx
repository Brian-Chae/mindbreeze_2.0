/** P8-A — 디버그/로그 패널. */

import { useState } from 'react';
import type { PlaygroundLogEntry } from '../../types/playground';
import { StrokeIcon } from '../layout/SidebarNav';
import { PanelEmpty, PanelShell } from './PanelShell';

type Tab = 'logs' | 'json';

interface Props {
  logs: PlaygroundLogEntry[];
  snapshot: Record<string, unknown> | null;
  onClearLogs: () => void;
  paused: boolean;
  onTogglePause: () => void;
}

const LEVEL_CLASS: Record<PlaygroundLogEntry['level'], string> = {
  info: 'text-gray-400',
  warn: 'text-amber-300',
  error: 'text-red-300',
};

const ICON_PLAY = ['M5 3l14 9-14 9V3z'];
const ICON_PAUSE = ['M6 4h4v16H6z', 'M14 4h4v16h-4z'];
const ICON_TRASH = [
  'M3 6h18',
  'M8 6V4h8v2',
  'M19 6l-1 14H6L5 6',
];

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

export function DebugPanel({
  logs,
  snapshot,
  onClearLogs,
  paused,
  onTogglePause,
}: Props) {
  const [tab, setTab] = useState<Tab>('logs');

  return (
    <PanelShell
      title="P8-A · 디버그 / 로그"
      subtitle={`로그 ${logs.length}건`}
      state={logs.length > 0 || snapshot ? 'ready' : 'waiting'}
      actions={
        <div className="flex items-center gap-1">
          <TabButton active={tab === 'logs'} onClick={() => setTab('logs')}>
            이벤트
          </TabButton>
          <TabButton active={tab === 'json'} onClick={() => setTab('json')}>
            Metrics JSON
          </TabButton>
          <button
            type="button"
            onClick={onTogglePause}
            aria-label={paused ? '로그 재개' : '로그 일시정지'}
            className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:text-gray-100"
          >
            <StrokeIcon d={paused ? ICON_PLAY : ICON_PAUSE} size={14} />
          </button>
          <button
            type="button"
            onClick={onClearLogs}
            aria-label="로그 지우기"
            className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:text-gray-100"
          >
            <StrokeIcon d={ICON_TRASH} size={14} />
          </button>
        </div>
      }
    >
      {tab === 'logs' ? (
        logs.length === 0 ? (
          <PanelEmpty message="이벤트 로그가 없습니다." />
        ) : (
          <ul className="max-h-64 space-y-1 overflow-y-auto font-mono text-[11px]">
            {[...logs].reverse().map((log, i) => (
              <li key={`${log.ts}-${i}`} className="flex gap-2">
                <span className="shrink-0 text-gray-600">{formatTime(log.ts)}</span>
                <span className="shrink-0 text-gray-500">[{log.source}]</span>
                <span className={LEVEL_CLASS[log.level]}>{log.message}</span>
              </li>
            ))}
          </ul>
        )
      ) : snapshot ? (
        <pre className="max-h-64 overflow-auto rounded-lg bg-gray-950 p-3 text-[11px] text-gray-300">
          {JSON.stringify(snapshot, null, 2)}
        </pre>
      ) : (
        <PanelEmpty message="지표 스냅샷 대기 중…" />
      )}
    </PanelShell>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        'rounded px-2 py-1 text-[11px] font-medium transition-colors',
        active
          ? 'bg-[#5F0080] text-white'
          : 'bg-gray-800 text-gray-400 hover:text-gray-200',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
