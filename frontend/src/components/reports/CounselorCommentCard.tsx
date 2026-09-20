// SDD-087 — 내담자에게 보내는 상담사 코멘트 카드
// pending_review + client 리포트 + 상담사 권한일 때만 노출 (노출 조건은 부모가 판단)
// textarea + AI 초안 받기(Gemini, 실패 시 서버 규칙 폴백) + 저장(null = 삭제)

import { useCallback, useEffect, useState } from 'react';
import {
  generateCommentDraft,
  updateReportComment,
  type ReportDto,
} from '../../lib/api/reports';

const COMMENT_MAX_LENGTH = 1000;

function savedCommentOf(report: ReportDto): string {
  const value = report.content?.counselor_comment;
  return typeof value === 'string' ? value : '';
}

export interface CounselorCommentCardProps {
  report: ReportDto;
  /** 저장 성공 시 갱신된 리포트 전달 */
  onReportChange: (report: ReportDto) => void;
  /** 측정 데이터 없는 세션 안내 배너 */
  showNoDataBanner: boolean;
  /** 미저장 변경 여부 — 부모의 승인 confirm에 사용 */
  onDirtyChange?: (dirty: boolean) => void;
}

export default function CounselorCommentCard({
  report,
  onReportChange,
  showNoDataBanner,
  onDirtyChange,
}: CounselorCommentCardProps) {
  const savedComment = savedCommentOf(report);
  const [text, setText] = useState(savedComment);
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastReportId, setLastReportId] = useState(report.id);

  // 다른 리포트로 전환되면 저장된 코멘트로 리셋 (렌더 중 상태 조정 패턴)
  if (lastReportId !== report.id) {
    setLastReportId(report.id);
    setText(savedComment);
    setSuccess(null);
    setError(null);
  }

  const dirty = text.trim() !== savedComment.trim();
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const handleDraft = useCallback(async () => {
    if (drafting || saving) return;
    if (text.trim() && !window.confirm('작성 중인 내용을 AI 초안으로 덮어쓸까요?')) return;
    setDrafting(true);
    setSuccess(null);
    setError(null);
    try {
      const { draft } = await generateCommentDraft(report.id);
      setText(draft.slice(0, COMMENT_MAX_LENGTH));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI 초안 생성에 실패했습니다.');
    } finally {
      setDrafting(false);
    }
  }, [drafting, saving, text, report.id]);

  const handleSave = useCallback(async () => {
    if (saving || drafting) return;
    setSaving(true);
    setSuccess(null);
    setError(null);
    try {
      const value = text.trim();
      const updated = await updateReportComment(report.id, value ? value : null);
      onReportChange(updated);
      setText(value);
      setSuccess(value ? '코멘트를 저장했습니다.' : '코멘트를 삭제했습니다.');
    } catch (e) {
      setError(e instanceof Error ? e.message : '코멘트 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }, [saving, drafting, text, report.id, onReportChange]);

  return (
    <section data-print-exclude className="rounded-2xl border border-[#E8D9F5] bg-[#FDFAFF] p-5 md:p-6">
      <h3 className="text-[15px] font-bold text-[#5F0080] flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-sm bg-[#5F0080]" />
        내담자에게 보내는 코멘트
      </h3>
      <p className="mt-1.5 text-[13px] text-[#6D547A]">
        승인·발송 시 리포트와 메일에 함께 전달됩니다. AI 초안을 받아 편집할 수도 있어요.
      </p>

      {showNoDataBanner && (
        <div
          role="note"
          className="mt-4 p-3 rounded-xl bg-[#FFF7E8] border border-[#F3E2B8] text-[#8A6A1F] text-[13px]"
        >
          이 세션에는 측정 데이터가 없습니다. 코멘트를 작성해 내담자에게 전달해 주세요.
        </div>
      )}

      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value.slice(0, COMMENT_MAX_LENGTH));
          setSuccess(null);
          setError(null);
        }}
        rows={5}
        maxLength={COMMENT_MAX_LENGTH}
        placeholder="내담자에게 전달할 메시지를 작성해 주세요"
        disabled={saving || drafting}
        aria-label="내담자에게 보내는 코멘트"
        className="mt-4 w-full px-3.5 py-3 border border-[#DDDEE7] rounded-xl bg-white text-[#1F1F1F] text-sm leading-relaxed placeholder:text-[#9B9B9B] focus:outline-none focus:ring-2 focus:ring-[#5F0080]/15 focus:border-[#5F0080] disabled:opacity-50 resize-y"
      />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <span className="text-[12px] text-[#9B9B9B]">
          {text.length}/{COMMENT_MAX_LENGTH}자
          {dirty && <span className="ml-2 text-[#B0731F]">저장되지 않은 변경이 있습니다</span>}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDraft}
            disabled={drafting || saving}
            className="border border-[#E8D9F5] bg-white text-[#5F0080] font-medium hover:bg-[#F5EDFC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5F0080] text-[13px] px-4 py-2 rounded-xl disabled:opacity-50"
          >
            {drafting ? 'AI 초안 생성 중...' : 'AI 초안 받기'}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || drafting || !dirty}
            className="bg-[#5F0080] text-white font-medium hover:bg-[#4A0066] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5F0080] text-[13px] px-5 py-2 rounded-xl disabled:opacity-50"
          >
            {saving ? '저장 중...' : '코멘트 저장'}
          </button>
        </div>
      </div>

      {success && (
        <div role="status" className="mt-3 p-3 rounded-xl bg-[#F0F9F5] text-[#26724B] text-sm border border-[#D8EFE3]">
          {success}
        </div>
      )}
      {error && (
        <div role="alert" className="mt-3 p-3 rounded-xl bg-red-50 text-red-700 text-sm">
          {error}
        </div>
      )}
    </section>
  );
}
