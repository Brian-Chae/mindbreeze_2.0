// SDD-209 SH5 — FH01 상담사 클래스 목록 본문 뷰(순수 props). 열린 클래스가 상단 고정, 아래는 예정/지난 카드 목록(표 아님).
// 캘린더·타임라인·`예약 만들기`는 없다(D-5②·AD21). 초대 N명만 표시한다(AD3).
import { CalendarDays, DoorClosed, DoorOpen, Play, Plus, Users, WifiOff } from 'lucide-react';
import { heroBackdrop } from './shell-data';
import type { HostFeatured, HostListModel, HostListTab } from './host-shell-data';
import { MethodChips } from './MethodChips';
import { HOST_CHIP_TONES, HOST_ITEM_ICONS } from './shell-icons';
import { StatusChip } from './StatusChip';
import './shell-kit.css';

/** 플레이어로 가는 의도: 열기(예정 클래스) · 이어서 열기 · 시작하기(로비 → 시작 확인) */
export type HostPlayerIntent = 'open' | 'continue' | 'start';

interface HostClassListViewProps {
  model: HostListModel;
  tab: HostListTab;
  onTab: (tab: HostListTab) => void;
  onCreate: () => void;
  onDetail: (id: string) => void;
  onEnterPlayer: (id: string, intent: HostPlayerIntent) => void;
  onRequestClose: (id: string) => void;
  /** 연결 끊김 등 상단 알림 한 줄 */
  notice?: string | null;
}

function Featured({ item, onEnterPlayer, onRequestClose }: { item: HostFeatured; onEnterPlayer: HostClassListViewProps['onEnterPlayer']; onRequestClose: HostClassListViewProps['onRequestClose'] }) {
  if (item.kind === 'next') {
    return (
      <section className="sh-card sh-live" data-testid="host-featured" aria-label="다음 클래스">
        <div className="sh-live__main">
          <div className="sh-line"><StatusChip chip={item.chip} tone="brand" /><span className="sh-dim2">{item.hint}</span></div>
          <h2 className="sh-live__title">{item.title}</h2>
          <div className="sh-chips"><MethodChips place={item.place} mode={item.mode} band={item.band} /></div>
          <div className="sh-line"><span className="sh-wait"><CalendarDays size={20} aria-hidden="true" />{item.whenLabel}</span></div>
        </div>
        <div className="sh-live__act">
          <button type="button" className="sh-btn" data-testid="featured-open" onClick={() => onEnterPlayer(item.id, 'open')}>
            <DoorOpen size={20} aria-hidden="true" />클래스 열기
          </button>
        </div>
      </section>
    );
  }
  const isOpen = item.chip === 'open';
  return (
    <section className="sh-hero sh-live" data-testid="host-featured" aria-label="지금 열려 있는 클래스">
      <div className="sh-hero__bg" style={{ backgroundImage: `url(${heroBackdrop(item.id)})` }} aria-hidden="true" />
      <div className="sh-live__main">
        <div className="sh-line"><StatusChip chip={item.chip} dark /><span className="sh-dim">{item.hint}</span></div>
        <h2 className="sh-live__title">{item.title}</h2>
        <div className="sh-chips"><MethodChips place={item.place} mode={item.mode} band={item.band} dark /></div>
        <div className="sh-line"><span className="sh-wait"><Users size={20} aria-hidden="true" />{item.waitLabel}</span></div>
      </div>
      <div className="sh-live__act">
        <button type="button" className="sh-hcta" data-testid="featured-continue" onClick={() => onEnterPlayer(item.id, 'continue')}>
          <DoorOpen size={20} aria-hidden="true" />이어서 열기
        </button>
        {isOpen ? (
          <div className="row2">
            <button type="button" className="sh-hcta soft" data-testid="featured-start" onClick={() => onEnterPlayer(item.id, 'start')}>
              <Play size={20} aria-hidden="true" />시작하기
            </button>
            <button type="button" className="sh-hcta dline" data-testid="featured-close" onClick={() => onRequestClose(item.id)}>
              <DoorClosed size={20} aria-hidden="true" />클래스 닫기
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function HostClassListView({ model, tab, onTab, onCreate, onDetail, onEnterPlayer, onRequestClose, notice = null }: HostClassListViewProps) {
  const nothing = !model.featured && model.counts.upcoming === 0 && model.counts.past === 0;
  const banner = notice ? <div role="status" className="sh-banner"><WifiOff size={20} aria-hidden="true" /><span>{notice}</span></div> : null;
  if (nothing) {
    return (
      <>
        {banner}
        <div className="sh-card sh-empty" data-testid="host-empty">
          <div className="sh-bigico"><CalendarDays size={32} aria-hidden="true" /></div>
          <h2>아직 만든 클래스가 없어요</h2>
          <p>유형과 방식을 고르면 1분 안에 클래스를 만들 수 있어요.</p>
          <button type="button" className="sh-btn" data-testid="host-empty-create" onClick={onCreate}>
            <Plus size={20} aria-hidden="true" />클래스 만들기
          </button>
        </div>
      </>
    );
  }
  return (
    <>
      {banner}
      {model.featured ? <Featured item={model.featured} onEnterPlayer={onEnterPlayer} onRequestClose={onRequestClose} /> : null}
      <div className="sh-tabs" role="tablist" aria-label="클래스 구분">
        <button type="button" role="tab" aria-selected={tab === 'upcoming'} onClick={() => onTab('upcoming')}>예정</button>
        <button type="button" role="tab" aria-selected={tab === 'past'} onClick={() => onTab('past')}>지난 클래스</button>
      </div>
      {model.groups.length === 0 ? (
        <div className="sh-card sh-row"><span className="sh-row__tx"><b>{tab === 'upcoming' ? '예정된 클래스가 없어요' : '지난 클래스가 없어요'}</b></span></div>
      ) : (
        model.groups.map((group) => (
          <section key={group.label} className="sh-list-sec" aria-label={group.label}>
            <div className="sh-glabel">{group.label}</div>
            {group.items.map((item) => {
              const Icon = HOST_ITEM_ICONS[item.icon];
              return (
                <div className="sh-item" key={item.id}>
                  <button type="button" className="sh-item__main" onClick={() => onDetail(item.id)}>
                    <span className="sh-item__ico"><Icon size={20} aria-hidden="true" /></span>
                    <span>
                      <span className="sh-item__top"><b>{item.title}</b><StatusChip chip={item.chip} tone={HOST_CHIP_TONES[item.chip]} /></span>
                      <span className="sh-item__sub">{item.sub}</span>
                    </span>
                  </button>
                  {item.canOpen ? (
                    <button type="button" className="sh-item__open" data-testid="item-open" onClick={() => onEnterPlayer(item.id, 'open')}>
                      <DoorOpen size={20} aria-hidden="true" />클래스 열기
                    </button>
                  ) : null}
                </div>
              );
            })}
          </section>
        ))
      )}
    </>
  );
}
