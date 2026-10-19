import { useEffect, useRef, useState } from 'react';
import {
  classReportsApi,
  type MeasurementState,
  type MemberTrend,
  type TrendSession,
} from '../../../lib/api/class-reports';
import { operationError } from './class-operation-state';

/** SDD-218 R4: 회원 본인의 변화 흐름.
 *
 * 각 회차 **안에서** 전반과 후반을 비교한 결과만 보여준다.
 * 회차 사이의 개선·악화를 말하지 않고, 점수나 순위로 환원하지 않는다.
 * 미측정·미착용·미동의·유실·결석은 서로 다른 문구로 구분한다.
 */

const METRIC_LABEL: Record<string, string> = {
  relaxation: '이완',
  concentration: '집중',
  stress: '긴장',
};

const METRIC_COLOR: Record<string, string> = {
  relaxation: 'text-[#2E9D85]',
  concentration: 'text-[#8A4DBF]',
  stress: 'text-[#C46A4A]',
};

const MEASUREMENT_TEXT: Record<MeasurementState, string> = {
  measured: '',
  not_worn: '밴드 미착용 — 측정 없음',
  not_consented: '측정 미동의 — 참여 기록만 있어요',
  data_lost: '측정 자료가 전달되지 않았어요',
  excluded: '이 회차는 리포트 반영에서 빠졌어요',
  none: '',
};

const PARTICIPATION_TEXT: Record<string, string> = {
  attended: '출석',
  absent: '결석',
  withdrawn: '이탈',
  expected: '예정',
  not_enrolled: '합류 전',
};

function AttendanceChip({ session }: { session: TrendSession }) {
  const { state, is_makeup: isMakeup } = session.participation;
  const tone =
    state === 'attended'
      ? 'text-[#0B6B55]'
      : state === 'absent'
        ? 'text-[#8A3A1F]'
        : state === 'not_enrolled'
          ? 'text-[#9B9B9B]'
          : 'text-[#5F0080]';
  const dashed = state === 'not_enrolled' ? 'border-dashed bg-[#F4F1F6]' : 'border-solid bg-white';
  return (
    <div className={`w-16 rounded-xl border border-[#ECE6F0] py-2 text-center ${dashed}`}>
      <span className="block text-xs font-semibold text-[#9B9B9B]">{session.order}회차</span>
      <span className={`mt-1 block text-sm font-bold ${tone}`}>
        {isMakeup ? '보강' : PARTICIPATION_TEXT[state]}
      </span>
    </div>
  );
}

/** 전반→후반을 잇는 작은 눈금. 숫자와 함께 방향을 한 번 더 보여준다. */
function BeforeAfterMark({ before, after }: { before: number; after: number }) {
  const scale = (value: number): number => Math.max(2, Math.min(38, (value / 100) * 38));
  return (
    <svg viewBox="0 0 48 16" className="h-4 w-12 flex-none" aria-hidden>
      <line x1="2" y1="13" x2="46" y2="13" className="stroke-[#ECE6F0]" strokeWidth="1.5" />
      <circle cx={2 + scale(before)} cy="13" r="2.5" className="fill-[#C9BFD4]" />
      <circle cx={2 + scale(after)} cy="13" r="3" className="fill-[#5F0080]" />
    </svg>
  );
}

