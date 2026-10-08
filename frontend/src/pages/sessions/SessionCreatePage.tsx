// 세션 생성 페이지 (UI Kit)

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createSession,
  inviteParticipant,
  listSessionTemplates,
  saveSessionAsTemplate,
  type CreateSessionPayload,
  type LinkbandMode,
  type LocationType,
  type ParticipantMode,
  type SessionDto,
  type SessionType,
} from '../../lib/api/session';
import { getCounselorProfile } from '../../lib/api/counselor';
import { getOrg } from '../../lib/api/org';
import { getLocationAddressDefault, getLocationAddressPayload, isLocationAddressVisible } from '../../lib/class/session-location';
import { REMINDER_OFF_OPTION, REMINDER_ON_OPTIONS } from '../../lib/class/reminder';
import AppShell from '../../components/layout/AppShell';
import { ParticipantPicker, type SelectedParticipant } from '../../components/session/ParticipantPicker';

export default function SessionCreatePage() {
  const navigate = useNavigate();
  const [type, setType] = useState<SessionType>('meditation');
  const [customTypeName, setCustomTypeName] = useState('');
  const [locationType, setLocationType] = useState<LocationType>('offline');
  const [locationAddress, setLocationAddress] = useState('');
  const locationAddressEdited = useRef(false);
  const [participantMode, setParticipantMode] = useState<ParticipantMode>('group');
  const [linkbandMode, setLinkbandMode] = useState<LinkbandMode>('optional');
  const [recordAudio, setRecordAudio] = useState(true);
  const [recordVideo, setRecordVideo] = useState(true);
  const [durationMin, setDurationMin] = useState(50);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  // 개선 6: 예약 사전 안내(리마인더) 시점 — 기본 '하루 전'으로 켜 두어 회원이 잊지 않게 한다.
  const [reminderOffsets, setReminderOffsets] = useState<number[]>([1440]);
  const toggleReminderOffset = (value: number): void => {
    setReminderOffsets((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value].sort((a, b) => b - a),
    );
  };
  const [maxParticipants, setMaxParticipants] = useState(10);
  const [participants, setParticipants] = useState<SelectedParticipant[]>([]);
  const [createdSession, setCreatedSession] = useState<SessionDto | null>(null);
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteWarning, setInviteWarning] = useState<string | null>(null);
  // SDD-095: 클래스 템플릿 — 반복 클래스를 같은 설정으로 다시 만든다.
  const [templates, setTemplates] = useState<SessionDto[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [templateHint, setTemplateHint] = useState<string | null>(null);
  const [templateSaved, setTemplateSaved] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getCounselorProfile().then(async (profile) => {
      const organization = profile.org_id ? await getOrg(profile.org_id).catch(() => null) : null;
      if (!cancelled && !locationAddressEdited.current) {
        setLocationAddress(getLocationAddressDefault({
          organizationAddress: organization?.address,
          addressLine1: profile.address_line1,
          addressLine2: profile.address_line2,
        }));
      }
    }).catch(() => { /* 기본 주소를 조회하지 못해도 직접 입력하거나 서버 기본값을 사용할 수 있다. */ });
    return () => { cancelled = true; };
  }, []);

  // 1:1 모드면 1명, 그룹이면 최대 참여자 수만큼 선택 가능
  const pickerMax = participantMode === 'one_on_one' ? 1 : maxParticipants;

  useEffect(() => {
    let cancelled = false;
    listSessionTemplates()
      .then((res) => {
        if (!cancelled) setTemplates(res.sessions);
      })
      .catch(() => {
        // 템플릿 조회 실패는 생성 자체를 막지 않는다(드롭다운만 비어 있음).
        if (!cancelled) setTemplates([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** 선택한 템플릿의 유형 설정을 폼에 채운다(제목·일정은 사용자가 새로 정한다). */
  const applyTemplate = (nextId: string): void => {
    setTemplateId(nextId);
    if (!nextId) {
      setTemplateHint(null);
      return;
    }
    const tpl = templates.find((t) => t.id === nextId);
    if (!tpl) return;
    setType(tpl.type);
    setCustomTypeName(tpl.custom_type_name ?? '');
    setLocationType(tpl.location_type);
    if (tpl.location_address) {
      locationAddressEdited.current = true;
      setLocationAddress(getLocationAddressDefault(tpl));
    }
    setParticipantMode(tpl.participant_mode);
    setMaxParticipants(tpl.max_participants);
    // MB2-06: 템플릿의 최대 인원으로 줄어들면 선택된 참여자도 그 수에 맞게 정리한다
    // (1:1 전환·수동 최대 인원 변경과 동일한 trim 규약).
    setParticipants((prev) =>
      prev.length > tpl.max_participants ? prev.slice(0, tpl.max_participants) : prev,
    );
    setLinkbandMode(tpl.linkband_mode);
    setRecordAudio(tpl.record_audio);
    setRecordVideo(tpl.record_video);
    setDurationMin(tpl.duration_min);
    setNotes(tpl.notes ?? '');
    setTemplateHint(
      `템플릿 '${tpl.title || '제목 없음'}' 설정을 불러왔습니다. 일정과 제목을 확인한 뒤 생성하세요.`,
    );
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload: CreateSessionPayload = {
        type,
        custom_type_name: type === 'custom' ? customTypeName : undefined,
        duration_min: durationMin,
        title: title || undefined,
        notes: notes || undefined,
        max_participants: maxParticipants,
        location_type: locationType,
        location_address: getLocationAddressPayload(locationType, locationAddress),
        participant_mode: participantMode,
        linkband_mode: linkbandMode,
        sfu_enabled: locationType === 'online' && participantMode === 'group',
        record_audio: recordAudio,
        record_video: recordVideo,
        // 개선 6: 예약 사전 안내 — 하루 전/1시간 전 시점(빈 배열이면 끔).
        reminder_offsets: reminderOffsets,
      };
      const created = await createSession(payload);

      // 선택된 참여자 일괄 초대 — 개별 실패해도 클래스 생성 자체는 성공 처리
      if (participants.length > 0) {
        const results = await Promise.allSettled(
          participants.map((p) => inviteParticipant(created.id, p.userId)),
        );
        const failed = participants.filter((_, i) => results[i].status === 'rejected');
        if (failed.length > 0) {
          setInviteWarning(
            `일부 참여자 초대에 실패했습니다: ${failed.map((p) => p.name).join(', ')}. 클래스 상세에서 다시 초대할 수 있습니다.`,
          );
        }
      }

      setCreatedSession(created);
    } catch (e) {
      setError(e instanceof Error ? e.message : '세션 생성에 실패했습니다');
    } finally {
      setSubmitting(false);
    }
  };

  /** SDD-095: 방금 만든 클래스 설정을 템플릿으로 저장 — 다음부터 원클릭 재사용. */
  const handleSaveAsTemplate = async (): Promise<void> => {
    if (!createdSession) return;
    setSavingTemplate(true);
    setError(null);
    try {
      await saveSessionAsTemplate(createdSession.id);
      setTemplateSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : '템플릿 저장에 실패했습니다');
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleCopyCode = async (): Promise<void> => {
    if (!createdSession?.access_code) return;
    try {
      await navigator.clipboard.writeText(createdSession.access_code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('클래스 코드를 복사하지 못했습니다. 코드를 직접 선택해 주세요.');
    }
  };

  const inputCls =
    'w-full px-3.5 py-2.5 border border-[#DDDEE7] rounded-xl bg-white text-[#1F1F1F] text-sm focus:outline-none focus:ring-2 focus:ring-[#5F0080]/15 focus:border-[#5F0080]';
  const labelCls = 'block text-sm font-medium text-[#1F1F1F] mb-1.5';

  if (createdSession) {
    return (
      <AppShell title="클래스 생성 완료" sub="CREATE">
        <div className="max-w-[640px] mx-auto">
          <div className="bg-white rounded-[20px] border border-[#EFEFEF] p-6 sm:p-10 text-center">
            <p className="text-sm font-semibold text-[#1F8A5B] mb-2">즉시 클래스가 준비되었습니다</p>
            <h1 className="text-2xl font-bold text-[#1F1F1F] mb-8">
              {createdSession.title || '제목 없음'}
            </h1>
            <p className="text-sm text-[#6F6F6F] mb-2">참여자에게 아래 클래스 코드를 공유하세요</p>
            <div className="rounded-[20px] bg-[#F5EDFC] border border-[#DDD0EA] px-4 py-8 mb-4">
              <div className="font-mono text-4xl sm:text-5xl font-black tracking-[0.12em] sm:tracking-[0.18em] text-[#5F0080] break-all">
                {createdSession.access_code || '------'}
              </div>
            </div>
            <button
              type="button"
              onClick={handleCopyCode}
              disabled={!createdSession.access_code}
              className="mb-btn w-full sm:w-auto disabled:opacity-50"
            >
              {copied ? '복사 완료' : '클래스 코드 복사'}
            </button>
            {/* SDD-095: 반복 클래스 대비 — 이 설정을 템플릿으로 남긴다 */}
            <div className="mt-4 rounded-xl border border-[#DDD0EA] bg-[#F5EDFC] px-4 py-3 text-left">
              <p className="text-sm font-semibold text-[#5F0080]">이 설정을 템플릿으로 저장</p>
              <p className="text-xs text-[#6F6F6F] mt-1 mb-3">
                유형·정원·진행 형태·녹화 설정만 저장합니다. 다음 클래스부터는 같은 설정을 한 번에 불러올 수 있습니다.
              </p>
              <button
                type="button"
                onClick={handleSaveAsTemplate}
                disabled={savingTemplate || templateSaved}
                className="mb-btn mb-btn--ghost text-sm disabled:opacity-50"
              >
                {templateSaved ? '템플릿으로 저장됨' : savingTemplate ? '저장 중...' : '템플릿으로 저장'}
              </button>
            </div>
            {inviteWarning && (
              <p className="mt-3 text-sm text-[#B3261E] bg-[#FDF1F0] border border-[#F2C9C5] rounded-xl px-4 py-3 text-left">
                {inviteWarning}
              </p>
            )}
            {error && <p className="mt-3 text-sm text-[#B3261E]">{error}</p>}
            <div className="flex flex-col sm:flex-row justify-center gap-2 mt-8">
              <button
                type="button"
                onClick={() => navigate(`/sessions/${createdSession.id}`)}
                className="mb-btn w-full sm:w-auto"
              >
                클래스 상세로 이동
              </button>
              <button
                type="button"
                onClick={() => navigate('/sessions')}
                className="mb-btn mb-btn--ghost w-full sm:w-auto"
              >
                클래스 목록으로 이동
              </button>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="새 세션" sub="CREATE">
      <div className="max-w-[640px] mx-auto">
        <div className="bg-white rounded-[20px] border border-[#EFEFEF] p-5 sm:p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* SDD-095: 내 템플릿에서 시작 — 저장해 둔 유형 설정을 폼에 채운다 */}
            {templates.length > 0 && (
              <div className="rounded-xl border border-[#DDD0EA] bg-[#F5EDFC] px-4 py-3">
                <label className={labelCls} htmlFor="session-template">
                  내 템플릿에서 시작
                </label>
                <select
                  id="session-template"
                  value={templateId}
                  onChange={(e) => applyTemplate(e.target.value)}
                  className={inputCls}
                >
                  <option value="">템플릿 선택 안 함</option>
                  {templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.title || '제목 없음'}
                    </option>
                  ))}
                </select>
                {templateHint && <p className="mt-2 text-xs text-[#6F6F6F]">{templateHint}</p>}
              </div>
            )}

            <div>
              <label className={labelCls} htmlFor="session-type">세션 유형</label>
              <select id="session-type" value={type} onChange={(e) => setType(e.target.value as SessionType)} className={inputCls}>
                <option value="meditation">명상수업</option>
                <option value="clinical">임상심리상담</option>
                <option value="hypnosis">최면심리상담</option>
                <option value="custom">기타</option>
              </select>
            </div>

            {type === 'custom' && (
              <div>
                <label className={labelCls} htmlFor="session-custom-type">유형 이름</label>
                <input
                  id="session-custom-type"
                  type="text"
                  required
                  maxLength={30}
                  value={customTypeName}
                  onChange={(e) => setCustomTypeName(e.target.value)}
                  className={inputCls}
                  placeholder="예: 집단상담"
                />
              </div>
            )}

            <div>
              <label className={labelCls} htmlFor="session-location">장소 유형</label>
              <select
                id="session-location"
                value={locationType}
                onChange={(e) => setLocationType(e.target.value as LocationType)}
                className={inputCls}
              >
                <option value="offline">오프라인 (대면)</option>
                <option value="online">온라인 (원격)</option>
              </select>
              <p className="mt-1.5 text-xs text-[#6F6F6F]">
                온라인은 상담사 영상·음성이 회원에게 실시간 스트리밍됩니다. 오프라인은 하울링 방지를 위해 회원 스피커가 기본 음소거됩니다.
              </p>
            </div>

            {isLocationAddressVisible(locationType) && (
              <div>
                <label className={labelCls} htmlFor="session-location-address">장소 (주소)</label>
                <input
                  id="session-location-address"
                  value={locationAddress}
                  onChange={(e) => { locationAddressEdited.current = true; setLocationAddress(e.target.value); }}
                  maxLength={300}
                  className={inputCls}
                  placeholder="상담 장소 주소를 입력해 주세요"
                />
                <p className="mt-1.5 text-xs text-[#6F6F6F]">비워 두면 기관 또는 상담사 프로필의 기본 주소가 사용됩니다.</p>
              </div>
            )}

            <div>
              <label className={labelCls} htmlFor="session-participant-mode">인원</label>
              <select
                id="session-participant-mode"
                value={participantMode}
                onChange={(e) => {
                  const nextMode = e.target.value as ParticipantMode;
                  setParticipantMode(nextMode);
                  if (nextMode === 'one_on_one') {
                    setMaxParticipants(1);
                    // 1:1 전환 시 선택된 참여자를 1명으로 정리
                    setParticipants((prev) => prev.slice(0, 1));
                  }
                }}
                className={inputCls}
              >
                <option value="one_on_one">1:1</option>
                <option value="group">1:N (그룹)</option>
              </select>
            </div>

            <div>
              <label className={labelCls} htmlFor="session-linkband-mode">LINK BAND</label>
              <select id="session-linkband-mode" value={linkbandMode} onChange={(e) => setLinkbandMode(e.target.value as LinkbandMode)} className={inputCls}>
                <option value="none">미사용</option>
                <option value="optional">선택</option>
                <option value="required">필수</option>
              </select>
            </div>

            {/* 개선 6: 예약 사전 안내(리마인더) — 참여코드·준비물·시작시간을 자동 공지 */}
            <div className="rounded-xl border border-[#DDD0EA] bg-[#F5EDFC] px-4 py-3">
              <p className="text-sm font-semibold text-[#5F0080]">예약 사전 안내 (리마인더)</p>
              <p className="text-xs text-[#6F6F6F] mt-1 mb-3">
                예약된 클래스 시작 전에 참여코드·준비물·브라우저 안내를 회원에게 자동으로 보냅니다.
                회원 홈·앱 알림과 이메일로 도착합니다.
              </p>
              <div className="flex flex-wrap gap-2" data-testid="reminder-options">
                <button
                  type="button"
                  aria-pressed={reminderOffsets.length === 0}
                  onClick={() => setReminderOffsets([])}
                  className={`rounded-full min-h-[44px] px-4 py-2.5 text-sm font-medium border transition-colors ${
                    reminderOffsets.length === 0
                      ? 'bg-[#5F0080] text-white border-[#5F0080]'
                      : 'bg-white text-[#1F1F1F] border-[#DDDEE7]'
                  }`}
                >
                  {REMINDER_OFF_OPTION.label}
                </button>
                {REMINDER_ON_OPTIONS.map((opt) => {
                  const active = reminderOffsets.includes(opt.value);
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleReminderOffset(opt.value)}
                      className={`rounded-full min-h-[44px] px-4 py-2.5 text-sm font-medium border transition-colors ${
                        active
                          ? 'bg-[#5F0080] text-white border-[#5F0080]'
                          : 'bg-white text-[#1F1F1F] border-[#DDDEE7]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-[#6F6F6F]">
                {reminderOffsets.length === 0
                  ? '사전 안내를 보내지 않습니다.'
                  : `${reminderOffsets
                      .map((v) => REMINDER_ON_OPTIONS.find((o) => o.value === v)?.label ?? `${v}분 전`)
                      .join(' · ')}에 안내합니다.`}
              </p>
            </div>

            <div className="rounded-xl border border-[#E6E1DA] bg-[#FAF9F7] px-4 py-3">
              <p className="text-sm font-semibold text-[#1F1F1F]">AI 클래스 분석</p>
              <p className="text-xs text-[#6F6F6F] mt-1 mb-3">
                영상·음성을 녹화해 세션 종료 후 분석 리포트를 생성합니다. 끄면 해당 미디어 리포트가 생성되지 않습니다.
              </p>
              <label className="flex items-center justify-between py-2 cursor-pointer">
                <span className="text-sm text-[#1F1F1F]">음성 녹화 (STT 발화자 기록지)</span>
                <input
                  type="checkbox"
                  checked={recordAudio}
                  onChange={(e) => setRecordAudio(e.target.checked)}
                  className="h-4 w-4 accent-[#5F0080]"
                />
              </label>
              <label className="flex items-center justify-between py-2 cursor-pointer">
                <span className="text-sm text-[#1F1F1F]">영상 녹화 (리플레이)</span>
                <input
                  type="checkbox"
                  checked={recordVideo}
                  onChange={(e) => setRecordVideo(e.target.checked)}
                  className="h-4 w-4 accent-[#5F0080]"
                />
              </label>
            </div>

            <div className="rounded-xl bg-[#F5EDFC] border border-[#DDD0EA] px-4 py-3">
              <p className="text-sm font-semibold text-[#5F0080]">즉시 클래스</p>
              <p className="text-xs text-[#6F6F6F] mt-1">
                일정 등록 없이 생성되며, 준비가 끝나면 상세 화면에서 바로 시작할 수 있습니다.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls} htmlFor="session-duration">소요 시간(분)</label>
                <input
                  id="session-duration"
                  type="number"
                  min={1}
                  max={600}
                  required
                  value={durationMin}
                  onChange={(e) => setDurationMin(Number(e.target.value))}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="session-max-participants">최대 참여자 수</label>
                <input
                  id="session-max-participants"
                  type="number"
                  min={1}
                  max={participantMode === 'one_on_one' ? 1 : 100}
                  required
                  value={maxParticipants}
                  disabled={participantMode === 'one_on_one'}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setMaxParticipants(next);
                    // 최대 인원 축소 시 선택된 참여자도 그 수에 맞게 정리
                    setParticipants((prev) => (prev.length > next ? prev.slice(0, next) : prev));
                  }}
                  className={`${inputCls} disabled:bg-[#F2F3F8]`}
                />
              </div>
            </div>

            <div>
              <label className={labelCls} htmlFor="session-title">제목</label>
              <input id="session-title" type="text" required value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
            </div>

            <div>
              <label className={labelCls} htmlFor="session-notes">메모</label>
              <textarea id="session-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={inputCls} />
            </div>

            <ParticipantPicker selected={participants} onChange={setParticipants} maxParticipants={pickerMax} />

            {error && <p role="alert" className="text-sm text-[#B3261E]">{error}</p>}

            <div className="flex flex-col sm:flex-row gap-2 pt-2">
              <button type="submit" disabled={submitting} className="mb-btn w-full sm:w-auto">
                {submitting ? '생성 중...' : '즉시 클래스 만들기'}
              </button>
              <button type="button" onClick={() => navigate('/sessions')} className="mb-btn mb-btn--ghost w-full sm:w-auto">
                취소
              </button>
            </div>
          </form>
        </div>
      </div>
    </AppShell>
  );
}
