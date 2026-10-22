import { useEffect, useRef, useState } from 'react';
import { classReportsApi, type SessionSummary } from '../../../lib/api/class-reports';
import { operationError } from './class-operation-state';

/** SDD-218 R5: 회차 출석 요약과 익명 방향 분포.
 *
 * 개인별 수치·순위·타인 대비·강사 비교를 만들지 않는다.
 * 유효 착용이 기준 인원 미만이면 분포를 숨기고 사유를 알린다.
 */

const METRIC_LABEL: Record<string, string> = {
  relaxation: '이완',
  concentration: '집중',
  stress: '긴장',
};

const DIRECTION_LABEL = {
  eased: '더 편안해짐',
  steady: '비슷함',
  tensed: '더 긴장함',
} as const;

const DIRECTION_FILL = {
  eased: 'bg-[#2E9D85]',
  steady: 'bg-[#D8D0E0]',
  tensed: 'bg-[#C46A4A]',
} as const;

function Tally({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="w-20 rounded-xl border border-[#ECE6F0] bg-white py-2 text-center">
      <span className="block text-xs mobile:text-mb-caption font-semibold text-[#9B9B9B]">{label}</span>
      <span className={`mt-1 block text-sm font-bold ${tone}`}>{value}명</span>
    </div>
  );
}

function DirectionBar({
  counts,
}: {
  counts: { eased: number; steady: number; tensed: number };
}) {
  const total = counts.eased + counts.steady + counts.tensed;
  if (total === 0) return null;
  const order = ['eased', 'steady', 'tensed'] as const;
  return (
    <div className="space-y-2">
      <div className="flex h-3 overflow-hidden rounded-full bg-[#F0ECF3]">
        {order.map((key) =>
          counts[key] > 0 ? (
            <span
              key={key}
              className={`block h-full ${DIRECTION_FILL[key]}`}
              style={{ width: `${(counts[key] / total) * 100}%` }}
            />
          ) : null,
        )}
      </div>
      <ul className="flex flex-wrap gap-4 text-xs mobile:text-mb-caption text-[#6F6F6F]">
        {order.map((key) => (
          <li key={key} className="inline-flex items-center gap-1.5">
            <span className={`inline-block h-2.5 w-2.5 rounded-sm ${DIRECTION_FILL[key]}`} aria-hidden />
            {DIRECTION_LABEL[key]} {counts[key]}명
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ClassSessionSummary({
  classId,
  sessionId,
  title,
}: {
  classId: string;
  sessionId: string;
  title?: string;
}) {
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);

  useEffect(() => {
    const version = ++generation.current;
    setLoading(true);
    setError('');
    void classReportsApi
      .sessionSummary(classId, sessionId)
      .then((value) => {
        if (version === generation.current) setSummary(value);
      })
      .catch((e) => {
        if (version === generation.current) setError(operationError(e));
      })
      .finally(() => {
        if (version === generation.current) setLoading(false);
      });
    return () => {
      generation.current += 1;
    };
  }, [classId, sessionId]);

  if (loading) return <p role="status">회차 요약을 불러오는 중이에요.</p>;
  if (error)
    return (
      <p role="alert" className="text-sm text-[#8A3A1F]">
        {error}
      </p>
    );
  if (!summary) return null;

  return (
    <section className="space-y-4 rounded-2xl border border-[#ECE6F0] bg-white p-6">
      <b className="text-sm">{title ?? '회차 요약'} — 출석</b>

      <div className="flex flex-wrap gap-2">
        <Tally label="출석" value={summary.attendance.attended} tone="text-[#0B6B55]" />
        <Tally label="결석" value={summary.attendance.absent} tone="text-[#8A3A1F]" />
        {summary.makeup_linked > 0 && (
          <Tally label="보강 연결" value={summary.makeup_linked} tone="text-[#5F0080]" />
        )}
      </div>

      <div className="space-y-3">
        <b className="block text-sm">
          전반 → 후반 변화 방향 (익명 · 유효 착용 {summary.valid_cohort}명)
        </b>

        {summary.distribution ? (
          Object.entries(summary.distribution).map(([metric, counts]) => (
            <div key={metric} className="space-y-1.5">
              <span className="text-sm font-semibold text-[#6F6F6F]">
                {METRIC_LABEL[metric] ?? metric}
              </span>
              <DirectionBar counts={counts} />
            </div>
          ))
        ) : (
          <div className="rounded-2xl border border-dashed border-[#ECE6F0] bg-[#F4F1F6] p-6 text-center">
            <b className="text-sm text-[#6F6F6F]">
              유효 착용 {summary.valid_cohort}명 — 분포를 표시하지 않아요
            </b>
            <p className="mt-1 text-sm text-[#9B9B9B]">
              {summary.min_cohort}명 미만이면 개인이 드러날 수 있어 분포를 숨겨요.
            </p>
          </div>
        )}
      </div>

      <p className="text-sm leading-relaxed text-[#9B9B9B]">
        개인별 값이나 순위는 제공하지 않아요. 개별 확인은 각 회원의 승인된 리포트에서 해요.
      </p>
    </section>
  );
}
