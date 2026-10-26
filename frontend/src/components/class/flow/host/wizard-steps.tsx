// SDD-209 H1~H2 — 만들기 마법사 단계 본문(FH02a~e). 뷰는 props 만 받는다(상태는 useReducer 컨테이너·하니스가 소유).
import { useRef, type Dispatch, type ReactNode } from 'react';
import {
  AlertTriangle, Calendar, Check, CheckCircle2, ChevronLeft, ChevronRight, Heart, Leaf, Mail, MapPin, Mic, Moon, MoreHorizontal, Pencil, Play, Plus,
  Search, Sparkles, Upload, Users, Video, VideoOff, Volume2, Waves, X,
} from 'lucide-react';
import type { LinkbandMode } from '../../../../lib/api/session';
import {
  BAND_LABEL, MAX_DAY_OFFSET, MAX_DURATION_MIN, MAX_TIME_MIN, MIN_CAPACITY, MIN_DURATION_MIN, MIN_TIME_MIN, wizardTypeOptions, isSoloAllowed,
  capacityMax, fmtDay, fmtDuration, fmtHour, fmtMinute, fmtWhen, memberLimit, typeLabel,
  type WizardAction, type WizardDraft, type WizardMember, type WizardStep, type WizardType, type WizardUi,
} from '../../../../lib/class/class-wizard';
import { FlowButton, FlowH1 } from '../shared/flow-primitives';
import { FhCard, FhForm, FhGroup, FhInfo, FhSeg, FhStaticRow, FhStepper, FhToggleRow, type SegOption } from './host-flow-atoms';
import { isAiEnabled } from '../../../../lib/feature-flags';

export interface WizardStepProps {
  draft: WizardDraft;
  ui: WizardUi;
  dispatch: Dispatch<WizardAction>;
}

const TYPE_ICON: Readonly<Record<WizardType, typeof Heart>> = { clinical: Heart, hypnosis: Moon, meditation: Leaf, other: MoreHorizontal };

const BAND_INFO: Readonly<Record<LinkbandMode, string>> = {
  none: '입장 준비에서 LINK BAND 단계가 빠져요.',
  optional: '참가자가 LINK BAND 연결을 건너뛸 수 있어요.',
  required: '필수로 설정해도 참가자에게는 LINK BAND 사용을 권장해요. 없어도 참가할 수 있어요.',
};

/** FH02a 유형·진행 방식·인원 */
export function StepType({ draft, dispatch }: WizardStepProps) {
  const online = draft.place === 'online';
  const capMax = capacityMax(draft.place, draft.size);
  return (
    <FhCard>
      <FlowH1>어떤 클래스를 만들까요?</FlowH1>
      <FhForm>
        <FhGroup label="유형">
          <FhSeg
            label="유형"
            variant="fh-types"
            value={draft.type}
            options={wizardTypeOptions().map((t) => {
              const Icon = TYPE_ICON[t.id];
              return { value: t.id, label: t.label, icon: <Icon size={20} aria-hidden="true" /> };
            })}
            onChange={(type) => dispatch({ type: 'patch', patch: { type } })}
          />
          {draft.type === 'other' ? (
            <div className="fh-inwrap">
              <Pencil size={20} aria-hidden="true" />
              <input
                className="fl-input"
                value={draft.customName}
                maxLength={30}
                placeholder="클래스 유형 이름 (예: 감정 코칭)"
                aria-label="기타 유형 이름"
                onChange={(e) => dispatch({ type: 'patch', patch: { customName: e.target.value } })}
              />
            </div>
          ) : null}
        </FhGroup>
        <FhGroup label="진행 방식">
          <FhSeg
            label="진행 방식"
            value={draft.place}
            options={[
              { value: 'online', label: '온라인', icon: <Video size={20} aria-hidden="true" /> },
              { value: 'offline', label: '오프라인(대면)', icon: <MapPin size={20} aria-hidden="true" /> },
            ]}
            onChange={(place) => dispatch({ type: 'setPlace', place })}
          />
          {online ? (
            <div className="fh-info">
              <Volume2 size={20} aria-hidden="true" />
              <span>한 공간에서 여러 기기를 켜면 소리가 울릴 수 있어요.</span>
            </div>
          ) : (
            <div className="fh-inwrap">
              <MapPin size={20} aria-hidden="true" />
              <input
                className="fl-input"
                value={draft.address}
                maxLength={300}
                placeholder="장소 주소를 입력해 주세요"
                aria-label="장소 주소"
                onChange={(e) => dispatch({ type: 'patch', patch: { address: e.target.value } })}
              />
            </div>
          )}
        </FhGroup>
        <FhGroup label="인원">
          <FhSeg
            label="인원"
            value={draft.size}
            options={[
              ...(isSoloAllowed(draft.type) ? [{ value: 'solo' as const, label: '1:1', icon: <Users size={20} aria-hidden="true" /> }] : []),
              { value: 'group', label: '그룹', icon: <Users size={20} aria-hidden="true" /> },
            ]}
            onChange={(size) => dispatch({ type: 'setSize', size })}
          />
          {draft.size === 'solo' ? (
            <FhInfo>1:1은 참여자를 최대 1명으로 고정해요.</FhInfo>
          ) : (
            <>
              <FhStepper
                label="정원"
                text={`정원 ${draft.capacity}명`}
                decreaseLabel="정원 줄이기"
                increaseLabel="정원 늘리기"
                decreaseDisabled={draft.capacity <= MIN_CAPACITY}
                increaseDisabled={draft.capacity >= capMax}
                onDecrease={() => dispatch({ type: 'stepCapacity', delta: -1 })}
                onIncrease={() => dispatch({ type: 'stepCapacity', delta: 1 })}
              />
              <FhInfo warn={draft.capacity >= capMax}>
                {draft.capacity >= capMax
                  ? `${online ? '온라인' : '오프라인'} 그룹은 최대 ${capMax}명이라 더 늘릴 수 없어요.`
                  : `${online ? '온라인' : '오프라인'} 그룹은 최대 ${capMax}명까지 정할 수 있어요.`}
              </FhInfo>
            </>
          )}
        </FhGroup>
      </FhForm>
    </FhCard>
  );
}