function ChangeLines({ session }: { session: TrendSession }) {
  const change = session.change;
  if (!change || change.status !== 'computed') {
    // 값이 없으면 만들어내지 않는다. 왜 없는지만 말한다.
    const text =
      session.measurement !== 'measured'
        ? MEASUREMENT_TEXT[session.measurement]
        : '이번 회차는 변화를 계산할 만큼 자료가 모이지 않았어요.';
    return text ? <p className="text-sm leading-relaxed text-[#6F6F6F]">{text}</p> : null;
  }
  return (
    <>
      {Object.entries(change.metrics).map(([metric, value]) => (
        <div key={metric} className="flex flex-wrap items-center gap-2 text-sm">
          <span className={`w-12 flex-none font-bold ${METRIC_COLOR[metric] ?? ''}`}>
            {METRIC_LABEL[metric] ?? metric}
          </span>
          <BeforeAfterMark before={value.before} after={value.after} />
          <span className="text-[#6F6F6F]">
            전반 {value.before} → 후반 {value.after}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-bold ${
              value.direction === 'eased'
                ? 'bg-[#E3F8F2] text-[#0B6B55]'
                : value.direction === 'tensed'
                  ? 'bg-[#FBEAE3] text-[#8A3A1F]'
                  : 'bg-[#F0ECF3] text-[#6F6F6F]'
            }`}
          >
            {value.direction === 'steady'
              ? '비슷함'
              : `${value.delta > 0 ? '+' : ''}${value.delta} ${
                  value.direction === 'eased' ? '편안해짐' : '뒤척임'
                }`}
          </span>
        </div>
      ))}
    </>
  );
}

export function MemberClassTrend({ classId }: { classId: string }) {
  const [trend, setTrend] = useState<MemberTrend | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);

  useEffect(() => {
    const version = ++generation.current;
    setLoading(true);
    setError('');
    void classReportsApi
      .memberTrend(classId)
      .then((value) => {
        if (version === generation.current) setTrend(value);
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
  }, [classId]);

  if (loading) return <p role="status">변화 흐름을 불러오는 중이에요.</p>;
  if (error)
    return (
      <p role="alert" className="text-sm text-[#8A3A1F]">
        {error}
      </p>
    );
  if (!trend) return null;

  const visible = trend.sessions;

  return (
    <div className="space-y-4">
      <section className="space-y-2 rounded-3xl bg-gradient-to-br from-[#3A1554] via-[#5F0080] to-[#7A2BA0] p-6 text-[#F7F4F0]">
        <h2 className="text-lg font-bold leading-snug">나의 변화 흐름</h2>
        <p className="text-sm leading-relaxed text-[#D9CCE4]">
          각 회차 안에서 전반과 후반을 비교한 변화예요. 회차끼리 비교하거나 점수를 매기지 않아요.
        </p>
      </section>

      <section className="space-y-3 rounded-2xl border border-[#ECE6F0] bg-white p-6">
        <b className="text-sm">출석 흐름 · 측정 {trend.measured_session_count}회차</b>
        <div className="flex flex-wrap gap-2">
          {visible.map((session) => (
            <AttendanceChip key={session.session_id} session={session} />
          ))}
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-[#ECE6F0] bg-white p-6">
        <b className="text-sm">회차 안에서의 변화 — 전반 → 후반</b>
        <ul className="divide-y divide-[#ECE6F0]">
          {visible
            .filter((s) => s.participation.state !== 'not_enrolled')
            .map((session) => (
              <li key={session.session_id} className="flex flex-wrap items-start gap-4 py-4">
                <span className="w-20 flex-none font-bold">
                  {session.order}회차
                  <span className="mt-0.5 block text-xs font-semibold text-[#9B9B9B]">
                    {session.scheduled_at
                      ? new Date(session.scheduled_at).toLocaleDateString('ko-KR', {
                          month: 'long',
                          day: 'numeric',
                        })
                      : '일정 미정'}
                    {session.participation.is_makeup && ' · 보강'}
                  </span>
                </span>
                <div className="flex min-w-[240px] flex-1 flex-col gap-2">
                  <ChangeLines session={session} />
                  {session.participation.makeup_for_session_id && (
                    <p className="text-sm text-[#6F6F6F]">
                      결석한 회차를 보강으로 이어서 참여했어요.
                    </p>
                  )}
                  {session.report ? (
                    <a
                      href={`/reports/${session.report.id}`}
                      className="inline-flex min-h-[44px] items-center text-sm font-bold text-[#5F0080] underline underline-offset-4"
                    >
                      이 회차 리포트 보기
                    </a>
                  ) : (
                    session.participation.state === 'attended' && (
                      <p className="text-sm text-[#6F6F6F]">
                        지도사가 확인을 마치면 이곳에서 볼 수 있어요.
                      </p>
                    )
                  )}
                </div>
              </li>
            ))}
        </ul>
      </section>

      <p className="text-sm leading-relaxed text-[#9B9B9B]">
        이 화면은 회원 본인에게만 보여요. 승인된 리포트의 측정값만 쓰고, 다른 참여자와 비교하지 않아요.
      </p>
    </div>
  );
}
