// dev 전용 역할 시뮬레이션 로그인 패널 (LoginPage 하단)

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { User } from '../../lib/api/auth';
import {
  createDevUser,
  listDevUsers,
  type DevUserItem,
  type DevUserRole,
} from '../../lib/api/devAuth';
import { ApiError } from '../../lib/api/client';
import { useAuthStore } from '../../stores/authStore';

interface DevRoleSimulationPanelProps {
  onLoginSuccess: (user: User) => void;
}

/** 역할별 퀵 시드 기본값 */
const QUICK_SEED_PRESETS: Record<
  DevUserRole,
  { label: string; name: string; email: string }
> = {
  platform_admin: {
    label: 'Platform Admin',
    name: 'Platform Admin',
    email: 'platform.admin@dev.local',
  },
  org_admin: {
    label: 'Org Admin',
    name: 'Org Admin',
    email: 'org.admin@dev.local',
  },
  counselor: {
    label: 'Counselor',
    name: 'Counselor',
    email: 'counselor@dev.local',
  },
  client: {
    label: 'Client',
    name: 'Client',
    email: 'client@dev.local',
  },
};

const ROLE_OPTIONS: Array<{ value: DevUserRole; label: string }> = [
  { value: 'platform_admin', label: 'Platform Admin' },
  { value: 'org_admin', label: 'Org Admin' },
  { value: 'counselor', label: 'Counselor' },
  { value: 'client', label: 'Client' },
];

function roleBadgeClass(role: DevUserRole): string {
  switch (role) {
    case 'platform_admin':
      return 'bg-fuchsia-500/15 text-fuchsia-300';
    case 'org_admin':
      return 'bg-sky-500/15 text-sky-300';
    case 'counselor':
      return 'bg-violet-500/15 text-violet-300';
    case 'client':
      return 'bg-emerald-500/15 text-emerald-300';
    default:
      return 'bg-slate-500/15 text-slate-300';
  }
}

function statusDotClass(status: string): string {
  switch (status) {
    case 'active':
      return 'bg-emerald-400';
    case 'locked':
      return 'bg-red-400';
    default:
      return 'bg-slate-500';
  }
}

function formatApiError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 403 || err.status === 404) {
      return '시뮬레이션 API가 비활성화되어 있습니다.';
    }
    return err.message || '요청에 실패했습니다.';
  }
  return '네트워크 오류가 발생했습니다.';
}