/** FH02b LINK BAND·녹음 */
export function StepRecord({ draft, dispatch }: WizardStepProps) {
  const offline = draft.place === 'offline';
  return (
    <FhCard>
      <FlowH1>기록과 분석을 정해요</FlowH1>
      <FhForm>
        <FhGroup label="LINK BAND 사용">
          <FhSeg
            label="LINK BAND 사용"
            value={draft.band}
            options={[
              { value: 'none', label: '사용 안 함' },
              { value: 'optional', label: '선택' },
              { value: 'required', label: '필수' },
            ]}
            onChange={(band) => dispatch({ type: 'patch', patch: { band } })}
          />
          <div className="fh-info">
            <Waves size={20} aria-hidden="true" />
            <span>{BAND_INFO[draft.band]}</span>
          </div>
        </FhGroup>
        <FhGroup label="기록">
          <FhToggleRow
            icon={<Mic size={20} aria-hidden="true" />}
            title="음성 녹음"
            sub="시작 전에 안내해요"
            checked={draft.voice}
            onToggle={() => dispatch({ type: 'patch', patch: { voice: !draft.voice } })}
          />
          {/* SDD-220: AI 비공개면 'AI 분석' 안내 행을 숨긴다(녹음·영상 토글은 유지) */}
          {isAiEnabled() && (
            <FhStaticRow icon={<Sparkles size={20} aria-hidden="true" />}>
              <span className="fh-two"><b>AI 분석</b><span>요약·리포트를 자동 생성</span></span>
            </FhStaticRow>
          )}
          {offline ? (
            <FhStaticRow icon={<VideoOff size={20} aria-hidden="true" />}>대면 클래스는 영상 녹화 없이 진행해요.</FhStaticRow>
          ) : (
            <FhToggleRow
              icon={<Video size={20} aria-hidden="true" />}
              title="영상 녹화"
              sub="영상도 함께 저장해요"
              checked={draft.video}
              onToggle={() => dispatch({ type: 'patch', patch: { video: !draft.video } })}
            />
          )}
        </FhGroup>
      </FhForm>
    </FhCard>
  );
}

// ───────── FH02c 일정 ─────────

const DURATION_CHIPS: ReadonlyArray<SegOption<number>> = [30, 45, 50, 60, 90].map((m) => ({ value: m, label: `${m}분` }));

export interface ScheduleStepProps extends WizardStepProps {
  base: Date;
  /** 같은 시간대에 겹치는 기존 클래스 제목(없으면 null) */
  conflictTitle: string | null;
}

