// SDD-328 F1 — 회원 개인 명상 리포트 v2(범용·쉬운 말) 화면. 한 벌 반응형(700px 분기), 접두 mr2-
import type { ReactNode } from 'react';
import type { MemberReportV2, MetricKeyV2, MetricSectionV2 } from '../../lib/member-report/types-v2';
import MetricCardV2 from './MetricCardV2';
import QuietFiveV2 from './QuietFiveV2';
import { TimeChartV2 } from './charts-v2';
import GroupStoryV2 from './GroupStoryV2';
import './member-report-v2.css';

export interface MemberReportViewV2Props {
  report: MemberReportV2;
  shareSlot?: ReactNode;
  headerActionSlot?: ReactNode;
}

const BODY_ORDER: MetricKeyV2[] = ['motion', 'heart_rate', 'rmssd', 'lf_hf'];
const MIND_ORDER: MetricKeyV2[] = ['focus', 'relaxation', 'emotional_balance', 'aperiodic'];

function visible(report: MemberReportV2, order: MetricKeyV2[]): MetricSectionV2[] {
  const out: MetricSectionV2[] = [];
  for (const k of order) {
    const sec = report.metrics[k];
    if (sec && sec.state === 'ok' && sec.body) out.push(sec);
  }
  return out;
}

const arrowOf = (d: 'up' | 'down' | 'stable'): string => (d === 'up' ? '↑' : d === 'down' ? '↓' : '→');

