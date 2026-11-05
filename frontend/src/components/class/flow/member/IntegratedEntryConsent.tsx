import { useEffect, useRef, useState } from 'react';
import type { StoredEntry } from '../../../../lib/api/class-flow';
import { isAiEnabled } from '../../../../lib/feature-flags';
import { EntryConsentTerminalError, checkIntegratedEntryActive, emptyEntryConsentValues, loadIntegratedEntryConsent, persistIntegratedEntryConsent, type EntryConsentCheckpoint, type EntryConsentValues } from '../../../../lib/class/flow/integrated-entry-consent';
import { IntegratedEntryConsentView } from './IntegratedEntryConsentView';
import type { MemberFlowSteps } from './MemberFlowFrame';

interface Props {
  entry: StoredEntry | null;
  acquireEntry?: () => Promise<StoredEntry>;
  initialValues?: EntryConsentValues | null;
  initialTouched?: readonly (keyof EntryConsentValues)[];
  eegLockedValue?: boolean;
  /** SDD-303: 서버에 필수·EEG·연구 선택이 현행 고지로 모두 확정돼 있으면 화면을 건너뛴다(저장 0, 서버 값 그대로 파생) */
  autoSkip?: boolean;
  steps?: MemberFlowSteps;
  onSaved: (entry: StoredEntry, values: EntryConsentValues) => void;
  onTerminal: (kind: 'closed' | 'cancelled') => void;
  onEntryError?: (error: unknown, values: EntryConsentValues, touched: (keyof EntryConsentValues)[]) => void;
  onBack: () => void;
  onExit?: () => void;
}
/** 리포트 선택은 서버에 고지 확인 증빙이 없어, 이 회차·참여자로 통합 동의를 저장한 적이 있는지를 기기에 표시해 재입장 때 화면을 건너뛰는 근거로 쓴다(값은 서버가 정본). */
const decidedKey = (entry: StoredEntry): string => `mb_consent_done_${entry.sessionId}_${entry.participantId ?? ''}`;
const readDecided = (entry: StoredEntry): boolean => { try { return window.sessionStorage.getItem(decidedKey(entry)) === '1'; } catch { return false; } };
const markDecided = (entry: StoredEntry): void => { try { window.sessionStorage.setItem(decidedKey(entry), '1'); } catch { /* 저장소 사용 불가면 다음 입장에서 화면을 다시 보인다 */ } };

