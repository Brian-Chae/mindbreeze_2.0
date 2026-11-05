// SDD-307 — 승인 v6: 큰 화면은 명부만, 모바일은 페이지 스크롤과 하단 시작 행동.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, MapPin, Mic, MicOff, Plus, Video, VideoOff } from 'lucide-react';
import { BAND_LABEL } from '../../../../lib/class/class-wizard';
import { lobbyDockItems, lobbyStatusLine, badElectrodeWord, type LobbyCell, type LobbyContext, type LobbyDockKind, type LobbyModel, type LobbyRow } from '../../../../lib/class/flow/host-lobby-model';
import { isRecordable, retentionText } from '../../../../lib/class/flow/host-start-model';
import { PlayerBackdrop } from '../../player/shared/PlayerBackdrop';
import { FlowButton, FlowSheet } from '../shared/flow-primitives';
import type { SetupMedia } from './SetupScreen';
import './host-flow-base.css';
import './host-flow-live.css';
import './host-lobby-v6.css';

export interface LobbyScreenProps extends LobbyContext {
  title: string;
  address: string | null;
  startText: string;
  model: LobbyModel;
  starting?: boolean;
  startPending?: boolean;
  onCancelStart?: () => void;
  startError?: string | null;
  connectionStale?: boolean;
  backdropSrc?: string;
  sheet?: ReactNode;
  sheetOpen?: boolean;
  banner?: ReactNode;
  onBack: () => void;
  onStart: () => void;
  canInvite?: boolean;
  onInviteAdd: () => void;
  onInviteSheet: () => void;
  onDock: (kind: LobbyDockKind) => void;
  media?: SetupMedia;
  onToggleMic?: () => void;
  onToggleCamera?: () => void;
  onRecheck?: () => void;
  accessCode?: string | null;
  onCopyCode?: () => void;
  codeCopied?: boolean;
  capacity?: number;
  joinUrl?: string;
  aiEnabled?: boolean;
  recordChecked?: boolean;
  onToggleRecord?: () => void;
  excluded?: number | null;
  research?: number | null;
  retentionDays?: number | null;
}

type Panel = 'tools' | 'invite' | 'code' | 'recording' | 'share' | 'devices';
type Filter = 'all' | 'pending' | 'away';
const CAMERA_HINT = { pending: '카메라 연결 확인 중', off: '카메라가 꺼져 있어요', denied: '카메라 권한을 허용해 주세요', nodevice: '연결된 카메라가 없어요', inuse: '카메라를 다른 앱에서 사용 중인지 확인해 주세요', unsupported: '이 브라우저에서는 카메라를 사용할 수 없어요', on: '' };
const CELL_TEXT: Record<LobbyCell, string> = { ok: '확인됨', wait: '준비 중', skip: '건너뜀', bad: '접촉 불량', na: '미사용' };

function MemberRow({ row, offline }: { row: LobbyRow; offline: boolean }) {
  const cells = [row.survey, row.band, ...(offline ? [] : [row.device])];
  return <tr data-member-row className="fhb-mrow">
    <td className="name" title={row.name}>{row.name}</td>
    {cells.map((cell, i) => <td key={i} className={cell === 'wait' || cell === 'bad' ? 'pending' : 'subtle'} title={cell === 'bad' && row.electrodes ? badElectrodeWord(row.electrodes) : undefined}>{i === 1 && cell === 'skip' ? '미사용' : CELL_TEXT[cell]}</td>)}
    <td><span className={`badge ${row.ready ? 'state' : 'pending'}`}>{row.ready ? '준비됨' : '준비 중'}</span></td>
  </tr>;
}

