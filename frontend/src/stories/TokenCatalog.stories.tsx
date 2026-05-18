import type { Meta, StoryObj } from '@storybook/react';

/** 토큰 카탈로그 — Clinical Garden 디자인 시스템의 모든 원시 값을 시각화 */
const TokenCatalog = () => (
  <div className="p-8 space-y-12 max-w-5xl">
    {/* 컬러 팔레트 */}
    <section>
      <h2 className="font-display text-2xl font-light text-ink-primary mb-6">컬러 팔레트</h2>
      {[
        {
          title: 'Brand — Sage',
          tokens: ['brand-primary', 'brand-primary-hover', 'brand-subtle', 'brand-muted', 'brand-deep'],
        },
        {
          title: 'Background — Oat',
          tokens: ['surface-canvas', 'surface-elevated', 'surface-raised', 'surface-sunken'],
        },
        {
          title: 'Ink — Text',
          tokens: ['ink-primary', 'ink-secondary', 'ink-tertiary', 'ink-disabled'],
        },
        {
          title: 'Accent',
          tokens: ['accent-warm', 'accent-warm-subtle', 'accent-cool', 'accent-cool-subtle'],
        },
        {
          title: 'Status',
          tokens: ['status-success', 'status-warning', 'status-danger', 'status-info'],
        },
      ].map((group) => (
        <div key={group.title} className="mb-6">
          <h3 className="text-sm font-medium text-ink-secondary mb-3">{group.title}</h3>
          <div className="flex flex-wrap gap-3">
            {group.tokens.map((name) => (
              <div key={name} className="flex flex-col items-center gap-2">
                <div
                  className="w-16 h-16 rounded-lg border border-border-subtle shadow-xs"
                  style={{ backgroundColor: `var(--${name})` }}
                />
                <span className="text-[10px] text-ink-tertiary font-mono">{name}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>

    {/* 타이포그래피 */}
    <section>
      <h2 className="font-display text-2xl font-light text-ink-primary mb-6">타이포그래피</h2>
      <div className="space-y-4">
        <div>
          <p className="text-xs text-ink-tertiary mb-1">Display · Fraunces Light</p>
          <p className="font-display text-5xl font-light tracking-tight text-ink-primary">
            Mind Breeze
          </p>
        </div>
        <div>
          <p className="text-xs text-ink-tertiary mb-1">Body · Inter Regular</p>
          <p className="text-base text-ink-primary">
            과학으로 검증된 평온함 — 차분한 자연의 톤으로 신뢰를 만드는 멘탈 케어 플랫폼.
          </p>
        </div>
        <div>
          <p className="text-xs text-ink-tertiary mb-1">Mono · JetBrains Mono</p>
          <p className="font-mono text-sm text-ink-secondary">
            EEG_CH01 · 250Hz · TS: 1747555200000
          </p>
        </div>
      </div>
    </section>

    {/* 스페이싱 */}
    <section>
      <h2 className="font-display text-2xl font-light text-ink-primary mb-6">스페이싱</h2>
      <div className="flex flex-wrap items-end gap-2">
        {[4, 8, 12, 16, 20, 24, 32, 40, 48, 64].map((s) => (
          <div key={s} className="flex flex-col items-center gap-1">
            <div className="bg-brand-subtle rounded-sm" style={{ width: `${s}px`, height: `${s}px` }} />
            <span className="text-[10px] text-ink-tertiary font-mono">{s}</span>
          </div>
        ))}
      </div>
    </section>

    {/* 모서리 */}
    <section>
      <h2 className="font-display text-2xl font-light text-ink-primary mb-6">Radius</h2>
      <div className="flex flex-wrap gap-6 items-center">
        {[
          { name: 'sm', cls: 'rounded-sm' },
          { name: 'md', cls: 'rounded-md' },
          { name: 'lg', cls: 'rounded-lg' },
          { name: 'xl', cls: 'rounded-xl' },
          { name: 'pill', cls: 'rounded-pill' },
        ].map((r) => (
          <div key={r.name} className="flex flex-col items-center gap-2">
            <div className={`w-20 h-20 bg-brand-subtle ${r.cls}`} />
            <span className="text-[10px] text-ink-tertiary font-mono">{r.name}</span>
          </div>
        ))}
      </div>
    </section>
  </div>
);

const meta: Meta = {
  title: '🎨 Design Tokens / Catalog',
  component: TokenCatalog,
  parameters: { layout: 'fullscreen' },
};
export default meta;
export const Catalog: StoryObj = { render: () => <TokenCatalog /> };
