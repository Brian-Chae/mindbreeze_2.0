// 내담자 초대 모달

import { useState, type FormEvent } from 'react';
import { createInvite, type InviteCreateResponse } from '../../lib/api/clients';
import { ApiError } from '../../lib/api/client';

interface InviteModalProps {
  open: boolean;
  onClose: () => void;
}

export default function InviteModal({ open, onClose }: InviteModalProps) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InviteCreateResponse | null>(null);

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await createInvite(email.trim());
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '초대 생성에 실패했습니다');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setEmail('');
    setError(null);
    setResult(null);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
    >
      {/* backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* modal */}
      <div className="relative bg-white rounded-2xl shadow-xl border border-[#EFEFEF] w-full max-w-md mx-4 p-6">
        {/* 닫기 버튼 */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-[#9CA0AE] hover:bg-[#F2F4F7] hover:text-[#1F1F1F] transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>

        {/* 헤더 */}
        <div className="mb-6">
          <h2 className="text-[17px] font-bold text-[#1F1F1F] flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#5F0080]" />
            내담자 초대
          </h2>
          <p className="text-[13px] text-[#6F6F6F] mt-1.5 ml-3.5">
            초대할 내담자의 이메일을 입력하면 초대 메일이 발송됩니다.
          </p>
        </div>

        {/* 완료 상태 */}
        {result ? (
          <div className="space-y-4">
            <div className="p-4 bg-[#F0FDF4] border border-[#BBF7D0] rounded-xl">
              <p className="text-[14px] font-medium text-[#166534] flex items-center gap-2">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <circle cx="9" cy="9" r="8" stroke="#166534" strokeWidth="1.5" />
                  <path d="M5.5 9.5L8 12L12.5 6" stroke="#166534" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {result.message}
              </p>
            </div>

            {/* 초대 링크 */}
            <div className="p-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl">
              <p className="text-[11px] text-[#6F6F6F] font-mono uppercase tracking-wider mb-2">초대 링크</p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={`http://dev.mindbreeze.looxidlabs.com${result.invite_url}`}
                  className="flex-1 px-3 py-2 bg-white border border-[#DDDEE7] rounded-lg text-[13px] text-[#1F1F1F] outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    const text = `https://dev.mindbreeze.looxidlabs.com${result.invite_url}`;
                    if (navigator.clipboard) {
                      navigator.clipboard.writeText(text);
                    } else {
                      const ta = document.createElement('textarea');
                      ta.value = text;
                      ta.style.position = 'fixed';
                      ta.style.opacity = '0';
                      document.body.appendChild(ta);
                      ta.select();
                      document.execCommand('copy');
                      document.body.removeChild(ta);
                    }
                  }}
                  className="shrink-0 px-4 py-2 text-[13px] font-medium text-[#5F0080] bg-[#F5EDFC] hover:bg-[#E8D5F8] rounded-full transition-colors"
                >
                  복사
                </button>
              </div>
            </div>

            <button
              onClick={handleClose}
              className="w-full py-2.5 text-[14px] font-medium text-[#6F6F6F] hover:text-[#1F1F1F] rounded-xl hover:bg-[#F2F4F7] transition-colors"
            >
              닫기
            </button>
          </div>
        ) : (
          /* 입력 폼 */
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider mb-2">
                이메일
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="client@example.com"
                className="w-full h-11 px-4 rounded-xl border border-[#DDDEE7] bg-white text-[14px] text-[#1F1F1F] placeholder:text-[#9CA0AE] outline-none focus:border-[#5F0080] focus:ring-2 focus:ring-purple-900/15 transition"
              />
            </div>

            {error && (
              <p className="text-[13px] text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="w-full h-11 rounded-xl bg-[#5F0080] text-white text-[14px] font-semibold hover:bg-[#4A0066] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? '발송 중...' : '초대 메일 보내기'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
