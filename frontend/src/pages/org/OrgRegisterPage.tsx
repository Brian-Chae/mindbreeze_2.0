// 상담센터 등록 페이지

import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { ApiError } from '../../lib/api/client';
import { registerOrg } from '../../lib/api/org';

export default function OrgRegisterPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isInitialized = useAuthStore((s) => s.isInitialized);

  const [name, setName] = useState('');
  const [ceoName, setCeoName] = useState('');
  const [bizNumber, setBizNumber] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isInitialized) return;
    if (!isAuthenticated) navigate('/login');
  }, [isInitialized, isAuthenticated, navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const org = await registerOrg({
        name: name.trim(),
        ceo_name: ceoName.trim(),
        biz_number: bizNumber.trim(),
        address: address.trim(),
        phone: phone.trim(),
      });
      navigate(`/org/${org.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '센터 등록에 실패했습니다');
    } finally {
      setLoading(false);
    }
  };

  if (!isInitialized) return null;

  if (user?.role !== 'counselor') {
    return (
      <div className="min-h-screen bg-surface-canvas p-8">
        <div className="max-w-2xl mx-auto rounded-xl border border-border-default bg-surface-raised p-6 text-sm text-ink-secondary">
          상담사 계정으로만 상담센터를 등록할 수 있습니다.
        </div>
      </div>
    );
  }

  const Field = ({
    label,
    value,
    onChange,
    placeholder,
    hint,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    hint?: string;
  }) => (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-ink-secondary">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={loading}
        className="w-full h-11 px-4 rounded-xl bg-surface-raised border border-border-default text-sm text-ink-primary outline-none focus:border-brand-primary disabled:opacity-50"
      />
      {hint && <p className="text-xs text-ink-tertiary">{hint}</p>}
    </div>
  );

  return (
    <div className="min-h-screen bg-surface-canvas p-4 sm:p-8">
      <div className="max-w-2xl mx-auto space-y-8">
        <div>
          <h1 className="font-display text-3xl font-light text-ink-primary">새 상담센터 등록</h1>
          <p className="text-sm text-ink-secondary mt-1">
            사업자등록번호 진위 확인 후 인증 배지가 부여됩니다
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <Field label="센터명" value={name} onChange={setName} placeholder="예: 마음숲 심리상담센터" />
          <Field label="대표자명" value={ceoName} onChange={setCeoName} placeholder="홍길동" />
          <Field
            label="사업자등록번호"
            value={bizNumber}
            onChange={setBizNumber}
            placeholder="XXX-XX-XXXXX"
            hint="형식: 3-2-5자리 (예: 123-45-67890)"
          />
          <Field label="주소" value={address} onChange={setAddress} placeholder="서울특별시 강남구 ..." />
          <Field label="전화번호" value={phone} onChange={setPhone} placeholder="02-1234-5678" />

          {error && <p className="text-red-500 text-sm" role="alert">{error}</p>}

          <button
            type="submit"
            disabled={loading || !name || !ceoName || !bizNumber || !address || !phone}
            className="w-full sm:w-auto sm:px-6 h-11 rounded-pill bg-brand-primary text-ink-on-brand font-medium text-sm disabled:bg-surface-sunken disabled:text-ink-disabled"
          >
            {loading ? '등록 중...' : '센터 등록'}
          </button>
        </form>
      </div>
    </div>
  );
}
