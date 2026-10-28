// 가입 정보 확인 공통 폼 — 생년월일(숫자 입력) + 약관 동의(필수 3·선택 2). 소셜·초대·이메일 가입이 같은 폼을 쓴다.

import { BirthDateInput } from './BirthDateInput';
import { ConsentCheckList } from './ConsentCheckList';
import type { SignupInfoValue } from '../../lib/auth/signup-info';

interface SignupInfoFormProps {
  value: SignupInfoValue;
  onChange: (value: SignupInfoValue) => void;
  disabled?: boolean;
  birthError?: string | null;
}

export function SignupInfoForm({ value, onChange, disabled, birthError }: SignupInfoFormProps) {
  return (
    <div className="flex flex-col gap-5 text-left text-[#1F1F1F]">
      <BirthDateInput
        id="signup-birth-date"
        value={value.birthDate}
        onChange={(birthDate) => onChange({ ...value, birthDate })}
        disabled={disabled}
        externalError={birthError}
        labelClassName="text-sm font-semibold"
      />
      <p className="-mt-3 text-xs text-[#6F6F6F]">YYYY.MM.DD · 만 14세 이상만 가입할 수 있어요.</p>
      <ConsentCheckList consents={value.consents} onChange={(consents) => onChange({ ...value, consents })} />
    </div>
  );
}
