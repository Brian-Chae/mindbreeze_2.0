// 상담사 자격 증명 대시보드

import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useRequireAuth, useRequireRole } from '../../hooks/useAuth';
import {
  uploadCredential,
  listCredentials,
  deleteCredential,
  type CredentialItem,
  type CredentialListResponse,
  type CredentialType,
  type VerifiedTier,
} from '../../lib/api/credentials';

const TYPE_LABELS: Record<CredentialType, string> = {
  id_card: '신분증',
  license: '자격증',
  diploma: '학위증명서',
  career: '경력증명서',
};

const TIER_META: Record<VerifiedTier, { label: string; cls: string }> = {
  unverified: { label: '미인증', cls: 'bg-gray-200 text-gray-700' },
  email: { label: '이메일 인증', cls: 'bg-blue-100 text-blue-700' },
  verified: { label: '인증 완료', cls: 'bg-green-100 text-green-700' },
};

const STATUS_META: Record<CredentialItem['status'], { label: string; cls: string }> = {
  pending: { label: '검토 중', cls: 'bg-yellow-100 text-yellow-800' },
  approved: { label: '승인', cls: 'bg-green-100 text-green-700' },
  rejected: { label: '반려', cls: 'bg-red-100 text-red-700' },
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export default function CredentialDashboardPage() {
  useRequireAuth();
  useRequireRole('counselor');

  const [data, setData] = useState<CredentialListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [type, setType] = useState<CredentialType>('id_card');
  const [expiresAt, setExpiresAt] = useState<string>('');
  const [uploading, setUploading] = useState(false);

  const fetchList = async (): Promise<void> => {
    try {
      const res = await listCredentials();
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : '목록을 불러오지 못했습니다');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchList();
  }, []);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>): void => {
    setError(null);
    setSuccess(null);
    const f = e.target.files?.[0] ?? null;
    if (f && f.size > MAX_FILE_SIZE) {
      setError('파일 크기는 10MB를 초과할 수 없습니다');
      setFile(null);
      e.target.value = '';
      return;
    }
    setFile(f);
  };

  const handleUpload = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!file) {
      setError('업로드할 파일을 선택해주세요');
      return;
    }
    setUploading(true);
    try {
      await uploadCredential(file, type, expiresAt || undefined);
      setSuccess('증빙이 업로드되었습니다. 검토 후 인증 상태가 갱신됩니다.');
      setFile(null);
      setExpiresAt('');
      const formEl = e.target as HTMLFormElement;
      formEl.reset();
      await fetchList();
    } catch (err) {
      setError(err instanceof Error ? err.message : '업로드에 실패했습니다');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string): Promise<void> => {
    if (!window.confirm('이 증빙을 삭제하시겠습니까?')) return;
    setError(null);
    setSuccess(null);
    try {
      await deleteCredential(id);
      setSuccess('증빙이 삭제되었습니다');
      await fetchList();
    } catch (err) {
      setError(err instanceof Error ? err.message : '삭제에 실패했습니다');
    }
  };

  const tier = data?.verified_tier ?? 'unverified';
  const tierMeta = TIER_META[tier];

  return (
    <div className="min-h-screen bg-surface-canvas p-4 sm:p-8">
      <div className="mx-auto w-full max-w-[800px] space-y-6">
        <div className="flex items-center justify-between">
          <Link to="/" className="inline-block">
            <h1 className="font-display text-2xl font-light text-ink-primary tracking-tight">
              Mind Breeze
            </h1>
          </Link>
          <p className="text-sm text-ink-tertiary">자격 증명 관리</p>
        </div>

        {/* 인증 등급 카드 */}
        <div className="bg-surface-raised rounded-2xl border border-border-default p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-ink-primary">인증 등급</h2>
            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${tierMeta.cls}`}>
              {tierMeta.label}
            </span>
          </div>
          <p className="text-sm text-ink-secondary">
            모든 필수 서류가 승인되면 인증 등급이 자동으로 상승합니다.
          </p>
        </div>

        {/* 부족한 증빙 안내 */}
        {data && data.missing.length > 0 && (
          <div className="rounded-2xl border border-yellow-300 bg-yellow-50 p-6 space-y-3">
            <h3 className="text-base font-semibold text-yellow-900">
              다음 서류를 업로드해주세요
            </h3>
            <div className="flex flex-wrap gap-2">
              {data.missing.map((m) => (
                <span
                  key={m}
                  className="px-3 py-1 rounded-full bg-white border border-yellow-300 text-sm text-yellow-900"
                >
                  {TYPE_LABELS[m] ?? m}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 업로드 폼 */}
        <form
          onSubmit={handleUpload}
          className="bg-surface-raised rounded-2xl border border-border-default p-6 space-y-4"
        >
          <h2 className="text-lg font-bold text-ink-primary">증빙 업로드</h2>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-ink-secondary">파일 선택</label>
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={handleFileChange}
              className="w-full rounded-lg border border-border-default bg-surface-raised px-4 py-3 text-sm text-ink-primary file:mr-3 file:rounded file:border-0 file:bg-brand-deep file:px-3 file:py-1 file:text-white"
            />
            <p className="text-xs text-ink-tertiary">PDF, JPG, PNG · 최대 10MB</p>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-ink-secondary">증빙 유형</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as CredentialType)}
              className="w-full rounded-lg border border-border-default bg-surface-raised px-4 py-3 text-sm text-ink-primary"
            >
              <option value="id_card">신분증</option>
              <option value="license">자격증</option>
              <option value="diploma">학위증명서</option>
              <option value="career">경력증명서</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-ink-secondary">
              만료일 (선택)
            </label>
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="w-full rounded-lg border border-border-default bg-surface-raised px-4 py-3 text-sm text-ink-primary"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
              {error}
            </p>
          )}
          {success && (
            <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-3">
              {success}
            </p>
          )}

          <button
            type="submit"
            disabled={uploading || !file}
            className="w-full h-11 rounded-pill bg-brand-deep text-white font-semibold hover:opacity-90 disabled:opacity-50"
          >
            {uploading ? '업로드 중...' : '업로드'}
          </button>
        </form>

        {/* 증빙 목록 */}
        <div className="bg-surface-raised rounded-2xl border border-border-default p-6 space-y-4">
          <h2 className="text-lg font-bold text-ink-primary">업로드한 증빙</h2>

          {loading && (
            <p className="text-sm text-ink-tertiary text-center py-6">불러오는 중...</p>
          )}

          {!loading && data && data.credentials.length === 0 && (
            <p className="text-sm text-ink-tertiary text-center py-6">
              아직 업로드한 증빙이 없습니다
            </p>
          )}

          {!loading && data && data.credentials.length > 0 && (
            <div className="space-y-3">
              {data.credentials.map((c) => {
                const status = STATUS_META[c.status];
                return (
                  <div
                    key={c.id}
                    className="rounded-lg border border-border-default bg-surface-raised p-4 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="text-sm font-semibold text-ink-primary truncate">
                          {c.file_name}
                        </p>
                        <p className="text-xs text-ink-secondary">
                          {TYPE_LABELS[c.type] ?? c.type}
                          {c.expires_at && ` · 만료일 ${c.expires_at}`}
                        </p>
                      </div>
                      <span className={`px-2 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${status.cls}`}>
                        {status.label}
                      </span>
                    </div>
                    {c.status === 'pending' && (
                      <button
                        type="button"
                        onClick={() => void handleDelete(c.id)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        삭제
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
