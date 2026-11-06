// SDD-303 — 전체/필수/선택 체크 방식 통일. 실제 저장은 컨테이너가 담당한다.
import { useEffect, useRef, useState } from 'react';
import { FlowButton, FlowH1, FlowSheet, FlowSub } from '../shared/flow-primitives';
import { MemberFlowFrame, type MemberFlowSteps } from './MemberFlowFrame';
import { PrivacyPolicyLink } from '../../../legal/PrivacyPolicyLink';
import { RAW_RETENTION_DAYS, RESEARCH_METADATA_NOTICE } from '../../../../lib/privacy-policy';
import { RECORDING_HEADLINE, recordingNoticeLines } from '../../../../lib/class/flow/recording-consent';
import type { EntryConsentValues } from '../../../../lib/class/flow/integrated-entry-consent';
import './integrated-entry-consent.css';

interface Props {
  values: EntryConsentValues;
  onChange: (values: EntryConsentValues) => void;
  onSubmit: () => void;
  onBack: () => void;
  onExit?: () => void;
  onRetry: () => void;
  loading: boolean;
  metadataPending: boolean;
  metadataAcquired: boolean;
  loadError: string | null;
  saving: boolean;
  saveError: string | null;
  researchAllowed: boolean;
  eegAllowed: boolean;
  eegLocked: boolean;
  place?: 'online' | 'offline';
  sessionType?: string;
  aiEnabled: boolean;
  steps?: MemberFlowSteps;
  title?: string;
}
export function IntegratedEntryConsentView({ values, onChange, onSubmit, onBack, onExit, onRetry, loading, metadataPending, metadataAcquired, loadError, saving, saveError, researchAllowed, eegAllowed, eegLocked, place = 'online', sessionType, aiEnabled, steps, title }: Props) {
  const [details, setDetails] = useState(false);
  const allRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!saveError) return;
    errorRef.current?.focus({ preventScroll: true });
    errorRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [saveError]);
  // SDD-313: 전체 동의 상태는 화면에 보이는 모든 항목(잠긴 뇌파 포함)에서 파생한다. 잠긴 항목은 전체 토글로 바꾸지 않는다.
  const fields: (keyof EntryConsentValues)[] = ['required', ...(eegAllowed ? ['eeg' as const] : []), ...(researchAllowed ? ['research' as const] : []), 'report'];
  const toggleable = fields.filter(field => !(field === 'eeg' && eegLocked));
  const all = fields.every(field => values[field]);
  const partial = !all && fields.some(field => values[field]);
  useEffect(() => { if (allRef.current) allRef.current.indeterminate = partial; }, [partial, loading, loadError]);
  const row = (key: keyof EntryConsentValues, label: string, help: string, required = false) => (
    <label className={`iec-item${required ? ' iec-required' : ''}`} key={key}>
      <input type="checkbox" data-consent={key} checked={values[key]} disabled={saving || (key === 'eeg' && eegLocked)} aria-required={required || undefined}
        onChange={event => onChange({ ...values, [key]: event.target.checked })} />
      <span className="iec-copy"><span className="iec-heading"><span>{label}</span><span className={`iec-type${required ? ' required' : ''}`}>{required ? '필수' : '선택'}</span></span><small>{help}</small></span>
    </label>
  );
  return (
    <MemberFlowFrame title="입장 전 확인" wizard={Boolean(steps)} place={place} steps={steps} colClassName="fm-integrated-consent" onBack={onBack} onExit={onExit}
      sheetMode="bottom" sheetOpen={details}
      sheet={<FlowSheet open={details} sheetMode="bottom" title="개인정보·기록과 선택 동의 안내" onClose={() => setDetails(false)} footer={<FlowButton onClick={() => setDetails(false)}>확인했어요</FlowButton>}>
        <div className="iec-details">
          <section><h3>{RECORDING_HEADLINE}</h3>{recordingNoticeLines({ aiEnabled, online: place === 'online' }).map(line => <p key={line}>{line}</p>)}
            {eegAllowed && <p>뇌파는 LINK BAND를 쓸 때만 측정해요.</p>}
            <p>기록 원본(뇌파·음성·영상)은 {RAW_RETENTION_DAYS}일이 지나면 삭제돼요.</p><PrivacyPolicyLink>개인정보 처리방침 보기</PrivacyPolicyLink>
          </section>
          {sessionType === 'meditation' && <section><h3>볼 수 있는 사람</h3>
            <p>이 클래스의 진행 지도사와 등록된 다른 지도사는 함께 진행하기 위해 기록지와 리포트를 읽을 수 있어요. 진행하지 않는 지도사에게는 전사 원문·음성 및 영상 원본·실시간 개인 뇌파 지표를 제공하지 않아요. 참관하는 지도사는 송출·녹음·발언권을 조작할 수 없어요.</p>
            <p>센터 관리자는 명상 리포트를 읽을 수 있지만 수정하거나 승인할 수 없어요. 상담 본문은 공개되지 않아요.</p>
          </section>}
          {eegAllowed && <section><h3>뇌파 수집 동의 (선택)</h3><p>LINK BAND로 측정한 뇌파를 수집해요.</p><p>동의하지 않아도 클래스에는 그대로 참여할 수 있어요.</p><p>리포트 반영, 연구 활용 선택과는 별개예요.</p><p>설정 &gt; 개인정보에서 언제든 바꿀 수 있어요.</p></section>}
          {researchAllowed && <section><h3>연구 목적 데이터 활용 (선택)</h3>
            <p>동의하면 비식별 처리한 뇌파·맥박·움직임 데이터와 지표, 이름과 생년월일에서 생성한 HMAC 가명 ID·성별·생년·월이 삭제 기한 없이 계속 보관돼요</p>
            <p>{RESEARCH_METADATA_NOTICE}</p><p>동의하지 않아도 클래스에 참여할 수 있어요</p><p>철회하려면 운영팀에 요청해 주세요</p><p>비식별 처리해도 다른 정보와 결합하면 본인을 알아볼 가능성이 완전히 없지는 않아요</p>
          </section>}
          <section><h3>리포트 반영 (선택)</h3><p>반영하지 않아도 클래스에는 그대로 참여할 수 있어요</p><p>이미 보낸 리포트는 되돌릴 수 없어요</p><p>고르지 않으면 반영하지 않는 것으로 진행돼요</p><p>리포트 반영은 클래스가 끝나기 전까지 바꿀 수 있어요.</p></section>
        </div>
      </FlowSheet>}
      foot={<>
        {loadError ? <FlowButton kind="primary" onClick={onRetry}>다시 확인하기</FlowButton> : <FlowButton kind="primary" disabled={loading || saving || !values.required} onClick={onSubmit}>{saving ? '선택을 저장하고 있어요…' : saveError ? '다시 저장하기' : metadataPending ? '클래스 정보 확인하기' : '동의하고 계속하기'}</FlowButton>}
        <p className="fl-note iec-status" aria-live="polite">{loading ? '서버에 저장된 동의를 확인하고 있어요.' : saving ? '저장이 끝날 때까지 잠시 기다려 주세요.' : metadataPending ? '선택 동의는 클래스 정보를 확인한 다음 저장해요.' : values.required ? '선택 항목에 동의하지 않아도 참여할 수 있어요.' : '필수 항목을 선택해 주세요.'}</p>
      </>}
    >
      <div className="fm-head"><FlowH1>참여에 필요한<br />동의를 확인해 주세요</FlowH1><FlowSub>{metadataPending ? '먼저 녹음 동의 후 클래스 정보를 확인해요.' : <>{title ? `${title} · ` : ''}필수 항목에 동의하면 참여할 수 있어요.</>}</FlowSub></div>
      {loading ? <p role="status" className="iec-feedback">동의 정보를 확인하고 있어요.</p> : loadError ? <p role="alert" className="iec-feedback">{loadError}</p> : <>
        <>{metadataAcquired && <p className="iec-confirmation" role="status">클래스 안내와 기존 선택을 확인한 뒤 동의를 저장해 주세요.</p>}</>
        <section className="iec-card" aria-label="클래스 참여 동의">
          <label className="iec-item iec-all"><input ref={allRef} data-consent="all" type="checkbox" checked={all} disabled={saving}
            onChange={event => { const next = { ...values }; for (const field of toggleable) next[field] = event.target.checked; onChange(next); }} />
            <span className="iec-copy"><span className="iec-heading">전체 동의</span><small>필수 1개 · 선택 {fields.length - 1}개를 모두 선택해요.</small></span>
          </label>
          {row('required', '개인정보·녹음 동의', '개인정보·녹음 안내를 확인하고 동의해요.', true)}
          <div className="iec-options" role="group" aria-label="선택 동의 항목">
            {eegAllowed && row('eeg', '뇌파 수집 동의', eegLocked ? '밴드 준비 이후에는 여기서 변경할 수 없어요. 변경은 설정 > 개인정보에서 할 수 있어요.' : '선택하지 않으면 밴드 없이 참여해요.')}
            {researchAllowed && row('research', '연구 활용 동의', '연구 활용을 원할 때 선택해 주세요.')}
            {row('report', '리포트에 측정 결과 반영', '선택하지 않으면 리포트에 반영하지 않아요.')}
          </div>
        </section>
        <button className="iec-detail-link" type="button" onClick={() => setDetails(true)}>개인정보·기록과 선택 동의 자세히 보기</button>
        {saveError && <p ref={errorRef} role="alert" tabIndex={-1} className="iec-feedback">{saveError}</p>}
      </>}
    </MemberFlowFrame>
  );
}
