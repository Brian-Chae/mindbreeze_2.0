// SDD-220 F1 — "이 클래스는 녹음·녹화될 수 있어요" 필수 동의 체크. 체크하기 전에는 다음 단계로 갈 수 없다.
import { Check } from 'lucide-react';
import { isAiEnabled } from '../../../../lib/feature-flags';
import {
  RECORDING_CHECK_LABEL, RECORDING_HEADLINE, recordingNoticeLines,
} from '../../../../lib/class/flow/recording-consent';
import { PrivacyPolicyLink } from '../../../legal/PrivacyPolicyLink';

interface RecordingConsentCheckProps {
  checked: boolean;
  online?: boolean;
  /** 저장 실패 등으로 막혔을 때의 안내 */
  error?: string | null;
  onChange: (checked: boolean) => void;
}

export function RecordingConsentCheck({ checked, online = true, error = null, onChange }: RecordingConsentCheckProps) {
  const lines = recordingNoticeLines({ aiEnabled: isAiEnabled(), online });
  return (
    <section className="fm-blk" aria-label="녹음·녹화 동의">
      <b className="fm-qh">{RECORDING_HEADLINE}</b>
      <div className="fm-rlist">
        {lines.map((line) => <p key={line} className="fm-ft">{line}</p>)}
        <p className="fm-ft"><PrivacyPolicyLink>개인정보 처리방침 보기</PrivacyPolicyLink></p>
      </div>
      <button type="button" className="fm-check" role="checkbox" aria-checked={checked} aria-required="true" onClick={() => onChange(!checked)}>
        <span className="fm-box">{checked ? <Check aria-hidden="true" strokeWidth={3} /> : null}</span>{RECORDING_CHECK_LABEL}
      </button>
      {error ? <p className="fm-err" role="alert">{error}</p> : null}
    </section>
  );
}
