// 회원 개인 명상 리포트(v11) 화면 — 한 벌 반응형(700px 분기). SDD-327 T7
import type { ReactNode } from 'react';
import type { MemberReport } from '../../lib/member-report/types';
import { directionArrow, visibleSections } from './format';
import MetricCard from './MetricCard';
import StableFive from './StableFive';
import './member-report.css';

export interface MemberReportViewProps {
  report: MemberReport;
  /** 보내기 진입점(ReportShareEntry 등) — 페이지(T8)에서 주입 */
  shareSlot?: ReactNode;
  /** PDF 책 받기 등 상단 우측 액션 슬롯 */
  headerActionSlot?: ReactNode;
}

interface NavItem { id: string; label: string }

export default function MemberReportView({ report, shareSlot, headerActionSlot }: MemberReportViewProps) {
  const { meta, hero, opinion, journey, stable5, next_steps: nextSteps, method } = report;
  const worn = meta.band_status === 'worn';
  const bodySections = visibleSections(report, 'body');
  const mindSections = visibleSections(report, 'mind');

  const nav: NavItem[] = [
    { id: 'mr-summary', label: '요약' },
    { id: 'mr-opinion', label: '종합 의견' },
    ...(bodySections.length > 0 || journey ? [{ id: 'mr-body', label: '몸의 변화' }] : []),
    ...(mindSections.length > 0 ? [{ id: 'mr-mind', label: '마음의 변화' }] : []),
    { id: 'mr-next', label: '다음 걸음' },
    { id: 'mr-method', label: '방법·문의' },
  ];

  return (
    <div className="mr-root" data-band-status={meta.band_status}>
      <header className="mr-toolbar">
        <span>MIND BREEZE / 나의 기록</span>
        <span className="mr-toolbar-actions">{headerActionSlot}</span>
      </header>
      <div className="mr-layout">
        <nav className="mr-toc" aria-label="리포트 목차">
          <div className="mr-toc-head">{report.toc.heading}</div>
          <ol>
            {nav.map((n) => (<li key={n.id}><a href={`#${n.id}`}>{n.label}</a></li>))}
          </ol>
        </nav>
        <main className="mr-main">
          {/* 요약: 효과 결론 + 전후 4쌍 + 지금 나의 상태 */}
          <section className="mr-hero" id="mr-summary" aria-labelledby="mr-hero-title">
            <div className="mr-kicker">{hero.kicker}</div>
            <h1 id="mr-hero-title" className="mr-headline">{hero.headline}</h1>
            <p className="mr-lead">{hero.lead}</p>
            {hero.pairs.length > 0 && (
              <>
                {(hero.pair_caption_before || hero.pair_caption_after) && (
                  <div className="mr-pair-caption">
                    <span>{hero.pair_caption_before}</span><span>{hero.pair_caption_after}</span>
                  </div>
                )}
                <div className="mr-pairs">
                  {hero.pairs.map((p) => (
                    <div key={p.key} className={`mr-pair mr-pair-${p.tone}`} data-key={p.key}>
                      <div className="mr-pair-name">{p.name} <small>{p.unit}</small></div>
                      <div className="mr-pair-values mr-num">
                        <span>{p.before}</span><i aria-hidden="true">→</i><strong>{p.after}</strong>
                      </div>
                      <div className="mr-pair-change">{p.change_text || directionArrow(p.direction)}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
            {hero.caution && <p className="mr-caution">{hero.caution}</p>}
            {hero.other_directions && <p className="mr-other">{hero.other_directions}</p>}
            {hero.stable_summary && (
              <div className="mr-state">
                <b>{hero.stable_summary.title}</b>
                {hero.stable_summary.lines.map((l) => <p key={l}>{l}</p>)}
                <small>{hero.stable_summary.note}</small>
              </div>
            )}
            {shareSlot && <div className="mr-share" data-print-exclude>{shareSlot}</div>}
          </section>

          {/* 종합 의견 */}
          <section className="mr-section" id="mr-opinion">
            <div className="mr-eyebrow">{opinion.narrative.eyebrow}</div>
            <h2 className="mr-h2">{opinion.narrative.title}</h2>
            <p className="mr-body">{opinion.narrative.body}</p>
            {!worn && (
              <div className="mr-interpret"><b>{opinion.interpret_title}</b>{opinion.interpret_body}</div>
            )}
            {opinion.reading && <p className="mr-reading">{opinion.reading}</p>}
          </section>

          {/* 몸의 변화 */}
          {worn && (bodySections.length > 0 || journey) && (
            <section className="mr-section" id="mr-body">
              <h2 className="mr-chapter">몸의 변화</h2>
              {journey && (
                <article className="mr-card" id="mr-journey">
                  <div className="mr-eyebrow">{journey.eyebrow}</div>
                  <h3 className="mr-metric-title">{journey.title}</h3>
                  <p className="mr-body">{journey.body}</p>
                  <p className="mr-note">{journey.stable_basis_note}</p>
                  <p className="mr-note">{journey.footer_note}</p>
                </article>
              )}
              {bodySections.map((s) => (
                <div key={s.key} className="mr-fragment">
                  <MetricCard section={s} meta={meta} />
                  {s.key === 'motion' && stable5 && <StableFive data={stable5} />}
                </div>
              ))}
              {bodySections.every((s) => s.key !== 'motion') && stable5 && <StableFive data={stable5} />}
            </section>
          )}

          {/* 마음의 변화 */}
          {worn && mindSections.length > 0 && (
            <section className="mr-section" id="mr-mind">
              <h2 className="mr-chapter">마음의 변화</h2>
              {mindSections.map((s) => <MetricCard key={s.key} section={s} meta={meta} />)}
            </section>
          )}

          {/* 다음 걸음 */}
          <section className="mr-section" id="mr-next">
            <div className="mr-eyebrow">{nextSteps.eyebrow}</div>
            <h2 className="mr-h2">{nextSteps.title}</h2>
            <p className="mr-body">{nextSteps.body}</p>
            {nextSteps.items.map((it) => (
              <div key={it.title} className="mr-next-item"><b>{it.title}</b><p>{it.body}</p></div>
            ))}
          </section>

          {/* 방법·문의 */}
          <section className="mr-section" id="mr-method">
            <div className="mr-eyebrow">{method.eyebrow}</div>
            <h2 className="mr-h2">{method.title}</h2>
            <p className="mr-body">{method.body}</p>
            <h3 className="mr-sub">{method.reading_title}</h3>
            {method.paragraphs.map((p) => <p key={p} className="mr-body-sm">{p}</p>)}
            <p className="mr-note">{method.footnote}</p>
            <h3 className="mr-sub">{method.references_title}</h3>
            <ol className="mr-refs">
              {method.references.map((r) => <li key={r.text}>{r.text}</li>)}
            </ol>
            <p className="mr-note">{method.references_checked}</p>
            <div className="mr-contact"><b>{method.contact_title}</b><p>{method.contact_body}</p></div>
            <p className="mr-note">{meta.basis_text}</p>
          </section>
        </main>
      </div>
    </div>
  );
}