export function LobbyScreen(props: LobbyScreenProps) {
  const { model, place, starting, startPending, media, accessCode, recordChecked = true } = props;
  const offline = place === 'offline';
  const [panel, setPanel] = useState<Panel | null>(null);
  const openPanel = (next: Panel | null): void => {
    if (next !== null) props.onCancelStart?.();
    setPanel(next);
  };
  const [filter, setFilter] = useState<Filter>('all');
  const [visibleCount, setVisibleCount] = useState(8);
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 700px)').matches);
  const [shareMessage, setShareMessage] = useState('');
  const tableRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 700px)');
    const change = () => { setWide(mq.matches); setVisibleCount(8); if (tableRef.current) tableRef.current.scrollTop = 0; };
    mq.addEventListener('change', change);
    return () => mq.removeEventListener('change', change);
  }, []);
  const validCode = Boolean(accessCode && /^\d{4}$/.test(accessCode));
  const recordable = isRecordable({ place }, media?.mic === 'on');
  const checked = recordable && recordChecked;
  const pending = model.rows.filter(row => !row.ready);
  const present = filter === 'away' ? [] : filter === 'pending' ? pending : [...pending, ...model.rows.filter(row => row.ready)];
  const away = filter === 'pending' ? [] : model.awayEntries;
  const total = present.length + away.length;
  const limit = wide ? total : visibleCount;
  const busy = Boolean(starting || startPending);
  const modalOpen = panel !== null || props.sheetOpen;
  const summary = lobbyStatusLine(model.stats);
  const privacy = <>{props.excluded == null ? <span>리포트 미반영 · 미확인</span> : props.excluded > 0 ? <span>리포트 미반영 <b>{props.excluded}명</b></span> : null}{props.research == null ? <span>연구 활용 동의 · 미확인</span> : props.research > 0 ? <span>연구 활용 동의 <b>{props.research}명</b></span> : null}</>;
  const recordCopy = <><p>{retentionText(props.retentionDays ?? null)}. 나와 담당 코치만 열람해요.</p><p>{offline ? '현장 녹음은 이 기기의 마이크를 사용해요.' : '음성 녹음을 꺼도 영상 녹화는 카메라와 현재 설정에 따라 시작해요.'}</p><p>녹음 동의는 회원 입장 단계에서 확인해요.</p></>;
  const changeFilter = (next: Filter) => { setFilter(next); setVisibleCount(8); if (tableRef.current) tableRef.current.scrollTop = 0; };
  const share = async () => {
    if (!validCode || !props.joinUrl) return;
    openPanel('share'); setShareMessage('');
    try {
      if (navigator.share) { await navigator.share({ title: props.title, url: props.joinUrl }); setShareMessage('공유 창을 닫았어요.'); }
      else if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(props.joinUrl); setShareMessage('초대 링크를 복사했어요.'); }
      else setShareMessage('아래 링크를 선택해서 복사해 주세요.');
    } catch (error) { setShareMessage(error instanceof DOMException && error.name === 'AbortError' ? '공유를 취소했어요.' : '아래 링크를 선택해서 복사해 주세요.'); }
  };
  return <div className={`pz-root fl-root fh-lobby-v6${offline ? ' offline' : ''}`} data-pz="app" data-place={place}>
    <PlayerBackdrop imageSrc={props.backdropSrc} />
    <main className="shell" inert={modalOpen}>
      <header className="top panel">
        <button type="button" className="btn icon-btn quiet" aria-label="대기실 나가기" data-pz="flow-back" onClick={props.onBack}><ChevronLeft /></button>
        <div className="title"><p><span className="dot" />대기실 · {offline ? '오프라인' : '온라인'}</p><h1 title={props.title}>{props.title}</h1></div>
        <button type="button" className="btn quiet tools" onClick={() => openPanel('tools')}>도구</button>
        <div className="codebar"><div className="code-group"><small>입장 코드</small><b className="code">{validCode ? accessCode : '확인 중'}</b></div><div className="code-actions"><button type="button" className="btn quiet" disabled={!validCode} onClick={() => openPanel('code')}>크게 보기</button><button type="button" className="btn quiet" disabled={!validCode} onClick={props.onCopyCode}>{props.codeCopied ? '복사됨' : '복사'}</button></div></div>
      </header>
      <div className="page-heading"><h2>함께 시작할 준비</h2><p>회원 입장과 준비 상태를 확인하세요.</p></div>
      <div className="workspace">
        <aside className="left">
          {!offline && <section className="self panel" aria-label="내 카메라 영상 미리보기">
            <video ref={media?.videoRef} autoPlay muted playsInline hidden={media?.cam !== 'on'} />
            {media?.cam !== 'on' && <div className="camera-placeholder"><VideoOff size={26} /><span>{CAMERA_HINT[media?.cam ?? 'off']}</span></div>}
            <span className="tag"><span className="dot" />내 카메라 · 미리보기</span>
            <div className="bottom"><span>마이크 {media?.mic === 'on' ? '켜짐' : media?.mic === 'pending' ? '확인 중' : '꺼짐'}</span><button type="button" className="btn" disabled={busy} onClick={() => openPanel('devices')}>기기 설정</button></div>
          </section>}
          <section className="invite panel"><div className="section-kicker">함께할 회원을 불러오세요</div><h2>회원 초대</h2><p>기존 회원을 선택하거나<br className="desktop-break" /> 이메일·링크·코드로 초대해요.</p>
            <button type="button" className="btn invite-main" onClick={() => openPanel('invite')}><Plus />회원 초대</button>
            <div className="invite-links"><button type="button" className="btn quiet" disabled={!validCode || !props.joinUrl} onClick={() => void share()}>링크 공유 ↗</button><button type="button" className="btn quiet" disabled={!validCode} onClick={() => openPanel('code')}>코드 보기</button></div>
            {offline && <p><MapPin size={14} /> {props.address?.trim() || '장소는 클래스 상세에서 확인해요'} · {props.startText}</p>}
          </section>
        </aside>
        <section className="right" aria-label="회원 입장과 준비 현황">
          <div className="stats panel"><div className="stat"><small>입장 / 정원</small><strong>{model.stats.inRoom} <span className="denominator">/ {props.capacity ?? '—'}</span></strong></div><div className="stat"><small>준비됨</small><strong className="mint">{model.stats.ready}</strong></div><div className="stat"><small>준비 중</small><strong className="coral">{model.stats.waiting}</strong></div><div className="stat"><small>미입장</small><strong>{model.stats.away}</strong></div></div>
          <section className="list panel" aria-labelledby="lobby-member-heading" data-pz="flow-list">
            <div className="listhead"><h2 id="lobby-member-heading">회원 준비 상태<span className="count">{model.stats.invited}명</span></h2><p>준비 중인 회원 먼저</p></div>
            <div className="filters" role="group" aria-label="회원 준비 상태 필터">{([['all', '전체', model.stats.invited], ['pending', '준비 중', model.stats.waiting], ['away', '미입장', model.stats.away]] as const).map(([key, label, count]) => <button key={key} type="button" className={`btn${filter === key ? ' active' : ''}`} aria-pressed={filter === key} onClick={() => changeFilter(key)}>{label} <span>{count}</span></button>)}</div>
            <div className="table-wrap" ref={tableRef} tabIndex={0} aria-label="회원 목록 스크롤"><table aria-label="회원별 준비 상태"><thead><tr><th scope="col">회원</th><th scope="col">설문</th><th scope="col">밴드</th>{!offline && <th scope="col">기기</th>}<th scope="col">상태</th></tr></thead><tbody>
              {present.slice(0, limit).map(row => <MemberRow key={row.id} row={row} offline={offline} />)}
              {away.slice(0, Math.max(0, limit - present.length)).map(row => <tr key={row.participantId} data-member-row><td className="name" title={row.name}>{row.name}</td><td>—</td><td>—</td>{!offline && <td>—</td>}<td><span className="badge absent">미입장</span></td></tr>)}
              {total === 0 && <tr><td className="empty" colSpan={offline ? 4 : 5}>{filter === 'pending' ? '준비 중인 회원이 없어요.' : filter === 'away' ? '모든 회원이 입장했어요.' : '아직 입장한 회원이 없어요.'}</td></tr>}
            </tbody></table></div>
            <div className="list-bottom"><div className="list-progress"><span role="status">{Math.min(limit, total)} / {total}명 표시</span><span>{BAND_LABEL[props.band]}</span></div>{!wide && total > limit && <button type="button" className="btn load-more" onClick={() => setVisibleCount(v => v + 8)}>{Math.min(8, total - limit)}명 더 보기 ⌄</button>}<p className="note">{props.connectionStale ? '연결 확인 중 · 마지막 수신 상태예요. 시작 전에 서버 상태를 다시 확인해요.' : model.stats.waiting ? `${model.stats.waiting}명이 준비 중이에요. 시작 후에도 이어서 준비할 수 있어요.` : model.stats.inRoom === 0 ? '아직 입장한 회원이 없어요. 시작 후에도 입장할 수 있어요.' : '입장한 회원이 준비됐어요. 원할 때 시작하세요.'}</p></div>
          </section>
        </section>
      </div>
      <section className="recording panel" aria-labelledby="lobby-recording-heading"><div className="recording-intro"><h2 id="lobby-recording-heading">녹음과 기록</h2><p>시작 전에 기록 방식을 살펴보세요.</p></div><div className="recording-main"><div className="recording-choice"><label><input type="checkbox" checked={checked} disabled={!recordable || busy} onChange={props.onToggleRecord} readOnly={!props.onToggleRecord} />{props.aiEnabled === false ? '음성을 녹음해요' : '녹음하고 AI 기록지를 만들어요'}</label><button type="button" className="btn quiet" onClick={() => openPanel('recording')}>기록 안내</button></div><div className="recording-copy">{recordCopy}{!checked && <p>음성 녹음 없이 수동 기록으로 진행해요.</p>}</div><div className="recording-counts">{privacy}</div></div></section>
    </main>
    <footer className="start-float" inert={modalOpen} data-floating-start aria-label="클래스 시작"><div className="start-summary"><strong role="status" aria-live="polite">{startPending ? '2초 뒤 시작 요청 · 지금은 취소할 수 있어요' : starting ? '시작 상태를 확인하고 있어요' : props.startError || summary}</strong><p>준비 중인 회원도 시작 후에 참여할 수 있어요.</p></div><div className="start-actions">{startPending && <button type="button" className="btn cancel-start" onClick={props.onCancelStart}>취소</button>}<button type="button" className="btn primary start" data-pz="flow-cta" disabled={busy} onClick={props.onStart}>{startPending ? '시작 준비 중' : starting ? '시작하는 중이에요' : '클래스 시작 →'}</button></div></footer>
    {props.banner}
    {panel !== null && <div className={`lobby-modal${panel === 'code' ? ' lobby-code-modal' : ''}`}><FlowSheet open title={{ tools: '대기실 도구', invite: '회원 초대', code: '클래스 입장 코드', recording: '기록 안내', share: '초대 링크 공유', devices: '카메라·마이크' }[panel]} onClose={() => openPanel(null)}>
      {panel === 'tools' && <div className="options">{lobbyDockItems(props).map(item => <button type="button" className="btn fhb-dk" key={item.kind} onClick={() => { openPanel(null); props.onDock(item.kind); }}>{item.label}</button>)}</div>}
      {panel === 'invite' && <div className="options">{props.canInvite !== false && <><button type="button" className="btn" onClick={() => { openPanel(null); props.onInviteAdd(); }}>기존 회원 선택</button><button type="button" className="btn" onClick={() => { openPanel(null); props.onInviteAdd(); }}>이메일로 초대</button></>}<button type="button" className="btn" disabled={!validCode || !props.joinUrl} onClick={() => void share()}>초대 링크 공유</button><button type="button" className="btn" disabled={!validCode} onClick={() => openPanel('code')}>입장 코드 크게 보기</button><button type="button" className="btn" onClick={() => { openPanel(null); props.onInviteSheet(); }}>초대 현황 · 다시 알림</button></div>}
      {panel === 'code' && <div className="big-code"><b className="code">{validCode ? accessCode : '코드 확인 중'}</b><p>회원 화면에서 코드로 입장해 주세요.</p><FlowButton kind="soft" disabled={!validCode} onClick={props.onCopyCode}>{props.codeCopied ? '복사했어요' : '입장 코드 복사'}</FlowButton></div>}
      {panel === 'recording' && <div className="recording-copy">{recordCopy}<p>{checked ? '녹음은 언제든 멈출 수 있어요.' : '음성 녹음 없이 수동 기록으로 진행해요.'}</p><div className="recording-counts">{privacy}</div></div>}
      {panel === 'share' && <><p role="status">{shareMessage}</p><label className="share-url">초대 링크<input readOnly value={props.joinUrl ?? ''} onFocus={event => event.currentTarget.select()} /></label></>}
      {panel === 'devices' && <div className="options"><button type="button" className="btn" disabled={busy || media?.mic === 'pending'} onClick={props.onToggleMic}>{media?.mic === 'on' ? <Mic /> : <MicOff />}마이크 {media?.mic === 'on' ? '끄기' : '켜기'}</button><button type="button" className="btn" disabled={busy || media?.cam === 'pending'} onClick={props.onToggleCamera}>{media?.cam === 'on' ? <Video /> : <VideoOff />}카메라 {media?.cam === 'on' ? '끄기' : '켜기'}</button><p>{media?.cam !== 'on' ? CAMERA_HINT[media?.cam ?? 'off'] : '대기실에서는 내 영상만 미리 보여요. 방송·녹화는 시작하지 않아요.'}</p>{(media?.mic === 'denied' || media?.cam === 'denied') && <p>주소창 왼쪽 사이트 설정에서 카메라·마이크를 허용한 뒤 다시 확인해 주세요.</p>}<button type="button" className="btn" disabled={busy} onClick={props.onRecheck}>장비 다시 확인</button></div>}
    </FlowSheet></div>}
    {props.sheetOpen ? <div className="lobby-modal">{props.sheet}</div> : props.sheet}
  </div>;
}
