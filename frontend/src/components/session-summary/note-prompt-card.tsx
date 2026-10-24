import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { classSummaryApi, sessionNotePromptApi } from '../../lib/api/class-summary';

export function NotePromptCard({ sessionId, eligible }: { sessionId: string; eligible: boolean }) {
  const [show, setShow] = useState(false);
  const [failure, setFailure] = useState<'dismiss' | 'disable' | null>(null);
  const [busy, setBusy] = useState(false);
  const claim = useRef<{ id: string; promise: Promise<{ show: boolean }> } | null>(null);
  const { search } = useLocation();
  useEffect(() => {
    let active = true;
    if (eligible) {
      // StrictMode의 effect 재실행도 동일 claim 응답을 구독해 한 번의 안내를 잃지 않는다.
      if (claim.current?.id !== sessionId) claim.current = { id: sessionId, promise: classSummaryApi.claimNotePrompt(sessionId) };
      void claim.current.promise.then(result => { if (active) setShow(result.show); }).catch(() => { if (active) setShow(false); });
    }
    return () => { active = false; };
  }, [sessionId, eligible]);
  async function close(action: 'dismiss' | 'disable') {
    setShow(false); setBusy(true); setFailure(null);
    try {
      if (action === 'disable') await sessionNotePromptApi.set(false);
      else await classSummaryApi.dismissNotePrompt(sessionId);
    } catch { setFailure(action); }
    finally { setBusy(false); }
  }
  return <>
    {show && <div className="ss-note" aria-label="진행 기록 안내">
      <p>진행 기록을 남겨두면 다음 회차를 준비할 때 오늘의 진행 내용과 관찰을 다시 볼 수 있어요. 참여자에게 전할 코멘트를 작성할 때도 참고할 수 있어요.</p>
      <div className="ss-actions"><Link className="ss-btn" to={`/sessions/${sessionId}/record${search}`} onClick={() => setShow(false)}>지금 남기기</Link><button className="ss-btn ss-quiet" onClick={() => void close('dismiss')}>비워두기</button><button className="ss-btn ss-quiet" onClick={() => void close('disable')}>전체 회차 안내 끄기</button></div>
      <p className="ss-caption">회차당 1회 안내 · 진행 기록은 선택이에요.</p>
    </div>}
    {failure && <div role="status" className="ss-caption">안내 설정을 저장하지 못했어요. <button className="ss-btn" disabled={busy} onClick={() => void close(failure)}>다시 저장</button></div>}
    <Link className="ss-text-link" to={`/sessions/${sessionId}/record${search}`}>진행 기록 남기기</Link>
    <p className="ss-caption">참여자에게 원문을 공유하지 않으며, 자동 초안에서도 제외해요.</p>
  </>;
}
