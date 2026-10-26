// 상담사 상단 바 — 확정 라운드 컨트롤 스트립: 제목·코드 / 진행 시간·접속 인원.
import { useId, useRef } from 'react';
import { Copy } from 'lucide-react';
import { formatClock } from '../../../../lib/class/host-player-case';
import './host-player.css';

interface HostTopBarProps {
  title: string;
  accessCode?: string | null;
  codeCopied?: boolean;
  onCopyCode?: () => void;
  elapsedSec: number;
  durationMin: number;
  /** 접속 중/전체. 1:1 이면 null */
  stats: { joined: number; total: number } | null;
  onEnd: () => void;
  endDisabled?: boolean;
}

export function HostTopBar({ title, elapsedSec, durationMin, stats, onEnd, endDisabled, accessCode, codeCopied = false, onCopyCode }: HostTopBarProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dialogTitleId = useId();
  const code = accessCode && /^[0-9]{4}$/.test(accessCode) ? accessCode : null;
  const spacedCode = code?.split('').join(' ');
  const copyButton = () => (
    <button type="button" className="hp-entry-code__copy" aria-label="클래스 입장 코드 복사" onClick={onCopyCode} disabled={!onCopyCode}>
      <Copy size={16} aria-hidden="true" />
      <span>{codeCopied ? '복사됨' : '코드 복사'}</span>
    </button>
  );
  const elapsedMin = Math.floor(elapsedSec / 60);
  const elapsedRest = Math.floor(elapsedSec % 60);
  return (
    <>
      <header className="hp-topbar" data-variant="host" data-pz="top">
        <div className="hp-topbar-info" data-pz="ttl">
          <h1 className="hp-topbar-title" title={title}>{title}</h1>
          {code && <div className="hp-entry-code">
            <button type="button" className="hp-entry-code__open" aria-label="클래스 입장 코드 크게 보기" onClick={() => dialogRef.current?.showModal()}>
              <span className="hp-entry-code__label">코드 :</span>
              <strong className="hp-entry-code__digits">{code}</strong>
            </button>
          </div>}
          <p className="hp-time" aria-label={`함께한 시간 ${elapsedMin}분 ${elapsedRest}초, 계획 ${durationMin}분`}>
            <b>{formatClock(elapsedSec)}</b>
            <span>/ {formatClock(durationMin * 60)}</span>
          </p>
          {stats && <p className="hp-topbar-stats"><span>접속</span><b>{stats.joined}</b><span className="hp-topbar-stats__total">/ {stats.total}</span></p>}
        </div>
        <button type="button" className="hp-end" data-pz="btn-end" aria-label="클래스 종료" disabled={endDisabled} onClick={onEnd}>종료</button>
      </header>
    {code && <dialog ref={dialogRef} className="hp-entry-dialog" aria-labelledby={dialogTitleId}>
      <h2 id={dialogTitleId}>클래스 입장 코드</h2>
      <strong className="hp-entry-dialog__digits">{spacedCode}</strong>
      <p>멤버에게만 알려 주세요.</p>
      <div className="hp-entry-dialog__actions">
        {copyButton()}
        <button type="button" aria-label="입장 코드 크게 보기 닫기" onClick={() => dialogRef.current?.close()}>닫기</button>
      </div>
      <p role="status">{codeCopied ? '코드를 복사했어요.' : ''}</p>
    </dialog>}
    </>
  );
}
