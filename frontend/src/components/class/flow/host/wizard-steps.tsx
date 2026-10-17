// SDD-209 H1~H2 — 만들기 마법사 단계 본문(FH02a~e). 뷰는 props 만 받는다(상태는 useReducer 컨테이너·하니스가 소유).
import type { Dispatch } from 'react';
import { Heart, Leaf, MapPin, Moon, MoreHorizontal, Pencil, Sparkles, Video, VideoOff, Users, Mic, Waves, Volume2 } from 'lucide-react';
import type { LinkbandMode } from '../../../../lib/api/session';
import { WIZARD_TYPES, type WizardAction, type WizardDraft, type WizardType, type WizardUi } from '../../../../lib/class/class-wizard';
import { FlowH1 } from '../shared/flow-primitives';
import { FhCard, FhForm, FhGroup, FhInfo, FhSeg, FhStaticRow, FhToggleRow } from './host-flow-atoms';

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
  return (
    <FhCard>
      <FlowH1>어떤 클래스를 만들까요?</FlowH1>
      <FhForm>
        <FhGroup label="유형">
          <FhSeg
            label="유형"
            variant="fh-types"
            value={draft.type}
            options={WIZARD_TYPES.map((t) => {
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
              { value: 'solo', label: '1:1', icon: <Users size={20} aria-hidden="true" /> },
              { value: 'group', label: '그룹', icon: <Users size={20} aria-hidden="true" /> },
            ]}
            onChange={(size) => dispatch({ type: 'setSize', size })}
          />
          {draft.size === 'solo' ? <FhInfo>1:1은 참여자를 최대 1명으로 고정해요.</FhInfo> : null}
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
          <FhStaticRow icon={<Sparkles size={20} aria-hidden="true" />}>
            <span className="fh-two"><b>AI 분석</b><span>요약·리포트를 자동 생성</span></span>
          </FhStaticRow>
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
