import { Link } from 'react-router-dom';

const kits = [
  { path: '/design/homepage', title: 'Homepage', desc: '마케팅 홈페이지 — Hero · Feature Cards · Process · CTA' },
  { path: '/design/app', title: 'Operator App', desc: 'iPad 지도사 앱 — Dashboard · Clients · Messages · Session · SignIn' },
  { path: '/design/user-app', title: 'User App', desc: '내담자 모바일 — Home · Class · Session · Report · Profile' },
  { path: '/design/report', title: 'Report', desc: 'AI 분석 리포트 — Cover · Charts' },
  { path: '/design/docs', title: 'Docs / Brochure', desc: '브로셔 페이지 — Cover · TOC · Content · Stats · Quote · Back' },
];

export default function DesignIndexPage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'var(--mb-bg-warm)',
        padding: '80px 32px',
        fontFamily: 'var(--mb-font-sans)',
      }}
    >
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <span className="mb-eyebrow">MIND BREEZE Design System</span>
        <h1
          style={{
            fontWeight: 700,
            fontSize: 48,
            lineHeight: '60px',
            letterSpacing: '-0.03em',
            margin: '20px 0 0',
            color: 'var(--mb-label-80)',
          }}
        >
          UI Kits
        </h1>
        <p style={{ marginTop: 12, color: 'var(--mb-fg-soft)', fontSize: 16, lineHeight: '28px', maxWidth: 640 }}>
          claude.ai/design 핸드오프에서 가져온 5개 UI 키트를 React/TS로 포팅한 프리뷰입니다. 각 화면은 픽셀 단위로
          원본을 재현합니다.
        </p>
        <div
          style={{
            marginTop: 48,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 20,
          }}
        >
          {kits.map((k) => (
            <Link
              key={k.path}
              to={k.path}
              style={{
                background: '#fff',
                borderRadius: 22,
                padding: 32,
                textDecoration: 'none',
                color: 'inherit',
                boxShadow: 'var(--mb-shadow-card)',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--mb-font-mono)',
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: '0.12em',
                  color: 'var(--mb-primary)',
                  textTransform: 'uppercase',
                }}
              >
                UI KIT
              </div>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 22,
                  letterSpacing: '-0.012em',
                  color: 'var(--mb-label-80)',
                }}
              >
                {k.title}
              </div>
              <div style={{ fontSize: 14, lineHeight: '22px', color: 'var(--mb-fg-muted)' }}>{k.desc}</div>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