export default function MemberReportViewV2({ report, shareSlot, headerActionSlot }: MemberReportViewV2Props) {
  const { meta, hero, opinion, journey, quiet5, next_steps: nextSteps, method } = report;
  const worn = meta.band_status === 'worn';
  const bodySections = visible(report, BODY_ORDER);
  const mindSections = visible(report, MIND_ORDER);
  const settle = meta.settle_minutes;
  const journeyCharts = journey
    ? journey.chart_keys.map((k) => report.metrics[k]).filter((s): s is MetricSectionV2 => !!s && s.state === 'ok' && !!s.body)
    : [];
  const opinionCharts = opinion.chart_keys
    .map((k) => report.metrics[k]).filter((s): s is MetricSectionV2 => !!s && s.state === 'ok' && !!s.body);

  const nav: { id: string; label: string }[] = [
    { id: 'mr2-summary', label: '요약' },
    { id: 'mr2-opinion', label: '종합 의견' },
    ...(report.group_story ? [{ id: 'mr2-group-story', label: '그룹 기록' }] : []),
    ...(worn && (bodySections.length > 0 || journey || quiet5) ? [{ id: 'mr2-body', label: '몸의 변화' }] : []),
    ...(worn && mindSections.length > 0 ? [{ id: 'mr2-mind', label: '마음의 변화' }] : []),
    { id: 'mr2-next', label: '다음 걸음' },
    { id: 'mr2-method', label: '방법·문의' },
  ];

  return (
    <div className="mr2-root" data-testid="member-report-v2" data-band-status={meta.band_status}>
      <header className="mr2-toolbar">
        <span>MIND BREEZE / 나의 명상 기록</span>
        <span className="mr2-toolbar-actions">{headerActionSlot}</span>
      </header>
      <div className="mr2-layout">
        <nav className="mr2-toc" aria-label="리포트 목차">
          <div className="mr2-toc-head">{report.toc.heading}</div>
          <ol>{nav.map((n) => (<li key={n.id}><a href={`#${n.id}`}>{n.label}</a></li>))}</ol>
        </nav>
        <main className="mr2-main">
          <section className="mr2-hero" id="mr2-summary" aria-labelledby="mr2-hero-title">
            <div className="mr2-eyebrow">{hero.kicker}</div>
            <h1 id="mr2-hero-title" className="mr2-headline">{hero.headline}</h1>
            <p className="mr2-lead">{hero.lead}</p>
            {hero.pairs.length > 0 && (
              <>
                {(hero.pair_caption_before || hero.pair_caption_after) && (
                  <div className="mr2-pair-caption"><span>{hero.pair_caption_before}</span><span>{hero.pair_caption_after}</span></div>
                )}
                <div className="mr2-pairs">
                  {hero.pairs.map((p) => (
                    <div key={p.key} className={`mr2-pair mr2-pair-${p.key} mr2-pair-${p.tone}`} data-key={p.key}>
                      <div className="mr2-pair-name">{p.name}<small>{p.unit}</small></div>
                      <div className="mr2-pair-values mr2-num"><span>{p.before}</span><i aria-hidden="true">→</i><strong>{p.after}</strong></div>
                      <b className="mr2-pair-change">{p.change_text || arrowOf(p.direction)}</b>
                    </div>
                  ))}
                </div>
              </>
            )}
            {hero.caution && <p className="mr2-caution">{hero.caution}</p>}
            {hero.other_directions && <p className="mr2-caution">{hero.other_directions}</p>}
            {hero.quiet_highlight && (
              <div className="mr2-quiet-highlight" data-testid="mr2-quiet-highlight">
                <strong>{hero.quiet_highlight.text}</strong>
                <p>{hero.quiet_highlight.note}</p>
              </div>
            )}
            {hero.note && <p className="mr2-note">{hero.note}</p>}
            {shareSlot && <div className="mr2-share" data-print-exclude>{shareSlot}</div>}
          </section>

          <section className="mr2-section" id="mr2-opinion">
            <div className="mr2-eyebrow">{opinion.narrative.eyebrow}</div>
            <h2 className="mr2-h2">{opinion.narrative.title}</h2>
            {opinion.narrative.body && <p className="mr2-body">{opinion.narrative.body}</p>}
            {opinion.observations.length > 0 && (
              <div className="mr2-observations">
                {opinion.observations.map((o) => (
                  <div key={o.title} className="mr2-observation"><b>{o.title}</b><p>{o.body}</p></div>
                ))}
              </div>
            )}
            {opinion.interpret_body && (
              <div className="mr2-interpret"><b>{opinion.interpret_title}</b><p>{opinion.interpret_body}</p></div>
            )}
            {opinionCharts.length > 0 && (
              <div className="mr2-dist-grid">
                {opinionCharts.map((s) => (
                  <div key={s.key}><h4>{s.title}</h4><TimeChartV2 series={s.body!.series} title={s.title} narrow settleMinutes={settle} /></div>
                ))}
              </div>
            )}
            {opinionCharts.length > 0 && <p className="mr2-legend">{opinion.legend_note}</p>}
            {opinion.footnote && <p className="mr2-footnote">{opinion.footnote}</p>}
          </section>

          {report.group_story && <GroupStoryV2 story={report.group_story} />}

          {worn && (bodySections.length > 0 || journey || quiet5) && (
            <section className="mr2-section" id="mr2-body">
              <h2 className="mr2-chapter">몸의 변화</h2>
              {journey && (
                <article className="mr2-card" id="mr2-journey">
                  <div className="mr2-eyebrow">{journey.eyebrow}</div>
                  <h3 className="mr2-metric-title">{journey.title}</h3>
                  <div className="mr2-timeline">
                    {journey.timeline.map((t) => (<div key={t.label}><strong>{t.label}</strong>{t.value}</div>))}
                  </div>
                  {journeyCharts.map((s) => (
                    <div key={s.key} className="mr2-plot">
                      <div className="mr2-plot-head"><b>{s.title}</b></div>
                      <div className="mr2-wide"><TimeChartV2 series={s.body!.series} title={s.title} settleMinutes={settle} /></div>
                      <div className="mr2-narrow"><TimeChartV2 series={s.body!.series} title={s.title} narrow settleMinutes={settle} /></div>
                    </div>
                  ))}
                  <p className="mr2-legend">{journey.legend_note}</p>
                  <div className="mr2-interpret"><b>{journey.interpret_title}</b><p>{journey.interpret_body}</p></div>
                </article>
              )}
              {bodySections.map((s) => (
                <div key={s.key} className="mr2-fragment">
                  <MetricCardV2 section={s} settleMinutes={settle} />
                  {s.key === 'motion' && quiet5 && <QuietFiveV2 data={quiet5} />}
                </div>
              ))}
              {bodySections.every((s) => s.key !== 'motion') && quiet5 && <QuietFiveV2 data={quiet5} />}
            </section>
          )}

          {worn && mindSections.length > 0 && (
            <section className="mr2-section" id="mr2-mind">
              <h2 className="mr2-chapter">마음의 변화</h2>
              {mindSections.map((s) => <MetricCardV2 key={s.key} section={s} settleMinutes={settle} />)}
            </section>
          )}

          <section className="mr2-section" id="mr2-next">
            <div className="mr2-eyebrow">{nextSteps.eyebrow}</div>
            <h2 className="mr2-h2">{nextSteps.title}</h2>
            <p className="mr2-body">{nextSteps.body}</p>
            {nextSteps.items.map((it) => (<div key={it.title} className="mr2-next-item"><b>{it.title}</b><p>{it.body}</p></div>))}
          </section>

          <section className="mr2-section" id="mr2-method">
            <div className="mr2-eyebrow">{method.eyebrow}</div>
            <h2 className="mr2-h2">{method.title}</h2>
            <p className="mr2-body">{method.body}</p>
            <h3 className="mr2-sub">{method.reading_title}</h3>
            {method.paragraphs.map((p) => <p key={p} className="mr2-body-sm">{p}</p>)}
            <p className="mr2-footnote">{method.footnote}</p>
            <h3 className="mr2-sub">{method.references_title}</h3>
            <ol className="mr2-refs">{method.references.map((r) => <li key={r.text}>{r.text}</li>)}</ol>
            <p className="mr2-footnote">{method.references_checked}</p>
            <div className="mr2-contact"><b>{method.contact_title}</b><p>{method.contact_body}</p></div>
            <p className="mr2-footnote">{meta.basis_text}</p>
          </section>
        </main>
      </div>
    </div>
  );
}