export default function DevRoleSimulationPanel({ onLoginSuccess }: DevRoleSimulationPanelProps) {
  const devLogin = useAuthStore((s) => s.devLogin);

  const [users, setUsers] = useState<DevUserItem[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [simLoadingUserId, setSimLoadingUserId] = useState<string | null>(null);
  const [quickSeedRole, setQuickSeedRole] = useState<DevUserRole | null>(null);

  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formRole, setFormRole] = useState<DevUserRole>('counselor');
  const [loginAfterCreate, setLoginAfterCreate] = useState(true);
  const [formSubmitting, setFormSubmitting] = useState(false);

  const clearSuccessLater = useCallback((message: string) => {
    setSuccessMessage(message);
    window.setTimeout(() => setSuccessMessage(null), 2000);
  }, []);

  const fetchUsers = useCallback(async () => {
    setListLoading(true);
    setPanelError(null);
    try {
      const res = await listDevUsers();
      setUsers(res.users);
    } catch (err) {
      setPanelError(formatApiError(err));
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  const performLogin = useCallback(
    async (userId: string) => {
      setPanelError(null);
      setSimLoadingUserId(userId);
      try {
        const user = await devLogin(userId);
        onLoginSuccess(user);
      } catch (err) {
        setPanelError(formatApiError(err));
      } finally {
        setSimLoadingUserId(null);
      }
    },
    [devLogin, onLoginSuccess],
  );

  const handleQuickSeed = async (role: DevUserRole) => {
    setPanelError(null);
    setQuickSeedRole(role);
    const preset = QUICK_SEED_PRESETS[role];

    try {
      let target = users.find((u) => u.role === role);
      if (!target) {
        const res = await listDevUsers({ role });
        target = res.users[0];
      }
      if (!target) {
        target = await createDevUser({
          name: preset.name,
          email: preset.email,
          role,
        });
        setUsers((prev) => [target!, ...prev.filter((u) => u.id !== target!.id)]);
        clearSuccessLater(`생성됨 · ${role}`);
      }
      await performLogin(target.id);
    } catch (err) {
      setPanelError(formatApiError(err));
    } finally {
      setQuickSeedRole(null);
    }
  };

  const handleCreateSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !formEmail.trim()) return;

    setPanelError(null);
    setFormSubmitting(true);
    try {
      const created = await createDevUser({
        name: formName.trim(),
        email: formEmail.trim(),
        role: formRole,
      });
      setUsers((prev) => [created, ...prev]);
      clearSuccessLater(`생성됨 · ${formRole}`);
      setFormName('');
      setFormEmail('');

      if (loginAfterCreate) {
        await performLogin(created.id);
      }
    } catch (err) {
      setPanelError(formatApiError(err));
    } finally {
      setFormSubmitting(false);
    }
  };

  const suggestDevEmail = () => {
    const slug = formRole.replace('_', '.');
    setFormEmail(`${slug}.${Date.now()}@dev.local`);
  };

  return (
    <div className="mt-10 w-full max-w-[480px]">
      <div className="mb-3 border-t border-dashed border-white/15" />

      <section
        aria-label="역할 시뮬레이션"
        className="rounded-2xl border border-cyan-400/20 bg-slate-950/85 p-4 text-slate-100 shadow-[0_0_0_1px_rgba(34,211,238,0.08)] backdrop-blur-md"
      >
        {/* 헤더 */}
        <div className="mb-4 flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded border border-amber-400/30 bg-amber-400/15 px-1.5 py-0.5 font-mono text-[10px] tracking-widest text-amber-300">
              DEV
            </span>
            <h2 className="text-sm font-semibold text-slate-100">역할 시뮬레이션</h2>
          </div>
          <p className="text-xs text-slate-400">
            비밀번호 없이 로그인 · prod 빌드에는 포함되지 않음
          </p>
        </div>

        {/* 패널 내부 알림 */}
        {panelError && (
          <p
            className="mb-3 rounded-lg border border-red-400/30 bg-red-950/60 px-3 py-2 text-xs text-red-300"
            role="alert"
          >
            {panelError}
          </p>
        )}
        {successMessage && (
          <p className="mb-3 rounded-lg border border-cyan-400/20 bg-cyan-950/40 px-3 py-2 text-xs text-cyan-200">
            {successMessage}
          </p>
        )}

        {/* 퀵 시드 4역할 */}
        <div className="mb-4">
          <p className="mb-2 text-xs font-medium text-slate-400">빠른 역할 시드</p>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(QUICK_SEED_PRESETS) as DevUserRole[]).map((role) => {
              const preset = QUICK_SEED_PRESETS[role];
              const isLoading = quickSeedRole === role || simLoadingUserId !== null;
              return (
                <button
                  key={role}
                  type="button"
                  disabled={isLoading}
                  onClick={() => void handleQuickSeed(role)}
                  className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-left text-xs font-medium text-slate-100 transition-colors hover:border-cyan-400/40 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {quickSeedRole === role ? '처리 중…' : preset.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 사용자 추가 폼 */}
        <form onSubmit={(e) => void handleCreateSubmit(e)} className="mb-4 space-y-2">
          <p className="text-xs font-medium text-slate-400">사용자 추가</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="이름"
              disabled={formSubmitting}
              className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400/50 focus:outline-none focus:ring-1 focus:ring-cyan-400/30 disabled:opacity-50"
            />
            <div className="flex gap-2">
              <input
                type="email"
                value={formEmail}
                onChange={(e) => setFormEmail(e.target.value)}
                placeholder="이메일"
                disabled={formSubmitting}
                className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400/50 focus:outline-none focus:ring-1 focus:ring-cyan-400/30 disabled:opacity-50"
              />
              <button
                type="button"
                onClick={suggestDevEmail}
                disabled={formSubmitting}
                className="shrink-0 rounded-lg border border-slate-700 px-2 py-2 text-[10px] text-slate-400 hover:border-cyan-400/40 hover:text-cyan-300 disabled:opacity-50"
                title="@dev.local 이메일 자동 제안"
              >
                @dev
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={formRole}
              onChange={(e) => setFormRole(e.target.value as DevUserRole)}
              disabled={formSubmitting}
              className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 focus:border-cyan-400/50 focus:outline-none focus:ring-1 focus:ring-cyan-400/30 disabled:opacity-50"
            >
              {ROLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={loginAfterCreate}
                onChange={(e) => setLoginAfterCreate(e.target.checked)}
                disabled={formSubmitting}
                className="rounded border-slate-600 bg-slate-900 text-cyan-400 focus:ring-cyan-400/30"
              />
              추가 후 바로 로그인
            </label>
            <button
              type="submit"
              disabled={formSubmitting || !formName.trim() || !formEmail.trim()}
              className="ml-auto rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-xs font-semibold text-cyan-200 transition-colors hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {formSubmitting ? '추가 중…' : '추가'}
            </button>
          </div>
        </form>

        {/* 사용자 리스트 */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium text-slate-400">시뮬레이션 사용자</p>
            <button
              type="button"
              onClick={() => void fetchUsers()}
              disabled={listLoading}
              className="text-[11px] text-cyan-400/80 hover:text-cyan-300 disabled:opacity-50"
            >
              목록 새로고침
            </button>
          </div>

          {listLoading ? (
            <p className="py-4 text-center text-xs text-slate-500">목록 불러오는 중…</p>
          ) : users.length === 0 ? (
            <p className="py-4 text-center text-xs text-slate-500">
              등록된 시뮬레이션 사용자가 없습니다. 위 퀵 시드로 시작하세요.
            </p>
          ) : (
            <ul role="listbox" aria-label="시뮬레이션 사용자 목록" className="max-h-64 space-y-1 overflow-y-auto">
              {users.map((user) => {
                const isRowLoading = simLoadingUserId === user.id;
                return (
                  <li key={user.id}>
                    <button
                      type="button"
                      role="option"
                      aria-label={`${user.name} (${user.role})로 시뮬레이션 로그인`}
                      disabled={simLoadingUserId !== null}
                      onClick={() => void performLogin(user.id)}
                      className="flex w-full items-start gap-3 rounded-lg border border-transparent px-3 py-2 text-left transition-colors hover:border-cyan-400/20 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-sm ${statusDotClass(user.status)}`}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-slate-100">{user.name}</span>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${roleBadgeClass(user.role)}`}
                          >
                            {user.role}
                          </span>
                          {user.email.endsWith('@dev.local') && (
                            <span className="rounded border border-amber-400/20 bg-amber-400/10 px-1 py-0.5 font-mono text-[9px] text-amber-300">
                              SIM
                            </span>
                          )}
                        </span>
                        <span className="block truncate font-mono text-[11px] text-slate-500">
                          {user.email}
                        </span>
                        <span className="mt-0.5 block text-[10px] text-slate-500">
                          {user.status}
                          {user.org_name ? ` · ${user.org_name}` : ''}
                          {' · '}
                          {user.onboarding_completed ? 'onboarded' : 'needs onboarding'}
                        </span>
                      </span>
                      {isRowLoading && (
                        <span className="shrink-0 text-[11px] text-cyan-300">로그인 중…</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
