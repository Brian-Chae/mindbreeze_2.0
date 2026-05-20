// AI 리포트 상세 페이지

import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import AppShell from '../../components/layout/AppShell';
import { getReport, approveReport, type ReportDto } from '../../lib/api/reports';

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function CoverSection({ report }: { report: ReportDto }) {
  const score = (report.content?.score as number) ?? null;
  const headline = (report.content?.headline as string) ?? '리포트';
  const sessionTitle = report.session_title || headline;
  const sessionType = report.session_type ?? '-';

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#5F0080] via-[#7B00A6] to-[#9B30FF] p-8 text-white">
      {/* 배경 패턴 */}
      <div className="absolute inset-0 opacity-10">
        <svg width="100%" height="100%">
          <defs>
            <pattern id="dots" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1.5" fill="white" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#dots)" />
        </svg>
      </div>

      <div className="relative z-10 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold bg-white/20">
              {report.type === 'counselor' ? '상담사용' : '내담자용'}
            </span>
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold bg-white/20">
              {sessionType}
            </span>
          </div>
          <h1 className="text-[28px] font-extrabold tracking-tight mb-2">
            {sessionTitle}
          </h1>
          <div className="text-[14px] text-white/70 font-mono">
            {formatDate(report.scheduled_at ?? report.created_at)}
          </div>
          {report.sent_at && (
            <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 text-[12px] font-bold">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              승인 완료
            </div>
          )}
        </div>

        {score !== null && (
          <div className="flex-shrink-0">
            <div className="bg-white/10 backdrop-blur rounded-2xl px-6 py-5 text-center border border-white/10">
              <div className="text-[12px] text-white/60 font-mono uppercase tracking-wider mb-1">
                종합 점수
              </div>
              <div className="text-[48px] font-extrabold leading-none">
                {score}
              </div>
              <div className="text-[13px] text-white/50 mt-1">/ 100</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-[#EFEFEF] rounded-2xl p-6">
      <h3 className="text-[15px] font-bold text-[#1F1F1F] mb-4 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-[#5F0080]" />
        {title}
      </h3>
      {children}
    </div>
  );
}

function MarkerBadge({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between py-2.5 px-4 bg-[#F5EDFC] rounded-xl">
      <span className="text-[13px] font-medium text-[#1F1F1F]">{label}</span>
      <span className="text-[14px] font-bold text-[#5F0080]">{value}</span>
    </div>
  );
}

interface EegDataPoint {
  timestamp?: string;
  min?: number;
  concentration?: number;
  relaxation?: number;
  stress?: number;
}

const CHANNEL_COLORS: Record<string, string> = {
  concentration: '#7C3AED',
  relaxation: '#10B981',
  stress: '#EF4444',
};

function EegTimelineChart({ data }: { data: EegDataPoint[] }) {
  if (!data || data.length === 0) return null;

  // 수치 채널 자동 감지
  const sample = data[0] as Record<string, unknown>;
  const channels = Object.keys(sample).filter(
    (k) => k !== 'timestamp' && k !== 'min' && typeof sample[k] === 'number',
  );

  return (
    <div className="bg-white border border-[#EFEFEF] rounded-2xl p-6">
      <h3 className="text-[15px] font-bold text-[#1F1F1F] mb-5 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-[#5F0080]" />
        뇌파 트렌드
      </h3>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#EFEFEF" />
          <XAxis
            dataKey="min"
            tick={{ fontSize: 11, fill: '#6F6F6F' }}
            axisLine={{ stroke: '#EFEFEF' }}
            tickLine={false}
            label={{ value: '분', position: 'insideBottomRight', offset: -5, fontSize: 11, fill: '#9B9B9B' }}
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#6F6F6F' }}
            axisLine={false}
            tickLine={false}
            domain={[0, 100]}
          />
          <Tooltip
            contentStyle={{
              borderRadius: 12,
              border: '1px solid #EFEFEF',
              fontSize: 12,
              fontFamily: 'inherit',
            }}
          />
          {channels.map((ch) => (
            <Line
              key={ch}
              type="monotone"
              dataKey={ch}
              stroke={CHANNEL_COLORS[ch] ?? '#5F0080'}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
              name={ch === 'concentration' ? '집중도' : ch === 'relaxation' ? '이완도' : ch === 'stress' ? '스트레스' : ch}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>

      {/* 범례 */}
      <div className="flex items-center gap-4 mt-4 justify-center">
        {channels.map((ch) => (
          <div key={ch} className="flex items-center gap-1.5 text-[12px] text-[#6F6F6F]">
            <span
              className="w-3 h-0.5 rounded-full"
              style={{ backgroundColor: CHANNEL_COLORS[ch] ?? '#5F0080' }}
            />
            {ch === 'concentration' ? '집중도' : ch === 'relaxation' ? '이완도' : ch === 'stress' ? '스트레스' : ch}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [report, setReport] = useState<ReportDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState(false);

  useEffect(() => {
    if (!id) return;
    getReport(id)
      .then((r) => setReport(r))
      .catch((e) => setError(e instanceof Error ? e.message : '리포트 조회 실패'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleApprove = useCallback(async () => {
    if (!id) return;
    setApproving(true);
    setError(null);
    try {
      await approveReport(id);
      setApproved(true);
      // 새 데이터 다시 불러오기
      const updated = await getReport(id);
      setReport(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : '승인 처리 실패');
    } finally {
      setApproving(false);
    }
  }, [id]);

  const handleGeneratePDF = useCallback(async () => {
    if (!id) return;
    alert('PDF 생성 기능은 추후 제공됩니다.');
  }, [id]);

  if (loading) {
    return (
      <AppShell title="리포트 상세" sub="AI REPORT DETAIL">
        <div className="text-[#6F6F6F]">불러오는 중...</div>
      </AppShell>
    );
  }

  if (error && !report) {
    return (
      <AppShell title="리포트 상세" sub="AI REPORT DETAIL">
        <div className="p-4 rounded-xl bg-red-50 text-red-700 text-sm mb-4">{error}</div>
        <button
          onClick={() => navigate('/reports')}
          className="mb-btn mb-btn-secondary text-[14px] px-5 py-2.5 rounded-xl"
        >
          목록으로
        </button>
      </AppShell>
    );
  }

  if (!report) return null;

  const content = report.content as Record<string, unknown>;
  const summary = (content?.summary as string) ?? null;
  const insights = (content?.insights as string[]) ?? [];
  const markers = (content?.markers as Array<{ label: string; value: string | number }>) ?? [];
  const eegSummary = (content?.eeg_summary as Record<string, unknown>) ?? null;
  const eegTimeline = (content?.eeg_timeline as EegDataPoint[]) ?? [];
  const isCounselor = report.type === 'counselor';

  return (
    <AppShell title="리포트 상세" sub="AI REPORT DETAIL">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* 에러 메시지 */}
        {error && (
          <div className="p-3 rounded-xl bg-red-50 text-red-700 text-sm">{error}</div>
        )}

        {/* 커버 섹션 */}
        <CoverSection report={report} />

        {/* AI 요약 */}
        {summary && (
          <SummaryCard title="AI 요약">
            <p className="text-[15px] text-[#1F1F1F] leading-relaxed whitespace-pre-wrap">
              {summary}
            </p>
          </SummaryCard>
        )}

        {/* 인사이트 */}
        {insights.length > 0 && (
          <SummaryCard title="인사이트 카드">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {insights.map((insight, i) => (
                <div
                  key={i}
                  className="bg-gradient-to-br from-[#F5EDFC] to-white border border-[#EFEFEF] rounded-xl p-4"
                >
                  <div className="text-[12px] text-[#6F6F6F] font-mono mb-1">
                    INSIGHT {String(i + 1).padStart(2, '0')}
                  </div>
                  <p className="text-[14px] text-[#1F1F1F] leading-relaxed">{insight}</p>
                </div>
              ))}
            </div>
          </SummaryCard>
        )}

        {/* 마커 하이라이트 */}
        {markers.length > 0 && (
          <SummaryCard title="주요 지표">
            <div className="space-y-2">
              {markers.map((m, i) => (
                <MarkerBadge key={i} label={m.label} value={m.value} />
              ))}
            </div>
          </SummaryCard>
        )}

        {/* 뇌파 요약 + 타임라인 차트 */}
        {(eegSummary || eegTimeline.length > 0) && (
          <SummaryCard title="뇌파 분석">
            {/* 요약 지표 */}
            {eegSummary && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                {Object.entries(eegSummary).map(([key, val]) => (
                  <div
                    key={key}
                    className="bg-[#F8FAFC] rounded-xl p-4 text-center border border-[#EFEFEF]"
                  >
                    <div className="text-[11px] text-[#6F6F6F] font-mono uppercase tracking-wider mb-1">
                      {key.replace(/_/g, ' ')}
                    </div>
                    <div className="text-[20px] font-bold text-[#5F0080]">
                      {typeof val === 'number' ? val.toFixed(1) : String(val)}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 타임라인 차트 */}
            <EegTimelineChart data={eegTimeline} />
          </SummaryCard>
        )}

        {/* 액션 버튼 */}
        <div className="flex items-center gap-3 pt-4 border-t border-[#EFEFEF]">
          <button
            onClick={() => navigate('/reports')}
            className="mb-btn mb-btn-secondary text-[14px] px-5 py-2.5 rounded-xl"
          >
            목록으로
          </button>

          {isCounselor && !report.sent_at && !approved && (
            <button
              onClick={handleApprove}
              disabled={approving}
              className="mb-btn mb-btn-primary text-[14px] px-6 py-2.5 rounded-xl disabled:opacity-50"
            >
              {approving ? '승인 중...' : '승인 및 발송'}
            </button>
          )}

          {report.pdf_url ? (
            <a
              href={report.pdf_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mb-btn mb-btn-secondary text-[14px] px-5 py-2.5 rounded-xl"
            >
              PDF 다운로드
            </a>
          ) : report.sent_at ? (
            <button
              onClick={handleGeneratePDF}
              className="mb-btn mb-btn-secondary text-[14px] px-5 py-2.5 rounded-xl"
            >
              PDF 생성
            </button>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}
