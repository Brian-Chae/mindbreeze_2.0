import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuthStore } from '../../stores/authStore';
import { useDialogA11y } from '../../hooks/useDialogA11y';
import { getPreferences, updatePreferences, type NotificationPreferencesResponse } from '../../lib/api/notifications';
import { EVENT_LABELS } from '../../lib/notification-format';
import { COMPATIBILITY_EVENTS, NOTIFICATION_GROUPS, aggregateNotificationGroup, groupKeys, type NotificationChannel, type NotificationGroup } from '../../lib/notification-preference-groups';
import { SettingsSwitch } from './settings-switch';

/** next 가 없으면 '세부 설정'으로 연 경우 — 현재 선택 그대로 시작한다. */
type PendingChange = { channel: NotificationChannel; group: NotificationGroup; next?: boolean };
function ChangeConfirmation({ pending, prefs, onConfirm, onCancel }: { pending: PendingChange; prefs: NotificationPreferencesResponse; onConfirm: (draft: Record<string, boolean>) => void; onCancel: () => void }) {
  const ref = useDialogA11y(true, onCancel);
  const titleId = useId();
  const keys = groupKeys(prefs[pending.channel], pending.group);
  // 항목별 초안 — 묶음 스위치로 열면 모두 next 로, 세부 설정으로 열면 현재값으로 시작한다.
  const [draft, setDraft] = useState<Record<string, boolean>>(() => Object.fromEntries(keys.map((key) => [key, pending.next ?? prefs[pending.channel][key]])));
  const allOn = keys.every((key) => draft[key]);
  const channelLabel = pending.channel === 'email' ? '이메일' : '인앱';
  const groupLabel = NOTIFICATION_GROUPS.find(group => group.id === pending.group)?.label;
  // 화면 전환(transform) 안에서 fixed 가 갇혀 하단 메뉴 밑에 깔리지 않도록 body 로 띄운다.
  return createPortal(<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
    <section ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="flex max-h-[85dvh] w-full max-w-md flex-col rounded-2xl bg-white p-5 shadow-xl">
      <h3 id={titleId} className="text-lg font-bold">{groupLabel} · {channelLabel} 알림 세부 설정</h3>
      <p className="my-3 text-sm text-[#6F6F6F]">받을 알림을 항목별로 고른 뒤 적용해요. 적용 전에는 기존 선택을 유지해요.</p>
      <div className="flex min-h-12 items-center justify-between border-b border-[#EFEFEF] px-1 pb-2">
        <span className="text-sm font-semibold">전체</span>
        <SettingsSwitch label={`${groupLabel} ${channelLabel} 알림 전체`} checked={allOn ? true : keys.some((key) => draft[key]) ? 'mixed' : false} onChange={(next) => setDraft(Object.fromEntries(keys.map((key) => [key, next])))} />
      </div>
      <ul className="min-h-0 overflow-y-auto">{keys.map(key => <li key={key} className="flex min-h-12 items-center justify-between gap-3 border-b border-[#F3EEF5] px-1 last:border-0">
        <span className="text-sm">{EVENT_LABELS[key] ?? key}</span>
        <SettingsSwitch label={`${EVENT_LABELS[key] ?? key} ${channelLabel} 알림`} checked={draft[key]} onChange={(next) => setDraft((value) => ({ ...value, [key]: next }))} />
      </li>)}</ul>
      <div className="mt-4 flex justify-end gap-3"><button type="button" onClick={onCancel} className="min-h-11 rounded-xl px-4 text-[#6F6F6F]">취소</button><button type="button" onClick={() => onConfirm(draft)} className="min-h-12 rounded-xl bg-[#5B1A8A] px-5 font-bold text-white">적용하기</button></div>
    </section>
  </div>, document.body);
}
export default function NotificationGroups() {
  const userId = useAuthStore((state) => state.user?.id);
  const [prefs, setPrefs] = useState<NotificationPreferencesResponse | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reload, setReload] = useState(0);
  const [pending, setPending] = useState<PendingChange | null>(null);
  const busy = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    setPrefs(null); setError(''); setSaved(false); setPending(null); busy.current = false; setSaving(false);
    void getPreferences().then((result) => { if (generation.current === current) setPrefs(result); }).catch(() => {
      if (generation.current === current) setError('알림 설정을 불러오지 못했어요.');
    });
    return () => { generation.current = current + 1; };
  }, [userId, reload]);
  async function save(patch: NotificationPreferencesResponse, optimistic: NotificationPreferencesResponse) {
    if (!prefs || busy.current) return;
    const current = generation.current;
    const previous = prefs;
    busy.current = true; setSaving(true); setSaved(false); setError(''); setPending(null);
    setPrefs(optimistic);
    try {
      const result = await updatePreferences(patch);
      if (generation.current === current) { setPrefs(result); setSaved(true); }
    } catch {
      if (generation.current === current) { setPrefs(previous); setError('알림 설정을 저장하지 못했어요. 다시 시도해 주세요.'); }
    } finally {
      if (generation.current === current) { busy.current = false; setSaving(false); }
    }
  }
  function confirm(draft: Record<string, boolean>) {
    if (!prefs || !pending) return;
    // 이 묶음 항목만 전송한다(다른 묶음·채널·push 는 서버 병합 계약으로 보존). 바뀐 것이 없으면 저장하지 않는다.
    if (Object.entries(draft).every(([key, value]) => prefs[pending.channel][key] === value)) { setPending(null); return; }
    void save({ email: {}, in_app: {}, [pending.channel]: draft }, { ...prefs, [pending.channel]: { ...prefs[pending.channel], ...draft } });
  }
  const compatibility = Object.entries(COMPATIBILITY_EVENTS).filter(([key]) => prefs && (key in prefs.email || key in prefs.in_app));
  return <section aria-label="목적별 알림 설정" className="space-y-5">
    <p className="text-sm leading-relaxed text-[#6F6F6F]">일정·참여, 대화, 리포트·운영 소식을 이메일과 인앱에서 각각 선택해요. 기존 선택이 섞여 있으면 ‘일부’로 표시돼요.</p>
    {error && <div role="alert" className="text-sm text-red-700">{error}{!prefs && <button type="button" className="ml-2 min-h-11 underline" onClick={() => setReload((value) => value + 1)}>다시 시도</button>}</div>}
    {!prefs && !error && <p role="status" className="text-sm">알림 설정 불러오는 중...</p>}
    {prefs && NOTIFICATION_GROUPS.map((group) => <div key={group.id} className="border-b border-[#EFEFEF] pb-4 last:border-0">
      <h3 className="font-bold text-[#33213F]">{group.label}</h3><p className="mt-1 text-sm text-[#6F6F6F]">{group.description}</p>
      {(['email', 'in_app'] as const).map((channel) => <div key={channel} className="flex min-h-14 items-center justify-between gap-4">
        <span className="flex items-center gap-2">{channel === 'email' ? '이메일' : '인앱'}{groupKeys(prefs[channel], group.id).length > 0 && <button type="button" disabled={saving} onClick={() => setPending({channel, group: group.id})} className="min-h-11 px-1 text-[13px] font-semibold text-[#5B1A8A] underline-offset-2 hover:underline disabled:opacity-50">세부 설정 {groupKeys(prefs[channel], group.id).filter((key) => prefs[channel][key]).length}/{groupKeys(prefs[channel], group.id).length}</button>}</span>
        <SettingsSwitch label={`${group.label} ${channel === 'email' ? '이메일' : '인앱'} 알림`} checked={aggregateNotificationGroup(prefs[channel], group.id)} disabled={saving || groupKeys(prefs[channel], group.id).length === 0} onChange={(next) => setPending({channel, group: group.id, next})} />
      </div>)}
    </div>)}
    {prefs && compatibility.length > 0 && <details className="rounded-xl border border-[#E9E2EB] p-3"><summary className="min-h-11 cursor-pointer text-sm font-semibold">추가 알림 선택</summary>{compatibility.map(([key, label]) => <div key={key} className="mt-3"><h3 className="font-semibold">{label}</h3>{(['email','in_app'] as const).filter(channel => key in prefs[channel]).map(channel => <div key={channel} className="flex min-h-14 items-center justify-between gap-3"><span>{channel === 'email' ? '이메일' : '인앱'}</span><SettingsSwitch label={`${label} ${channel === 'email' ? '이메일' : '인앱'} 알림`} checked={prefs[channel][key]} disabled={saving} onChange={next => void save({email:{},in_app:{},[channel]:{[key]:next}}, {...prefs,[channel]:{...prefs[channel],[key]:next}})} /></div>)}</div>)}</details>}
    {saved && <p role="status" className="text-sm text-[#5F0080]">알림 설정을 저장했어요.</p>}
    {pending && prefs && <ChangeConfirmation pending={pending} prefs={prefs} onConfirm={confirm} onCancel={() => setPending(null)} />}
  </section>;
}
