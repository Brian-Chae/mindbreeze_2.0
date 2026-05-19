import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getInviteInfo, type InviteInfoResponse } from '../../lib/api/clients';
import { ApiError } from '../../lib/api/client';

export default function InviteLandingPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [info, setInfo] = useState<InviteInfoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError('잘못된 초대 링크입니다');
      setLoading(false);
      return;
    }
    let cancelled = false;
    getInviteInfo(token)
      .then((res) => {
        if (!cancelled) setInfo(res);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : '초대 정보를 확인할 수 없습니다');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-blue-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
        {loading && <p className="text-gray-500">확인 중...</p>}

        {!loading && error && (
          <>
            <h1 className="text-xl font-semibold text-red-600 mb-3">초대 확인 실패</h1>
            <p className="text-sm text-gray-600 mb-6">{error}</p>
            <button
              onClick={() => navigate('/')}
              className="px-4 py-2 bg-gray-800 text-white rounded-md hover:bg-gray-900"
            >
              홈으로
            </button>
          </>
        )}

        {!loading && info && (
          <>
            <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-emerald-100 flex items-center justify-center">
              <span className="text-3xl">🌿</span>
            </div>
            <h1 className="text-2xl font-bold mb-2">환영합니다</h1>
            <p className="text-gray-600 mb-6">
              <span className="font-semibold text-emerald-700">{info.counselor_name}</span>
              {info.organization ? <> ({info.organization})</> : null} 상담사님이
              <br />
              MIND BREEZE에 초대했습니다.
            </p>
            <div className="bg-gray-50 rounded-md p-3 text-sm text-gray-600 mb-6">
              <p>상담사 코드</p>
              <p className="font-mono font-semibold text-gray-900">{info.counselor_code}</p>
            </div>
            <button
              onClick={() => navigate(`/register?token=${token}&type=client`)}
              className="w-full px-4 py-3 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 font-medium"
            >
              가입하기
            </button>
            <p className="text-xs text-gray-500 mt-4">
              가입 후 자동으로 상담사와 연결됩니다.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
