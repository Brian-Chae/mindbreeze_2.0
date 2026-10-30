import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { classSummaryApi } from '../../lib/api/class-summary';
import { ApiError } from '../../lib/api/client';
import type { ClassSummaryResponse } from '../../lib/class-report/types';
import { stateCopy } from '../../lib/class-report/state-copy';
import { sourceLabel, AI_SUMMARY_NOTICE } from '../../lib/class-report/narrative-fields';
import { PLAYER_METRICS } from '../../lib/class/player-case';
import { WELLNESS_DISCLAIMER } from '../../lib/legal-copy';
import { getMockState } from '../../lib/class-report/mocks';
import { SummaryHeader } from '../../components/session-summary/summary-header';
import { HeadcountStrip } from '../../components/session-summary/headcount-strip';
import { TodoSection } from '../../components/session-summary/todo-section';
import '../../components/session-summary/session-summary.css';

export function SessionSummary({ data, onReload }: { data: ClassSummaryResponse; onReload?: () => void }) {
  const { search } = useLocation();
  const reportUrl = `/sessions/${data.session.id}/class-report${search}`;
  const { headline, status, chips, flags } = data.class_report;
  const source = headline ? sourceLabel(headline) : '';
  const showChips = (data.headcount.measured ?? 0) >= 2;
  return <div className="ss-page"><SummaryHeader session={data.session} />{getMockState() && <div className="ss-sample">합성 샘플 · 실제 발송·AI 호출 없음</div>}<div className="ss-layout"><aside className="ss-aside"><p>오늘의 클래스 기록</p><a href="#summary-cover"><span>01</span>오늘 수업 한 줄</a><a href="#summary-attendance"><span>02</span>함께한 사람들</a><a href="#summary-actions"><span>06</span>이제 할 일</a><p>한 수업의 흐름에서<br/>각자의 이야기로.</p><p>코치 검토용</p></aside><main><article>
    <section id="summary-cover" className="ss-cover" data-section="S1"><div className="ss-number">01 / 오늘 수업 한 줄</div><p className="ss-caption">{data.session.class_name} · {data.session.seq}회차</p><h1>{headline?.text || stateCopy(status)}</h1>{status === 'error' && <button className="ss-btn" onClick={onReload}>다시 불러오기</button>}{source && <div className="ss-source"><span title={headline?.source === 'ai' ? AI_SUMMARY_NOTICE : undefined}>{source}</span><Link to={reportUrl}>근거 수치 보기 ↗</Link></div>}{data.capabilities.can_edit_narrative && headline && <Link className="ss-text-link" to={reportUrl}>리포트에서 문장 수정</Link>}
    {showChips && <div className="ss-chips">{(['body', 'mind'] as const).map(group => <span key={group}>{group === 'body' ? '몸' : '마음'} · {chips[group].map(chip => `${PLAYER_METRICS.find(metric => metric.key === chip.key)?.label ?? chip.key} ${chip.state === 'ok' ? (chip.direction ? {up: '↑', down: '↓', stable: '→'}[chip.direction] : '—') : '—'}`).join(' · ')}</span>)}</div>}
    {showChips && <p className="ss-caption">측정 {data.headcount.measured}명 기준 · 개인의 경험을 대신하지 않아요.</p>}{flags.includes('partial') && <p className="ss-caption">측정한 사람 기준으로 정리했어요. 전체 참석자를 대표하지는 않아요.</p>}{flags.includes('lost') && <p className="ss-caption">일부 구간은 연결이 끊겨 제외됐어요.</p>}{flags.includes('poor_signal') && <p className="ss-caption">신호가 고르지 않은 지표는 계산에서 제외했어요.</p>}</section>
    <HeadcountStrip headcount={data.headcount}/>
    {status !== 'zero' && <div className="ss-report-link"><div><strong>오늘의 이야기를 리포트로</strong><p className="ss-caption">동일 서사와 참여자별 상세를 담은 코치 전용 리포트예요.</p></div><Link className="ss-btn ss-primary" to={reportUrl}>코치 클래스 리포트 열기 →</Link></div>}
    <TodoSection data={data}/><footer>이 요약은 코치에게만 보여요. 참여자에게는 승인된 개인 리포트만 전달돼요.<br/>{WELLNESS_DISCLAIMER}</footer>
  </article></main></div></div>;
}
export default function SessionSummaryPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loaded, setLoaded] = useState<{ id: string; data: ClassSummaryResponse } | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  const invalidate = useCallback(() => { requestGeneration.current += 1; }, []);
  const data = loaded && loaded.id === id ? loaded.data : null;
  const error = failedId === id;
  const reload = useCallback(async () => {
    if (!id) return;
    const generation = ++requestGeneration.current;
    try { const result = await classSummaryApi.summary(id); if (generation !== requestGeneration.current) return; setLoaded({ id, data: result }); setFailedId(null); }
    catch (failure) {
      if (generation !== requestGeneration.current) return;
      if (failure instanceof ApiError && failure.status === 400) { navigate(`/sessions/${id}/record`, { replace: true }); return; }
      setFailedId(id);
    }
  }, [id, navigate]);
  useEffect(() => { void reload(); const onFocus = () => void reload(); window.addEventListener('focus', onFocus); return () => { invalidate(); window.removeEventListener('focus', onFocus); }; }, [reload, invalidate]);
  if (error) return <div className="ss-page ss-empty"><h1>요약을 불러오지 못했어요.</h1><button className="ss-btn ss-primary" onClick={() => void reload()}>다시 불러오기</button><Link className="ss-btn" to="/classes">클래스 목록</Link><p>이 요약은 코치에게만 보여요.</p><p>{WELLNESS_DISCLAIMER}</p></div>;
  if (!data) return <div className="ss-page ss-empty" role="status">회차 요약을 불러오는 중이에요.<p>이 요약은 코치에게만 보여요.</p><p>{WELLNESS_DISCLAIMER}</p></div>;
  return <SessionSummary key={data.session.id} data={data} onReload={() => void reload()}/>;
}