function DurationGroup({ draft, dispatch }: WizardStepProps) {
  return (
    <FhGroup label="소요 시간 · 5분 단위">
      <div className="fh-durrow">
        <FhStepper
          label="소요 시간"
          text={fmtDuration(draft.durationMin)}
          decreaseLabel="소요 시간 줄이기"
          increaseLabel="소요 시간 늘리기"
          decreaseDisabled={draft.durationMin <= MIN_DURATION_MIN}
          increaseDisabled={draft.durationMin >= MAX_DURATION_MIN}
          onDecrease={() => dispatch({ type: 'stepDuration', delta: -5 })}
          onIncrease={() => dispatch({ type: 'stepDuration', delta: 5 })}
        />
        <FhSeg label="소요 시간 바로 선택" variant="fh-c5" value={draft.durationMin} options={DURATION_CHIPS} onChange={(durationMin) => dispatch({ type: 'patch', patch: { durationMin } })} />
      </div>
    </FhGroup>
  );
}

export function StepSchedule({ draft, ui, dispatch, base, conflictTitle }: ScheduleStepProps) {
  const later = draft.when === 'later';
  return (
    <FhCard>
      <FlowH1>언제 열까요?</FlowH1>
      <FhForm>
        <FhSeg
          label="열리는 때"
          value={draft.when}
          options={[
            { value: 'now', label: '지금 바로', icon: <Play size={20} aria-hidden="true" /> },
            { value: 'later', label: '시간 예약', icon: <Calendar size={20} aria-hidden="true" /> },
          ]}
          onChange={(when) => dispatch({ type: 'setWhen', when })}
        />
        {later ? (
          <>
            <div className="fh-when3">
              <FhGroup label="날짜">
                <FhStepper
                  label="날짜"
                  text={fmtDay(base, draft.dayOffset)}
                  decreaseLabel="이전 날짜"
                  increaseLabel="다음 날짜"
                  decreaseIcon={<ChevronLeft size={20} aria-hidden="true" />}
                  increaseIcon={<ChevronRight size={20} aria-hidden="true" />}
                  decreaseDisabled={draft.dayOffset <= 0}
                  increaseDisabled={draft.dayOffset >= MAX_DAY_OFFSET}
                  onDecrease={() => dispatch({ type: 'stepDay', delta: -1 })}
                  onIncrease={() => dispatch({ type: 'stepDay', delta: 1 })}
                />
              </FhGroup>
              <FhGroup label="시">
                <FhStepper
                  small
                  label="시"
                  text={fmtHour(draft.timeMin)}
                  decreaseLabel="시 줄이기"
                  increaseLabel="시 늘리기"
                  decreaseDisabled={draft.timeMin < MIN_TIME_MIN + 60}
                  increaseDisabled={draft.timeMin >= MAX_TIME_MIN}
                  onDecrease={() => dispatch({ type: 'stepTime', delta: -60 })}
                  onIncrease={() => dispatch({ type: 'stepTime', delta: 60 })}
                />
              </FhGroup>
              <FhGroup label="분 · 5분 단위">
                <FhStepper
                  small
                  label="분"
                  text={fmtMinute(draft.timeMin)}
                  decreaseLabel="분 줄이기"
                  increaseLabel="분 늘리기"
                  onDecrease={() => dispatch({ type: 'stepMinute', delta: -5 })}
                  onIncrease={() => dispatch({ type: 'stepMinute', delta: 5 })}
                />
              </FhGroup>
            </div>
            {conflictTitle ? (
              <div className="fh-note warn" role="status">
                <AlertTriangle size={20} aria-hidden="true" />
                <span>같은 시간에 {conflictTitle}이 있어요. 겹쳐도 만들 수 있어요.</span>
              </div>
            ) : (
              <div className="fh-note ok" role="status">
                <CheckCircle2 size={20} aria-hidden="true" />
                <span>이 시간에는 다른 클래스가 없어요.</span>
              </div>
            )}
            <DurationGroup draft={draft} ui={ui} dispatch={dispatch} />
            <FhGroup label="예약 알림">
              <FhSeg
                label="예약 알림"
                value={draft.remind}
                options={[
                  { value: 'off', label: '끄기' },
                  { value: 'day', label: '하루 전' },
                  { value: 'hour', label: '1시간 전' },
                ]}
                onChange={(remind) => dispatch({ type: 'patch', patch: { remind } })}
              />
            </FhGroup>
          </>
        ) : (
          <>
            <FhInfo>만들면 바로 열 수 있어요. 일정은 따로 저장되지 않아요.</FhInfo>
            <DurationGroup draft={draft} ui={ui} dispatch={dispatch} />
          </>
        )}
      </FhForm>
    </FhCard>
  );
}

