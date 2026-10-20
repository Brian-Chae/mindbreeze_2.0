import { isNativeApp } from '../../../../lib/native/platform';
import { PermissionGuide } from '../../../native/permission-guide';
// SDD-208 M3 — 회원 시트 본문 5종: 내 상태 · 채팅 · 조용한 신호 · 소리 · 기기. 시트 틀(PlayerSheet)은 공용이고 여기는 안쪽만 그린다.
// 모든 문구는 시안 member.html 원문. D3: 소리 시트에 BGM 행을 두지 않는다(진행 중 BGM 무재생 정책).
import type { CSSProperties, ReactNode } from 'react';
import { Music, Power, Volume1 } from 'lucide-react';
import type { BandUi } from '../../../../lib/class/player-case';
import type { MemberCase, MemberIconName } from '../../../../lib/class/member-player-case';
import { PLAYER_METRICS } from '../../../../lib/class/player-case';
import { QuietSignalButtons } from '../../QuietSignalButtons';
import { MemberIcon } from './MemberIcon';
import { metricFraction } from './member-metrics';
import type { MemberClassViewProps, MemberSheetKey } from './member-view-types';
import './member-player.css';

const BAND_LIVE: readonly BandUi[] = ['on', 'weak', 'low'];

/* ───────── 내 상태 ───────── */

interface EmptyModel {
  icon: MemberIconName;
  title: string;
  text: string;
  button: string;
}

function emptyModel(band: BandUi): EmptyModel {
  switch (band) {
    case 'pending': return { icon: 'bluetooth', title: '밴드를 연결하는 중이에요', text: '연결되면 내 상태가 여기에 나타나요.', button: '기기에서 보기' };
    case 'leadoff': return { icon: 'alert', title: '접촉을 확인해 주세요', text: '밴드가 피부에 닿으면 상태가 다시 나타나요.', button: '확인 방법 보기' };
    case 'lost': return { icon: 'wifiOff', title: '다시 연결하는 중이에요', text: '연결되면 이어서 보여 드려요.', button: '기기에서 보기' };
    case 'unsupported': return { icon: 'bluetooth', title: '밴드 없이 참여 중이에요', text: isNativeApp() ? '기기 설정에서 Bluetooth 권한을 확인해 주세요.' : 'Chrome 또는 Edge로 열면 내 상태를 볼 수 있어요.', button: '기기에서 보기' };
    default: return { icon: 'bluetooth', title: '밴드 없이 참여 중이에요', text: 'LINK BAND를 연결하면 내 몸과 마음의 상태를 볼 수 있어요.', button: '기기에서 연결하기' };
  }
}

const GROUPS = [
  { key: 'MIND', label: '마음' },
  { key: 'BODY', label: '몸' },
] as const;

function StatusSheet({ props }: { props: MemberClassViewProps }) {
  const { input, hero, snapshot, actions } = props;
  if (!BAND_LIVE.includes(input.band)) {
    const empty = emptyModel(input.band);
    return (
      <div className="mp-empty">
        <span className="mp-empty__ic"><MemberIcon name={empty.icon} /></span>
        <h3>{empty.title}</h3>
        <p>{empty.text}</p>
        <button type="button" className="mp-pill mp-pill--small" onClick={() => actions.onSheetChange('device')}>{empty.button}</button>
      </div>
    );
  }
  return (
    <>
      <div className="mp-status-grid">
        {GROUPS.map((group) => (
          <GroupRow key={group.key} group={group} props={{ hero, snapshot, onHeroChange: actions.onHeroChange }} />
        ))}
      </div>
      <p className="mp-status-note">눌러서 가운데 링에 보여 드려요</p>
    </>
  );
}

interface GroupRowProps {
  group: (typeof GROUPS)[number];
  props: { hero: MemberClassViewProps['hero']; snapshot: MemberClassViewProps['snapshot']; onHeroChange: MemberClassViewProps['actions']['onHeroChange'] };
}

