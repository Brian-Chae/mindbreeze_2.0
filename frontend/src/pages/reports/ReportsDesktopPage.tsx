// SDD-253 — 데스크톱 리포트 페이지: 계층 목록(A안) + 목록 옆 분할 검토.
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import AppShell from '../../components/layout/AppShell';
import ReportHierarchyList from '../../components/reports/ReportHierarchyList';
import ReportReviewPane from '../../components/reports/ReportReviewPane';
import { SettingsSwitch } from '../../components/settings/settings-switch';
import { ReportSampleModal } from './ReportSamplePage';
import { getAutoApprove, setAutoApprove } from '../../lib/api/reports';
import { useAuthStore } from '../../stores/authStore';

export default function ReportsDesktopPage() {
  const role = useAuthStore((s) => s.user?.role);
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [sampleOpen, setSampleOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [autoApprove, setAutoApproveState] = useState(false);
  const [autoLoaded, setAutoLoaded] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // 알림 딥링크(?report=ID) → 분할 검토로 연다.
  useEffect(() => {
    const id = searchParams.get('report');
    if (!id) return;
    setSelectedId(id);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('report');
      return next;
    }, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (role !== 'counselor') return;
    getAutoApprove()
      .then((r) => setAutoApproveState(r.enabled))
      .catch((e) => setNotice(e instanceof Error ? e.message : '자동 승인 설정 조회 실패'))
      .finally(() => setAutoLoaded(true));
  }, [role]);

  const toggleAuto = useCallback(async () => {
    if (autoSaving || !autoLoaded) return;
    const prev = autoApprove;
    setAutoApproveState(!prev);
    setAutoSaving(true);
    setNotice(null);
    try {
      setAutoApproveState((await setAutoApprove(!prev)).enabled);
    } catch (e) {
      setAutoApproveState(prev);
      setNotice(e instanceof Error ? e.message : '자동 승인 설정 변경 실패');
    } finally {
      setAutoSaving(false);
    }
  }, [autoApprove, autoLoaded, autoSaving]);

  // 운영 설정·샘플·자동 승인은 보조 메뉴로 낮춘다(기존 정책은 그대로 유지).
  const menu = (
    <div className="relative">
      <button type="button" onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen} aria-haspopup="true" className="h-11 whitespace-nowrap rounded-[10px] border border-[#DED8E3] bg-white px-4 text-[14px] font-semibold text-[#5F0080] hover:bg-[#F5EDFC]">더 보기</button>
      {menuOpen && (
        <div role="menu" className="absolute right-0 z-20 mt-2 w-[280px] space-y-1 rounded-xl border border-[#E5E0E7] bg-white p-2 shadow-lg">
          {role === 'counselor' && (
            <div className="flex min-h-11 items-center justify-between gap-3 px-3">
              <span className="text-[14px] font-semibold text-[#3A2F42]">{autoApprove ? '자동 승인 켜짐' : '수동 승인'}</span>
              <SettingsSwitch checked={autoApprove} label="자동 승인" disabled={!autoLoaded || autoSaving} onChange={() => void toggleAuto()} />
            </div>
          )}
          <button type="button" role="menuitem" onClick={() => { setSampleOpen(true); setMenuOpen(false); }} className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-[14px] font-semibold text-[#5F0080] hover:bg-[#F5EDFC]">샘플 리포트 보기</button>
        </div>
      )}
    </div>
  );

  return (
    <AppShell title="리포트" wide>
      {notice && <div role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{notice}</div>}
      <div className={selectedId ? 'grid grid-cols-[320px_minmax(0,1fr)] items-start gap-6' : ''}>
        <ReportHierarchyList
          selectedReportId={selectedId}
          onOpen={setSelectedId}
          compact={!!selectedId}
          reloadKey={reloadKey}
          toolbarExtra={selectedId ? undefined : menu}
        />
        {selectedId && (
          <ReportReviewPane
            reportId={selectedId}
            onClose={() => setSelectedId(null)}
            onReportChange={() => setReloadKey((k) => k + 1)}
          />
        )}
      </div>
      {sampleOpen && <ReportSampleModal onClose={() => setSampleOpen(false)} />}
    </AppShell>
  );
}
