import { useCallback, useEffect, useState } from 'react';
import {
  disableWebPush,
  enableWebPush,
  getWebPushState,
  type WebPushState,
} from '../../lib/web-push';

const STATE_HINT: Record<WebPushState, string> = {
  unsupported: '이 브라우저는 웹 푸시를 지원하지 않아요. Chrome·Edge·Firefox를 쓰거나, iPhone은 홈 화면에 추가한 뒤 이용해 주세요.',
  unavailable: '현재 서버에서 브라우저 알림을 사용할 수 없어요.',
  denied: '브라우저에서 알림이 차단돼 있어요. 주소창의 사이트 설정에서 알림을 허용한 뒤 다시 시도해 주세요.',
  idle: '탭을 닫아도 새 메시지와 알림을 이 기기로 받아요.',
  subscribed: '이 기기로 브라우저 알림을 받고 있어요.',
};

export default function WebPushCard() {
  const [state, setState] = useState<WebPushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getWebPushState()
      .then((next) => { if (alive) setState(next); })
      .catch(() => { if (alive) setState('unavailable'); });
    return () => { alive = false; };
  }, []);

  const toggle = useCallback(async () => {
    if (busy || !state) return;
    setBusy(true);
    setError(null);
    try {
      if (state === 'subscribed') {
        await disableWebPush();
        setState('idle');
      } else {
        setState(await enableWebPush());
      }
    } catch {
      setError('알림 설정을 바꾸지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  }, [busy, state]);

  if (!state) return null;
  const canToggle = state === 'idle' || state === 'subscribed';
  const enabled = state === 'subscribed';

  return (
    <div className="bg-white border border-[#EFEFEF] rounded-2xl p-6" data-testid="web-push-card">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-[15px] font-bold text-[#1F1F1F] flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#5F0080]" />
            브라우저 알림
          </h3>
          <p className="mt-1.5 text-[13px] text-[#6F6F6F]">{STATE_HINT[state]}</p>
        </div>
        {canToggle && (
          <span className="-m-2.5 inline-flex shrink-0 items-center p-2.5">
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label="브라우저 알림"
              disabled={busy}
              onClick={() => { void toggle(); }}
              className={`relative w-10 h-6 rounded-full transition-colors disabled:opacity-50 ${
                enabled ? 'bg-[#5F0080]' : 'bg-[#DDDEE7]'
              }`}
            >
              <span
                className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                  enabled ? 'left-[18px]' : 'left-0.5'
                }`}
              />
            </button>
          </span>
        )}
      </div>
      {error && <p role="alert" className="mt-2 text-[12px] text-[#DC2626]">{error}</p>}
    </div>
  );
}
