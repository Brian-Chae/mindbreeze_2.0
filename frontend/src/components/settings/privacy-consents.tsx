// 설정 > 개인정보: 선택 동의(뇌파 수집·연구 활용) 확인·철회. 필수 동의와 회차 녹음·녹화 동의에는 영향이 없다.
// 저장에 실패하면 화면을 바꾸지 않고(성공으로 표시하지 않고) 안내만 한다.

import { useCallback, useEffect, useState } from 'react';
import { getMyConsents, updateMyConsents, type AccountConsentState } from '../../lib/api/account';
import { SettingsSwitch } from './settings-switch';
import { PrivacyPolicyLink } from '../legal/PrivacyPolicyLink';

type OptionalKey = 'eeg' | 'research';

const OPTIONS: ReadonlyArray<{ key: OptionalKey; title: string; desc: string }> = [
  { key: 'eeg', title: '뇌파(LINK BAND) 측정 데이터 수집', desc: '끄면 앞으로 LINK BAND 데이터를 보내지 않아요. 이미 수집한 데이터는 방침에 따라 보관·삭제돼요.' },
  { key: 'research', title: '비식별 연구 목적 활용', desc: '끄면 새로 연구에 쓰이지 않고, 이미 연구에 제공된 기록은 철회 요청으로 이어져요.' },
];

export function PrivacyConsentsSection() {
  const [state, setState] = useState<AccountConsentState | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState<OptionalKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoadFailed(false);
    try {
      setState(await getMyConsents());
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (key: OptionalKey): Promise<void> => {
    if (!state || saving) return;
    setSaving(key);
    setError(null);
    try {
      // 서버 응답으로만 화면을 갱신한다 — 저장 실패 시 이전 값이 그대로 보인다.
      setState(await updateMyConsents({ [key]: !state[key].agreed }));
    } catch {
      setError('변경 내용을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="bg-white border border-[#EFEFEF] rounded-2xl p-6" aria-label="개인정보 선택 동의">
      <h3 className="text-[15px] font-bold text-[#1F1F1F] mb-1 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-[#5F0080]" />
        개인정보 선택 동의
      </h3>
      <p className="text-[12px] text-[#6F6F6F] mb-4">
        동의하지 않아도 클래스와 리포트를 이용할 수 있어요. <PrivacyPolicyLink>개인정보 처리방침</PrivacyPolicyLink>
      </p>
      {loadFailed ? (
        <div className="text-sm text-[#6F6F6F]">
          동의 내용을 불러오지 못했어요.{' '}
          <button type="button" onClick={() => void load()} className="underline font-medium">다시 시도</button>
        </div>
      ) : !state ? (
        <p className="text-sm text-[#6F6F6F]">불러오는 중...</p>
      ) : (
        <div><details className="mb-4"><summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">필수 동의 내역 확인</summary><ul className="text-sm text-[#6F6F6F]">{(['tos', 'privacy', 'sensitive'] as const).map((key) => <li key={key} className="py-2">{{tos: '이용약관', privacy: '개인정보 처리', sensitive: '민감정보 처리'}[key]} · {state[key].agreed ? '동의함' : '동의 내역 없음'}{state[key].version ? ` · 버전 ${state[key].version}` : ''}</li>)}</ul></details><ul className="space-y-4">
          {OPTIONS.map((option) => {
            const agreed = state[option.key].agreed;
            return (
              <li key={option.key} className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[14px] font-medium text-[#1F1F1F]">{option.title}</div>
                  <div className="text-[12px] text-[#6F6F6F] mt-0.5">{option.desc}</div>
                </div>
                <SettingsSwitch checked={agreed} label={option.title} disabled={saving !== null} onChange={() => void toggle(option.key)} />
              </li>
            );
          })}
        </ul></div>
      )}
      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