// ───────── FH02d 초대 ─────────

export interface InviteStepProps extends WizardStepProps {
  /** 초대할 수 있는 내 회원 목록(이미 서버 검색을 거친 결과) */
  members: readonly WizardMember[];
  membersState?: 'ok' | 'loading' | 'error';
  onCsvText?: (text: string) => void;
}

export function StepInvite({ draft, ui, dispatch, members, membersState = 'ok', onCsvText }: InviteStepProps) {
  const limit = memberLimit(draft);
  const query = ui.memberQuery.trim();
  const list = members.filter((m) => !query || m.name.includes(query) || m.email.includes(query));
  const full = draft.members.length >= limit;
  const csvRef = useRef<HTMLInputElement>(null);
  const readCsv = (file: File | undefined): void => {
    if (!file || !onCsvText) return;
    const reader = new FileReader();
    reader.onload = () => onCsvText(String(reader.result ?? ''));
    reader.readAsText(file);
  };
  const emailTab = ui.inviteTab === 'email';
  return (
    <FhCard>
      <FlowH1>누구를 초대할까요?</FlowH1>
      <FhSeg
        label="초대 방법"
        value={ui.inviteTab}
        options={[
          { value: 'member', label: '회원', icon: <Users size={20} aria-hidden="true" /> },
          { value: 'email', label: '비회원 이메일', icon: <Mail size={20} aria-hidden="true" /> },
        ]}
        onChange={(tab) => dispatch({ type: 'setInviteTab', tab })}
      />
      {emailTab ? (
        <>
          <FhInfo>비회원은 이메일로 초대할 수 있어요. 메일에 입장 코드가 들어가요. 건너뛰고 나중에 초대해도 돼요.</FhInfo>
          <div className="fh-emailin">
            <div className="fh-inwrap">
              <Mail size={20} aria-hidden="true" />
              <input
                className="fl-input"
                value={ui.mailInput}
                placeholder="name@example.com"
                inputMode="email"
                aria-label="초대할 이메일"
                onChange={(e) => dispatch({ type: 'setMailInput', value: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') dispatch({ type: 'addEmail' }); }}
              />
            </div>
            <FlowButton kind="soft" onClick={() => dispatch({ type: 'addEmail' })}><Plus size={20} aria-hidden="true" />추가</FlowButton>
          </div>
          {ui.mailError ? (
            <div className="fh-note warn" role="alert">
              <AlertTriangle size={20} aria-hidden="true" />
              <span>이메일 형식을 확인해 주세요.</span>
            </div>
          ) : null}
          <div className="fh-count"><span><b>이메일 {draft.emails.length}명</b> · 초대 인원은 정원에 포함하지 않아요</span></div>
          <div className="fh-plist">
            {draft.emails.map((email) => (
              <div className="fh-erow" key={email}>
                <span className="av"><Mail size={20} aria-hidden="true" /></span>
                <span className="em">{email}</span>
                <button type="button" className="fh-xbtn" aria-label={`${email} 삭제`} onClick={() => dispatch({ type: 'removeEmail', email })}><X size={20} aria-hidden="true" /></button>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="fh-inwrap">
            <Search size={20} aria-hidden="true" />
            <input className="fl-input" value={ui.memberQuery} placeholder="이름이나 이메일로 찾아요" aria-label="회원 검색" onChange={(e) => dispatch({ type: 'setMemberQuery', query: e.target.value })} />
          </div>
          <div className="fh-pchips">
            {draft.members.length ? (
              draft.members.map((m) => (
                <button type="button" key={m.id} className="fh-pchip" aria-label={`${m.name} 선택 해제`} onClick={() => dispatch({ type: 'toggleMember', member: m })}>
                  {m.name}<X size={16} aria-hidden="true" />
                </button>
              ))
            ) : (
              <span className="hint">아직 선택한 회원이 없어요. 건너뛰고 나중에 초대해도 돼요.</span>
            )}
          </div>
          <div className="fh-count">
            {draft.size === 'solo' ? (
              <span><b>{draft.members.length}명</b> · 1:1은 최대 1명이에요</span>
            ) : (
              <span><b>{draft.members.length}/{limit}명</b>{query ? ` · 검색 결과 ${list.length}명` : ''}</span>
            )}
            {onCsvText ? (
              <>
                <FlowButton kind="soft" onClick={() => csvRef.current?.click()}><Upload size={20} aria-hidden="true" />CSV 추가</FlowButton>
                <input ref={csvRef} className="fh-csv-input" type="file" accept=".csv,text/csv" aria-label="CSV 파일 선택" onChange={(e) => { readCsv(e.target.files?.[0]); e.target.value = ''; }} />
              </>
            ) : (
              <FlowButton kind="soft" disabled><Upload size={20} aria-hidden="true" />CSV 추가</FlowButton>
            )}
          </div>
          <div className="fh-plist">
            {membersState === 'error' ? <FhInfo warn role="alert">회원 목록을 불러오지 못했어요.</FhInfo> : null}
            {membersState === 'loading' ? <FhInfo role="status">회원 목록을 불러오는 중이에요.</FhInfo> : null}
            {membersState === 'ok' && !list.length ? <FhInfo role="status">검색 결과가 없어요.</FhInfo> : null}
            {list.map((m) => {
              const on = draft.members.some((x) => x.id === m.id);
              return (
                <button type="button" key={m.id} className={on ? 'fh-prow on' : 'fh-prow'} aria-pressed={on} disabled={!on && full} onClick={() => dispatch({ type: 'toggleMember', member: m })}>
                  <span className="av">{m.name.slice(0, 1)}</span>
                  <span>
                    <span className="nm" style={{ display: 'block' }}>{m.name}</span>
                    <span className="em" style={{ display: 'block' }}>{m.email}</span>
                  </span>
                  <span className="ck"><Check size={20} aria-hidden="true" /></span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </FhCard>
  );
}

// ───────── FH02e 확인 ─────────

export interface ConfirmStepProps extends WizardStepProps {
  base: Date;
}

export function StepConfirm({ draft, dispatch, base }: ConfirmStepProps) {
  const row = (icon: ReactNode, text: string, step: WizardStep, label: string): ReactNode => (
    <div className="fl-row fh-sumrow">
      {icon}
      <span className="tx">{text}</span>
      <button type="button" className="fh-edit" aria-label={`${label} 수정`} onClick={() => dispatch({ type: 'goto', step })}><Pencil size={20} aria-hidden="true" /></button>
    </div>
  );
  const sizeText = draft.size === 'solo' ? '1:1' : `그룹 · 정원 ${draft.capacity}명`;
  const place = draft.place === 'online' ? '온라인' : '오프라인';
  const t1 = `${typeLabel(draft)} · ${place} · ${sizeText}${draft.place === 'offline' && draft.address.trim() ? ` · ${draft.address.trim()}` : ''}`;
  const t2 = `${fmtWhen(draft, base)} · ${fmtDuration(draft.durationMin)}`;
  const t3 = [BAND_LABEL[draft.band], draft.voice ? '음성 녹음' : '녹음 안 함', draft.voice && isAiEnabled() ? 'AI 분석' : null, draft.place === 'online' && draft.video ? '영상 녹화' : null].filter(Boolean).join(' · ');
  const first = draft.members[0];
  const memberText = draft.members.length ? `${draft.members.length}명 초대 · ${first.name}${draft.members.length > 1 ? ` 외 ${draft.members.length - 1}명` : ''}` : '초대 없이 만들어요';
  const t4 = `${memberText}${draft.emails.length ? ` · 이메일 ${draft.emails.length}명` : ''}`;
  return (
    <FhCard>
      <FlowH1>이렇게 만들까요?</FlowH1>
      <FhForm>
        <div className="fh-inwrap">
          <Pencil size={20} aria-hidden="true" />
          <input className="fl-input" value={draft.title} maxLength={200} placeholder="클래스 이름 (예: 1차 상담, 스트레스 관리 명상)" aria-label="클래스 이름" onChange={(e) => dispatch({ type: 'patch', patch: { title: e.target.value } })} />
        </div>
        {row(<Leaf size={20} aria-hidden="true" />, t1, 1, '유형·방식·인원')}
        {row(<Calendar size={20} aria-hidden="true" />, t2, 3, '일정')}
        {row(<Waves size={20} aria-hidden="true" />, t3, 2, '기록과 분석')}
        {row(<Users size={20} aria-hidden="true" />, t4, 4, '초대')}
        <FhInfo>LINK BAND는 진단·치료 목적이 아니에요. 리포트 반영은 참가자가 직접 정해요.</FhInfo>
      </FhForm>
    </FhCard>
  );
}
