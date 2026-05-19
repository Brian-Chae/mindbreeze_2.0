import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { getClientProfile, updateMemo, type ClientProfile } from '../../lib/api/clients';
import { ApiError } from '../../lib/api/client';

export default function ClientProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, isInitialized } = useAuthStore();

  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [memo, setMemo] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (isInitialized && !isAuthenticated) {
      navigate('/login');
    }
  }, [isInitialized, isAuthenticated, navigate]);

  useEffect(() => {
    if (!id || !isAuthenticated) return;
    let cancelled = false;
    setLoading(true);
    getClientProfile(id)
      .then((p) => {
        if (cancelled) return;
        setProfile(p);
        setMemo(p.memo ?? '');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : '프로필을 불러오지 못했습니다');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, isAuthenticated]);

  const handleSaveMemo = async () => {
    if (!id) return;
    setSaving(true);
    setError(null);
    try {
      await updateMemo(id, memo);
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '메모 저장에 실패했습니다');
    } finally {
      setSaving(false);
    }
  };

  if (!isInitialized || loading) {
    return <div className="min-h-screen flex items-center justify-center bg-surface-canvas">불러오는 중...</div>;
  }

  if (error && !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-canvas">
        <p className="text-red-600">{error}</p>
      </div>
    );
  }

  if (!profile) return null;

  return (
    <div className="min-h-screen bg-surface-canvas p-6">
      <div className="max-w-3xl mx-auto">
        <button
          onClick={() => navigate('/clients')}
          className="text-sm text-gray-600 hover:text-gray-900 mb-4"
        >
          ← 목록으로
        </button>

        <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
          <div className="flex items-center gap-4 mb-6">
            {profile.profile_image_url ? (
              <img
                src={profile.profile_image_url}
                alt={profile.name}
                className="w-16 h-16 rounded-full object-cover"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 text-xl font-semibold">
                {profile.name.charAt(0)}
              </div>
            )}
            <div>
              <h1 className="text-2xl font-semibold">{profile.name}</h1>
              <p className="text-sm text-gray-500">{profile.email}</p>
            </div>
          </div>

          <dl className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-gray-500">전화번호</dt>
              <dd className="text-gray-900">{profile.phone || '—'}</dd>
            </div>
            <div>
              <dt className="text-gray-500">성별</dt>
              <dd className="text-gray-900">{profile.gender || '—'}</dd>
            </div>
            <div>
              <dt className="text-gray-500">생년월일</dt>
              <dd className="text-gray-900">{profile.birth_date || '—'}</dd>
            </div>
          </dl>

          {profile.bio && (
            <div className="mt-4">
              <dt className="text-sm text-gray-500 mb-1">소개</dt>
              <p className="text-sm text-gray-700">{profile.bio}</p>
            </div>
          )}

          {profile.concerns.length > 0 && (
            <div className="mt-4">
              <dt className="text-sm text-gray-500 mb-2">고민</dt>
              <div className="flex flex-wrap gap-1">
                {profile.concerns.map((tag) => (
                  <span key={tag} className="px-2 py-0.5 bg-emerald-50 text-emerald-700 text-xs rounded-full">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {profile.interests.length > 0 && (
            <div className="mt-4">
              <dt className="text-sm text-gray-500 mb-2">관심사</dt>
              <div className="flex flex-wrap gap-1">
                {profile.interests.map((tag) => (
                  <span key={tag} className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-full">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-2">상담사 비공개 메모</h2>
          <p className="text-xs text-gray-500 mb-3">내담자에게 공개되지 않습니다.</p>
          <textarea
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            rows={6}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
            placeholder="상담 메모를 입력하세요"
          />
          <div className="flex items-center gap-3 mt-3">
            <button
              onClick={handleSaveMemo}
              disabled={saving}
              className="px-4 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 text-sm disabled:opacity-50"
            >
              {saving ? '저장 중...' : '저장'}
            </button>
            {savedAt && <span className="text-sm text-emerald-600">저장되었습니다</span>}
            {error && <span className="text-sm text-red-600">{error}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
