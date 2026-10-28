import { RESEARCH_METADATA_NOTICE } from '../../lib/privacy-policy';
// 약관 동의 체크리스트 (필수 3종 + 선택 2종: 뇌파 수집·연구 활용)

import { PrivacyPolicyLink } from '../legal/PrivacyPolicyLink';

export interface Consents {
  tos: boolean;
  privacy: boolean;
  sensitive: boolean;
  /** 선택 — LINK BAND 뇌파 수집. 거부해도 가입·밴드 없는 클래스를 이용할 수 있다. */
  eeg?: boolean;
  /** 선택 — 비식별 연구 활용. 거부해도 서비스 이용에 영향 없다. */
  research?: boolean;
}

type RequiredKey = 'tos' | 'privacy' | 'sensitive';
type OptionalKey = 'eeg' | 'research';

interface ConsentCheckListProps {
  consents: Consents;
  onChange: (consents: Consents) => void;
}

interface ConsentItem<K extends string> {
  key: K;
  label: string;
}

const OPTIONAL_ITEMS: ConsentItem<OptionalKey>[] = [
  { key: 'eeg', label: '뇌파(LINK BAND) 측정 데이터 수집·이용 동의' },
  { key: 'research', label: '비식별 연구 목적 활용 동의' },
];

const ITEMS: ConsentItem<RequiredKey>[] = [
  { key: 'tos', label: '서비스 이용약관 동의' },
  { key: 'privacy', label: '개인정보 처리방침 동의' },
  { key: 'sensitive', label: '민감정보(뇌파·상담내용) 수집·이용 동의' },
];

export function ConsentCheckList({ consents, onChange }: ConsentCheckListProps) {
  const allChecked = ITEMS.every((it) => consents[it.key]);

  // 전체 동의는 필수 항목만 일괄 토글한다. 선택 동의는 사용자가 따로 고른다(추정 금지).
  const toggleAll = (): void => {
    const next = !allChecked;
    onChange({ ...consents, tos: next, privacy: next, sensitive: next });
  };

  const toggleOne = (key: RequiredKey | OptionalKey): void => {
    onChange({ ...consents, [key]: !consents[key] });
  };

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-3 p-3 rounded-lg border border-[var(--mb-border)] bg-[var(--mb-bg)] cursor-pointer hover:bg-[var(--mb-bg-soft)]">
        <input
          type="checkbox"
          checked={allChecked}
          onChange={toggleAll}
          className="w-5 h-5 accent-[var(--mb-primary)]"
        />
        <span className="font-semibold text-[var(--mb-fg)]">필수 항목 전체 동의</span>
      </label>

      <ul className="space-y-2">
        {ITEMS.map((item) => (
          <li key={item.key}>
            <label className="flex items-center gap-3 p-3 rounded-lg cursor-pointer hover:bg-[var(--mb-bg-soft)]">
              <input
                type="checkbox"
                checked={consents[item.key]}
                onChange={() => toggleOne(item.key)}
                className="w-5 h-5 accent-[var(--mb-primary)]"
              />
              <span className="text-sm text-[var(--mb-fg)]">
                <span className="text-[var(--mb-danger)] mr-1">[필수]</span>
                {item.label}
              </span>
            </label>
            {item.key === 'tos' ? (
              <p className="pl-11 pb-1 text-xs text-[var(--mb-fg-muted,#6F6F6F)]">
                <a href="/terms" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                  이용약관 전문 보기
                </a>
              </p>
            ) : null}
            {item.key === 'privacy' || item.key === 'sensitive' ? (
              <p className="pl-11 pb-1 text-xs text-[var(--mb-fg-muted,#6F6F6F)]">
                <PrivacyPolicyLink>개인정보 처리방침 전문 보기</PrivacyPolicyLink>
              </p>
            ) : null}
          </li>
        ))}
        {OPTIONAL_ITEMS.map((item) => (
          <li key={item.key}>
            <label className="flex items-center gap-3 p-3 rounded-lg cursor-pointer hover:bg-[var(--mb-bg-soft)]">
              <input
                type="checkbox"
                checked={Boolean(consents[item.key])}
                onChange={() => toggleOne(item.key)}
                className="w-5 h-5 accent-[var(--mb-primary)]"
              />
              <span className="text-sm text-[var(--mb-fg)]">
                <span className="text-[var(--mb-fg-muted,#6F6F6F)] mr-1">[선택]</span>
                {item.label}
              </span>
            </label>
            <p className="pl-11 pb-1 text-xs text-[var(--mb-fg-muted,#6F6F6F)]">
              동의하지 않아도 가입과 클래스 이용에는 영향이 없어요. 설정에서 언제든 바꿀 수 있어요.
              {item.key === 'research' ? <span className="block">{RESEARCH_METADATA_NOTICE}</span> : null}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
