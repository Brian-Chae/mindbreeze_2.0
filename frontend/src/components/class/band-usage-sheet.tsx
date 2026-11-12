// SDD-326: 밴드 시리얼 사용 이력 시트(코치·기관관리자 전용). 시리얼을 누르면 그 밴드가 쓰인 회차·참여자와
// 스트림 끊김·교체 횟수를 보여 준다. 점수·좋음/나쁨 판정 없이 사실(횟수)만 표시한다.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchBandDeviceUsage, type BandDeviceUsageResponse } from '../../lib/api/upload-status';
import { useDialogA11y } from '../../hooks/useDialogA11y';
import { gapCountText, gapReasonsText, splitBandSerial } from '../../lib/upload-status/view';

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'ok'; data: BandDeviceUsageResponse };

const dateText = (iso: string | null): string => {
  if (!iso) return '일시 미확인';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '일시 미확인' : d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
};

export function BandUsageSheet({ serial, onClose }: { serial: string; onClose: () => void }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const ref = useDialogA11y(true, onClose);
  useEffect(() => {
    let alive = true;
    setState({ kind: 'loading' });
    fetchBandDeviceUsage(serial).then((data) => { if (alive) setState({ kind: 'ok', data }); }).catch(() => { if (alive) setState({ kind: 'error' }); });
    return () => { alive = false; };
  }, [serial]);
  const parts = splitBandSerial({ band_serial: serial });
  // 앱 셸(하단 탭·사이드바)의 쌓임 맥락 밖(body)에 그려 모바일에서 시트가 하단 탭에 가려지지 않게 한다.
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 md:items-center" onClick={onClose}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label="밴드 사용 이력" tabIndex={-1} data-testid="band-usage-sheet" onClick={(e) => e.stopPropagation()}
        className="max-h-[85dvh] w-full overflow-y-auto rounded-t-[20px] bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl md:max-w-[560px] md:rounded-[20px] md:p-5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-[18px] font-bold">밴드 사용 이력</h2>
            <p className="font-mono text-[14px] text-[#4A3F52]">{parts?.head}<b className="font-bold text-[#5F0080]">{parts?.tail}</b></p>
          </div>
          <button type="button" onClick={onClose} aria-label="닫기" className="min-h-11 min-w-11 rounded-[10px] border border-[#E8E2ED] text-[#5F0080]">닫기</button>
        </div>
        {state.kind === 'loading' && <p role="status" className="mt-3 text-[#776D7B]">불러오는 중이에요…</p>}
        {state.kind === 'error' && <p role="alert" className="mt-3 text-[#4A3F52]">사용 이력을 불러오지 못했어요. 권한이 없거나 잠시 후 다시 시도해 주세요.</p>}
        {state.kind === 'ok' && (state.data.items.length === 0
          ? <p role="status" className="mt-3 text-[#776D7B]">이 밴드가 사용된 기록이 없어요</p>
          : (
            <ul className="mt-3 space-y-2" data-testid="band-usage-list">
              {state.data.items.map((it) => (
                <li key={`${it.session_id}:${it.participant_id}`} className="rounded-[12px] bg-[#F8F5FA] p-3 text-[13px]" data-testid="band-usage-item">
                  <p className="font-semibold">{it.session_title ?? '제목 없는 회차'} · {dateText(it.session_started_at)}</p>
                  <p>{it.display_name?.trim() ? it.display_name : '이름 미확인'}{it.is_current ? '' : ' · 중간에 다른 밴드로 교체됨'}</p>
                  <p className="text-[#655173]">스트림 {it.stream_count}개 · 교체로 닫힌 스트림 {it.superseded_count}개{it.firmware ? ` · 펌웨어 ${it.firmware}` : ''}</p>
                  {gapCountText(it.gap_count) && <p data-testid="band-usage-gap" className="text-[#655173]">{gapCountText(it.gap_count)}{gapReasonsText(it.gap_reasons) ? ` (${gapReasonsText(it.gap_reasons)})` : ''}</p>}
                </li>
              ))}
            </ul>
          ))}
        {state.kind === 'ok' && state.data.truncated && <p className="mt-2 text-[12px] text-[#776D7B]">최근 200건까지만 보여요</p>}
      </div>
    </div>,
    document.body,
  );
}
