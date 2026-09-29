// 약관 동의 체크리스트 (3종 모두 필수)

export interface Consents {
  tos: boolean;
  privacy: boolean;
  sensitive: boolean;
}

interface ConsentCheckListProps {
  consents: Consents;
  onChange: (consents: Consents) => void;
}

interface ConsentItem {
  key: keyof Consents;
  label: string;
}

const ITEMS: ConsentItem[] = [
  { key: 'tos', label: '서비스 이용약관 동의' },
  { key: 'privacy', label: '개인정보 처리방침 동의' },
  { key: 'sensitive', label: '민감정보(뇌파·상담내용) 수집·이용 동의' },
];

export function ConsentCheckList({ consents, onChange }: ConsentCheckListProps) {
  const allChecked = ITEMS.every((it) => consents[it.key]);

  const toggleAll = (): void => {
    const next = !allChecked;
    onChange({ tos: next, privacy: next, sensitive: next });
  };

  const toggleOne = (key: keyof Consents): void => {
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
        <span className="font-semibold text-[var(--mb-fg)]">전체 동의 (모두 필수)</span>
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
          </li>
        ))}
      </ul>
    </div>
  );
}
