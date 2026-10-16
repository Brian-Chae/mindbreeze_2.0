// SDD-208 H5 — 종료 후 "리포트 생성 중" 카드(D6: 종료 확정 후 이동은 현행 유지, 종료된 세션을 열었을 때의 씬만 시안 스타일).
// 진행 정보(progress)가 있으면 기존 ReportProgressStepper(dark)를 그대로 쓰고, 없으면 3단계 안내를 둔다.
import { Check, Clock } from 'lucide-react';
import type { ReportProgressDto } from '../../../../lib/api/reports';
import { ReportProgressStepper } from '../../../session/ReportProgressStepper';
import { PlayerBackdrop } from '../shared/PlayerBackdrop';
import './host-player.css';

export interface HostEndingStep {
  label: string;
  state: 'done' | 'doing' | 'wait';
}

const DEFAULT_STEPS: readonly HostEndingStep[] = [
  { label: '기록 정리', state: 'wait' },
  { label: 'AI 요약', state: 'wait' },
  { label: '리포트 생성', state: 'wait' },
];

const STATE_TEXT = { done: '완료', doing: '진행 중', wait: '대기' } as const;

interface HostEndingCardProps {
  progress: ReportProgressDto | null;
  /** progress 가 없을 때 보여 줄 3단계(하니스가 시안 상태를 넘긴다) */
  steps?: readonly HostEndingStep[];
  backdropSrc?: string;
  onViewRecord: () => void;
  onGoList: () => void;
}

export function HostEndingCard({ progress, steps = DEFAULT_STEPS, backdropSrc, onViewRecord, onGoList }: HostEndingCardProps) {
  return (
    <div className="pz-root hp-ending">
      <PlayerBackdrop imageSrc={backdropSrc} />
      <div className="hp-ecard" data-pz="ecard" role="status">
        <span className="hp-ecard__ic" aria-hidden="true"><Check size={26} strokeWidth={2} /></span>
        <h2>수업이 종료됐어요</h2>
        <p>리포트를 만드는 중이에요. 몇 분 걸릴 수 있어요.</p>
        {progress ? (
          <ReportProgressStepper progress={progress} tone="dark" onViewReport={onViewRecord} />
        ) : (
          <ol className="hp-esteps">
            {steps.map((step) => (
              <li key={step.label} data-state={step.state}>
                {step.state === 'done' ? <Check aria-hidden="true" strokeWidth={2} /> : <Clock aria-hidden="true" strokeWidth={2} />}
                {step.label}
                <small>{STATE_TEXT[step.state]}</small>
              </li>
            ))}
          </ol>
        )}
        <p>화면을 닫아도 계속 만들어요. 준비되면 알려 드려요.</p>
        <div className="hp-ecard__acts">
          <button type="button" className="hp-btn" onClick={onViewRecord}>기록 보기</button>
          <button type="button" className="hp-btn" data-variant="ghost" onClick={onGoList}>목록으로</button>
        </div>
      </div>
    </div>
  );
}