function GroupRow({ group, props }: GroupRowProps) {
  return (
    <>
      <div className="mp-grp-tag"><b>{group.key}</b><span>{group.label}</span></div>
      {PLAYER_METRICS.filter((m) => m.group === group.key).map((metric) => {
        const raw = props.snapshot[metric.key];
        const value = raw === null || !Number.isFinite(raw) ? null : Math.round(raw);
        const fraction = metricFraction(metric.key, value);
        return (
          <button
            key={metric.key}
            type="button"
            className="mp-mcell"
            data-pz="mcell"
            aria-pressed={props.hero === metric.key}
            onClick={() => props.onHeroChange(metric.key)}
          >
            <span className="mp-mring">
              <svg viewBox="0 0 64 64" aria-hidden="true">
                <circle className="mp-mring__trk" cx="32" cy="32" r="28" />
                {fraction === null ? null : (
                  <circle className="mp-mring__val" cx="32" cy="32" r="28" pathLength={100} strokeDasharray={`${Math.round(fraction * 1000) / 10} 100`} transform="rotate(-90 32 32)" />
                )}
              </svg>
              <span className="mp-mring__mv"><b>{value === null ? '—' : value}</b><i>{metric.unit}</i></span>
            </span>
            <span className="mp-mcell__label">{metric.label}</span>
          </button>
        );
      })}
    </>
  );
}

/* ───────── 채팅 ───────── */

function ChatSheet({ chat }: { chat: MemberClassViewProps['chat'] }) {
  if (!chat.enabled) return <p className="mp-chat__note">상담사가 채팅을 켜면 여기에서 대화할 수 있어요.</p>;
  if (!chat.authenticated) {
    return (
      <div className="mp-empty">
        <h3>채팅은 회원 전용이에요</h3>
        <p>채팅방 입장에는 회원가입이 필요해요. 가입 후 클래스에 다시 참여해 주세요.</p>
        <a className="mp-pill mp-pill--small" href="/register/client" target="_blank" rel="noopener noreferrer">회원가입 하기</a>
      </div>
    );
  }
  // 바텀 시트에서는 내용 높이를 고정해 링·PiP 가 밀려나지 않게 하고, 사이드 시트에서는 시트 높이를 채운다(CSS)
  return <div className="mp-chat-host">{chat.node}</div>;
}

/* ───────── 소리 ───────── */

function SoundSheet({ props, c }: { props: MemberClassViewProps; c: MemberCase }) {
  const { sound, actions } = props;
  const percent = Math.round(Math.min(1, Math.max(0, sound.volume)) * 100);
  const screenOff = (
    <div className="mp-row">
      <span className="mp-row__lbl">화면 끄기</span>
      <button type="button" className="mp-pill mp-pill--small" onClick={actions.onScreenOff}>
        <Power size={16} strokeWidth={2} aria-hidden="true" />
        화면 끄기
      </button>
    </div>
  );

  // 오프라인(대면)은 이 기기에서 가이드를 재생하지 않는다 — 현장 스피커로 함께 듣는다
  if (c.place === 'offline') {
    return (
      <>
        <p className="mp-note">같은 공간의 스피커로 함께 들어요. 이 기기에서는 소리가 나지 않아요.</p>
        {screenOff}
      </>
    );
  }

  return (
    <>
      {sound.trackTitle ? (
        <div className="mp-now">
          <span className="mp-now__ic"><Music size={20} strokeWidth={2} aria-hidden="true" /></span>
          <span className="mp-now__tx"><b>{sound.trackTitle}</b><span>상담사가 재생 중인 가이드</span></span>
        </div>
      ) : (
        <p className="mp-note">지금은 재생 중인 소리가 없어요.</p>
      )}
      {sound.blocked ? <button type="button" className="mp-pill mp-pill--block" onClick={actions.onResumeAudio}>소리 켜기</button> : null}
      <div className="mp-row">
        <Volume1 size={20} strokeWidth={2} aria-hidden="true" />
        <input
          className="mp-range"
          type="range"
          min={0}
          max={100}
          step={5}
          value={percent}
          aria-label="볼륨"
          style={{ '--fill': `${percent}%` } as CSSProperties}
          onChange={(e) => actions.onVolumeChange(Number(e.target.value) / 100)}
        />
        <span className="mp-row__val">{percent}%</span>
      </div>
      <div className="mp-row">
        <span className="mp-row__lbl">상담사 음성 듣기</span>
        <span className="mp-switch-wrap">
          <button
            type="button"
            className="mp-switch"
            role="switch"
            aria-checked={sound.speakerOn}
            aria-label="상담사 음성 듣기"
            onClick={() => actions.onSpeakerChange(!sound.speakerOn)}
          />
        </span>
      </div>
      {screenOff}
    </>
  );
}