export function IntegratedEntryConsent({ entry, acquireEntry, initialValues, initialTouched, eegLockedValue, autoSkip, steps, onSaved, onTerminal, onEntryError, onBack, onExit }: Props) {
  const [resolvedEntry, setResolvedEntry] = useState(entry);
  const [values, setValues] = useState<EntryConsentValues>(initialValues ?? emptyEntryConsentValues);
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const touched = useRef(new Set<keyof EntryConsentValues>(initialTouched));
  const [loading, setLoading] = useState(entry !== null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const alive = useRef(true);
  const busy = useRef(false);
  const terminal = useRef(onTerminal);
  terminal.current = onTerminal;
  const autoSkipRef = useRef(autoSkip);
  autoSkipRef.current = autoSkip;
  const savedRef = useRef(onSaved);
  savedRef.current = onSaved;
  const checkpoint = useRef<EntryConsentCheckpoint | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!resolvedEntry) return;
    let cancelled = false;
    setLoading(true); setLoadError(null);
    void loadIntegratedEntryConsent(resolvedEntry).then(result => {
      if (cancelled) return;
      if (eegLockedValue !== undefined && result.values.eeg !== eegLockedValue) throw new Error('뇌파 동의가 다른 화면에서 변경됐어요. 이 화면을 나갔다가 다시 입장해 주세요.');
      checkpoint.current = result.checkpoint;
      const restored = { ...result.values };
      // 아직 조작하지 않은 선택은 서버 기록을 복원한다. 미조회 false를 거절로 저장하지 않는다.
      for (const key of touched.current) restored[key] = valuesRef.current[key];
      setValues(restored);
      const info = resolvedEntry.classInfo;
      const cp = result.checkpoint;
      const decided = cp.required && (info?.linkbandMode === 'none' || cp.eeg !== null) && (resolvedEntry.isGuest || cp.research !== null);
      if (autoSkipRef.current && decided && (result.values.report || readDecided(resolvedEntry)) && info && resolvedEntry.participantId && resolvedEntry.credential) {
        savedRef.current(resolvedEntry, { ...restored, eeg: info.linkbandMode === 'none' ? false : restored.eeg, research: !resolvedEntry.isGuest && restored.research });
      }
    }).catch((error: unknown) => {
      if (!cancelled && error instanceof EntryConsentTerminalError) { terminal.current(error.kind); return; }
      if (!cancelled) setLoadError(error instanceof Error && error.message.includes('다른 화면') ? error.message : '동의 정보를 확인하지 못했어요. 다시 확인해 주세요.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [resolvedEntry, attempt, eegLockedValue]);

  const submit = async (): Promise<void> => {
    if (busy.current || loading || loadError || !values.required) return;
    busy.current = true; setSaving(true); setSaveError(null);
    const selected = { ...values };
    try {
      if (!resolvedEntry) {
        if (!acquireEntry) throw new Error('입장 자격을 확인할 수 없어요.');
        let acquired: StoredEntry;
        try { acquired = await acquireEntry(); } catch (error: unknown) { if (alive.current) onEntryError?.(error, selected, [...touched.current]); throw error; }
        if (!alive.current) return;
        // 부모에 자격을 공개하지 않는다. 실제 회차 고지와 서버 선택을 보여 준 뒤 다시 확인받는다.
        setResolvedEntry(acquired);
        return;
      }
      if (!resolvedEntry.classInfo || !resolvedEntry.participantId || !resolvedEntry.credential || !checkpoint.current) throw new Error('입장 정보를 확인할 수 없어요.');
      await checkIntegratedEntryActive(resolvedEntry);
      if (!alive.current) return;
      const effective = { ...selected, eeg: resolvedEntry.classInfo.linkbandMode === 'none' ? false : selected.eeg, research: !resolvedEntry.isGuest && selected.research };
      const saved = await persistIntegratedEntryConsent(resolvedEntry, effective, checkpoint.current, () => alive.current, eegLockedValue !== undefined);
      if (saved && alive.current) { markDecided(resolvedEntry); onSaved(resolvedEntry, effective); }
    } catch (error: unknown) {
      if (alive.current && error instanceof EntryConsentTerminalError) { terminal.current(error.kind); return; }
      if (alive.current) setSaveError('선택을 모두 저장하지 못했어요. 일부 항목은 저장됐을 수 있어요. 선택을 확인한 뒤 다시 저장해 주세요.');
    } finally {
      busy.current = false;
      if (alive.current) setSaving(false);
    }
  };
  const change = (next: EntryConsentValues): void => {
    for (const key of Object.keys(next) as (keyof EntryConsentValues)[]) if (next[key] !== values[key]) touched.current.add(key);
    setValues(next);
  };
  return <IntegratedEntryConsentView values={values} onChange={change} onSubmit={() => void submit()} onBack={onBack} onExit={onExit}
    onRetry={() => setAttempt(value => value + 1)} loading={loading} loadError={loadError} saving={saving} saveError={saveError}
    metadataPending={!resolvedEntry} metadataAcquired={!entry && Boolean(resolvedEntry)}
    researchAllowed={!resolvedEntry?.isGuest} eegAllowed={resolvedEntry?.classInfo?.linkbandMode !== 'none'} eegLocked={eegLockedValue !== undefined}
    place={resolvedEntry?.classInfo?.locationType} sessionType={resolvedEntry?.classInfo?.sessionType} title={resolvedEntry?.classInfo?.title ?? undefined} aiEnabled={isAiEnabled()} steps={steps} />;
}