/* ───────── 기기 ───────── */

function wavePath(values: readonly number[]): string {
  if (values.length < 2) return '';
  const peak = Math.max(1, ...values.map((v) => Math.abs(v)));
  return values
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${((i / (values.length - 1)) * 240).toFixed(1)} ${(20 - (v / peak) * 16).toFixed(1)}`)
    .join(' ');
}

interface DevTopProps {
  icon: MemberIconName;
  title: string;
  sub: ReactNode;
  coral?: boolean;
  action?: ReactNode;
}

function DevTop({ icon, title, sub, coral, action }: DevTopProps) {
  return (
    <div className="mp-dev-top">
      <span className="mp-dev-top__ic" data-tone={coral ? 'coral' : undefined}><MemberIcon name={icon} /></span>
      <span className="mp-dev-top__tx"><b>{title}</b><span>{sub}</span></span>
      {action}
    </div>
  );
}

function elapsedLabel(sec: number): string {
  const minutes = Math.floor(sec / 60);
  return minutes > 0 ? `${minutes}분째` : `${Math.max(0, Math.floor(sec))}초째`;
}

function DeviceSheet({ props }: { props: MemberClassViewProps }) {
  const { input, device, actions } = props;
  const note = (message: string): ReactNode => <p className="mp-note">{message}</p>;
  const errorLine = device.error ? <p className="mp-band-error" role="alert">{device.error}</p> : null;

  if (input.band === 'on' || input.band === 'weak' || input.band === 'low') {
    const sub =
      input.band === 'on'
        ? <><i className="mp-dev-top__dot" />연결됨 · {elapsedLabel(device.connectedElapsedSec)}</>
        : input.band === 'weak'
          ? <><MemberIcon name="signalLow" size={14} />신호 약함 · 접촉을 확인해 주세요</>
          : <><MemberIcon name="battery" size={14} />배터리 부족 · {device.battery === null ? '—' : `${Math.round(device.battery)}%`}</>;
    const lowBattery = input.band === 'low';
    const weakSignal = input.band === 'weak';
    const wave = device.raw;
    return (
      <>
        <DevTop
          icon="bluetooth"
          title="LINK BAND 2.0"
          sub={sub}
          action={<button type="button" className="mp-pill mp-pill--small" onClick={actions.onBandDisconnect}>연결 해제</button>}
        />
        <div className="mp-stats">
          <div className="mp-stat"><span>배터리</span><b data-warn={lowBattery ? 'true' : undefined}>{device.battery === null ? '—' : `${Math.round(device.battery)}%`}</b></div>
          <div className="mp-stat"><span>신호</span><b data-warn={weakSignal ? 'true' : undefined}>{device.signalLabel}</b></div>
          <div className="mp-stat"><span>접촉</span><b>{device.contactLabel}</b></div>
        </div>
        {device.analyzing ? <p className="mp-analyzing" role="status">AI 분석중</p> : null}
        {errorLine}
        {wave ? (
          <div className="mp-raw">
            <span>원시 데이터 · 2채널</span>
            <svg viewBox="0 0 240 40" preserveAspectRatio="none" aria-hidden="true">
              <path stroke="#B373EF" d={wavePath(wave.fp1)} />
              <path stroke="#01F0C8" d={wavePath(wave.fp2)} />
            </svg>
          </div>
        ) : null}
      </>
    );
  }

  if (input.band === 'leadoff') {
    return (
      <>
        <DevTop icon="alert" title="접촉이 확인되지 않아요" sub="밴드가 피부에 닿지 않았어요" coral />
        <div className="mp-card mp-info mp-info--steps mp-info--coral mp-sheet-card">
          <div className="mp-info__tx">
            <ol style={{ margin: 0 }}>
              <li>밴드를 이마 중앙에 맞춰 주세요</li>
              <li>머리카락이 센서에 닿지 않게 정리해 주세요</li>
              <li>센서 부분을 마른 천으로 닦아 주세요</li>
            </ol>
          </div>
        </div>
        <button type="button" className="mp-pill mp-pill--primary mp-pill--block" onClick={actions.onBandRecheck}>접촉 다시 확인</button>
      </>
    );
  }

  if (input.band === 'pending') {
    return (
      <>
        <DevTop icon="bluetooth" title="밴드를 연결하는 중이에요" sub={<span className="mp-dots" aria-hidden="true"><i /><i /><i /></span>} />
        {note('밴드 전원이 켜져 있는지, 가까이에 있는지 확인해 주세요.')}
        {errorLine}
        <button type="button" className="mp-pill mp-pill--block" onClick={actions.onBandCancel}>연결 취소</button>
      </>
    );
  }

  if (input.band === 'lost') {
    return (
      <>
        <DevTop icon="wifiOff" title="연결이 끊겼어요" sub="자동으로 다시 연결하고 있어요" coral />
        {note('끊긴 동안 측정된 값은 이 기기에 보관돼요. 연결되면 이어서 기록해요.')}
        {errorLine}
        <button type="button" className="mp-pill mp-pill--primary mp-pill--block" onClick={actions.onBandRetry}>수동으로 다시 연결</button>
      </>
    );
  }

  if (input.band === 'unsupported') {
    return (
      <>
        <DevTop icon="info" title={isNativeApp() ? "Bluetooth 권한을 확인해 주세요" : "이 브라우저에서는 연결이 안 돼요"} sub={isNativeApp() ? "기기 설정에서 Bluetooth와 앱 권한을 허용해 주세요" : "Safari·Firefox는 밴드 연결을 지원하지 않아요"} />
        {note(isNativeApp() ? '기기 설정에서 권한을 확인해 주세요. 밴드 없이도 수업에 참여할 수 있어요.' : 'Chrome 또는 Edge로 열면 연결할 수 있어요. 지금은 밴드 없이도 수업에 참여할 수 있어요.')}
        <button type="button" className="mp-pill mp-pill--block" onClick={actions.onBandContinue}>밴드 없이 계속</button>
      </>
    );
  }

  return (
    <>
      <DevTop icon="bluetooth" title="연결된 기기 없음" sub="밴드 없이도 수업에 참여할 수 있어요" />
      {errorLine}
      <PermissionGuide kind="bluetooth" onContinue={actions.onBandConnect}>{request =>
        <button type="button" className="mp-pill mp-pill--primary mp-pill--block" onClick={request}>
          {device.isMock ? '시뮬레이션 시작' : 'LINK BAND 연결'}
        </button>
      }</PermissionGuide>
      {note(isNativeApp() ? 'LINK BAND 연결 시 Bluetooth 권한을 사용해요. 거부해도 밴드 없이 참여할 수 있어요.' : 'Chrome·Edge에서 연결할 수 있어요 (Safari·Firefox 미지원)')}
    </>
  );
}

interface MemberSheetBodyProps {
  sheetKey: MemberSheetKey;
  props: MemberClassViewProps;
  c: MemberCase;
}

export function MemberSheetBody({ sheetKey, props, c }: MemberSheetBodyProps) {
  switch (sheetKey) {
    case 'status': return <StatusSheet props={props} />;
    case 'chat': return <ChatSheet chat={props.chat} />;
    case 'signal': return <div className="mp-signal"><QuietSignalButtons onSend={props.actions.onSignal} /></div>;
    case 'sound': return <SoundSheet props={props} c={c} />;
    case 'device': return <DeviceSheet props={props} />;
  }
}
