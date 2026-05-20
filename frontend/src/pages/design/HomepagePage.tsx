import { useState } from 'react';

const ASSET = '/mb-design/assets';

function Nav() {
  const [active, setActive] = useState('서비스');
  const items = ['서비스', 'AI 리포트', '고객 사례', '고객센터'];
  return (
    <nav
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        background: 'rgba(255,255,255,0.92)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid #EFEFEF',
      }}
    >
      <div
        style={{
          maxWidth: 1280,
          margin: '0 auto',
          padding: '18px 32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 32,
        }}
      >
        <a href="#" style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none' }}>
          <img src={`${ASSET}/logo_symbol_dark.svg`} width="28" height="13" alt="" />
          <span
            style={{
              fontFamily: 'var(--mb-font-sans)',
              fontWeight: 800,
              fontSize: 19,
              color: '#5F0080',
              letterSpacing: '-0.02em',
            }}
          >
            mind&nbsp;breeze
          </span>
        </a>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {items.map((label) => (
            <button
              key={label}
              onClick={() => setActive(label)}
              style={{
                background: 'transparent',
                border: 0,
                padding: '10px 18px',
                fontFamily: 'var(--mb-font-sans)',
                fontWeight: active === label ? 700 : 500,
                fontSize: 15,
                color: active === label ? '#5F0080' : '#1F1F1F',
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="mb-btn mb-btn--ghost" style={{ height: 40, padding: '0 16px', fontSize: 14, whiteSpace: 'nowrap' }}>
            지도사 로그인
          </button>
          <button className="mb-btn" style={{ height: 40, padding: '0 18px', fontSize: 14, whiteSpace: 'nowrap' }}>
            서비스 신청
          </button>
        </div>
      </div>
    </nav>
  );
}

function Hero() {
  const stats = [
    { n: '14', l: '건의 뇌파 특허' },
    { n: '27K', l: '표준 뇌파 데이터' },
    { n: '10K', l: '시간 기능 데이터' },
    { n: 'CES 2×', l: '혁신상 수상' },
  ];
  return (
    <section style={{ position: 'relative', minHeight: 720, overflow: 'hidden', background: '#EBE6E2' }}>
      <img
        src={`${ASSET}/images/hero_landing.png`}
        alt=""
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          objectPosition: 'right center',
          display: 'block',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(90deg, rgba(235,230,226,0.92) 0%, rgba(235,230,226,0.78) 28%, rgba(235,230,226,0.0) 52%)',
          pointerEvents: 'none',
        }}
      />
      <div style={{ position: 'relative', maxWidth: 1280, margin: '0 auto', padding: '120px 32px 96px' }}>
        <div style={{ maxWidth: 560 }}>
          <span className="mb-eyebrow" style={{ background: '#FFFFFF', color: '#5F0080' }}>
            뇌과학 IT기업, 룩시드랩스
          </span>
          <h1
            style={{
              fontFamily: 'var(--mb-font-sans)',
              fontWeight: 700,
              fontSize: 60,
              lineHeight: '72px',
              letterSpacing: '-0.034em',
              color: '#0A0A0A',
              margin: '28px 0 0',
            }}
          >
            과학으로 증명하는
            <br />
            <span style={{ color: '#5F0080' }}>한 호흡의 변화</span>
          </h1>
          <p
            style={{
              fontFamily: 'var(--mb-font-text)',
              fontWeight: 500,
              fontSize: 18,
              lineHeight: '30px',
              color: 'rgba(0,0,0,0.66)',
              maxWidth: 480,
              margin: '28px 0 0',
            }}
          >
            LINK BAND가 뇌파를 측정하고, AI가 분석하여
            <br />
            지도사와 참여자에게 명상의 효과를 정확하게 전달합니다.
          </p>
          <div style={{ display: 'flex', gap: 12, marginTop: 36, flexWrap: 'wrap' }}>
            <button className="mb-btn" style={{ height: 52, padding: '0 28px', fontSize: 16, borderRadius: 14 }}>
              클래스 신청하기
            </button>
            <button
              className="mb-btn mb-btn--ghost"
              style={{
                height: 52,
                padding: '0 22px',
                fontSize: 16,
                borderRadius: 14,
                background: 'rgba(255,255,255,0.6)',
                backdropFilter: 'blur(8px)',
              }}
            >
              샘플 리포트 보기 →
            </button>
          </div>
          <div style={{ marginTop: 64, display: 'flex', gap: 36, alignItems: 'baseline', flexWrap: 'wrap' }}>
            {stats.map((s) => (
              <div key={s.l}>
                <div
                  style={{
                    fontFamily: 'var(--mb-font-sans)',
                    fontWeight: 700,
                    fontSize: 28,
                    letterSpacing: '-0.02em',
                    color: '#0A0A0A',
                    lineHeight: '32px',
                  }}
                >
                  {s.n}
                </div>
                <div
                  style={{
                    fontFamily: 'var(--mb-font-text)',
                    fontWeight: 500,
                    fontSize: 13,
                    color: 'rgba(0,0,0,0.6)',
                    marginTop: 4,
                    letterSpacing: 0,
                  }}
                >
                  {s.l}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function FeatureCards() {
  return (
    <section style={{ background: '#EBE6E2', padding: '0 32px 96px' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        <div style={{ marginBottom: 32 }}>
          <span className="mb-eyebrow" style={{ background: '#FFFFFF', color: '#5F0080' }}>
            서비스 구성
          </span>
          <h2
            style={{
              fontFamily: 'var(--mb-font-sans)',
              fontWeight: 700,
              fontSize: 36,
              lineHeight: '46px',
              letterSpacing: '-0.028em',
              color: '#0A0A0A',
              margin: '16px 0 0',
              maxWidth: 720,
            }}
          >
            기기와 호흡, 두 가지로 완성되는 명상 클래스
          </h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 20 }}>
          {[
            {
              img: 'feature_link_headbands.png',
              kicker: 'HARDWARE · LINK BAND',
              title: '머리에 닿는 순간, 뇌파를 읽습니다',
              body: '의료용 등급 센서를 헤드밴드 한 줄에 담았습니다.\n5가지 컬러, 가벼운 무게로 누구나 부담 없이 착용합니다.',
            },
            {
              img: 'feature_inhale_mountain.png',
              kicker: 'EXPERIENCE · BREATH GUIDE',
              title: '들숨과 날숨에 맞춰\n지도사의 손길이 닿습니다',
              body: '실시간 뇌파 데이터를 기반으로 호흡 리듬을 안내하고,\nAI 코치가 지도사의 진행을 도와줍니다.',
            },
          ].map((c) => (
            <article
              key={c.img}
              style={{ background: '#FFFFFF', borderRadius: 28, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
            >
              <div style={{ aspectRatio: '16 / 9', overflow: 'hidden' }}>
                <img
                  src={`${ASSET}/images/${c.img}`}
                  alt={c.title}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              </div>
              <div style={{ padding: '32px 32px 36px' }}>
                <div
                  style={{
                    fontFamily: 'var(--mb-font-mono)',
                    fontSize: 12,
                    fontWeight: 600,
                    letterSpacing: '0.12em',
                    color: '#5F0080',
                    textTransform: 'uppercase',
                  }}
                >
                  {c.kicker}
                </div>
                <h3
                  style={{
                    fontFamily: 'var(--mb-font-sans)',
                    fontWeight: 700,
                    fontSize: 24,
                    lineHeight: '32px',
                    color: '#0A0A0A',
                    margin: '10px 0 8px',
                    letterSpacing: '-0.02em',
                    whiteSpace: 'pre-line',
                  }}
                >
                  {c.title}
                </h3>
                <p
                  style={{
                    fontFamily: 'var(--mb-font-text)',
                    fontWeight: 500,
                    fontSize: 15,
                    lineHeight: '26px',
                    color: 'rgba(0,0,0,0.6)',
                    margin: 0,
                    whiteSpace: 'pre-line',
                  }}
                >
                  {c.body}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function PeopleSection() {
  const people = [
    { src: 'portrait_01_warm_sweater.png', label: '직장인', tag: '스트레스 관리' },
    { src: 'portrait_02_young_man_concrete.png', label: '청년', tag: '집중력 회복' },
    { src: 'portrait_03_woman_robe.png', label: '시니어', tag: '두뇌 휴식' },
    { src: 'portrait_04_young_man_warm.png', label: '대학생', tag: '수면의 질' },
    { src: 'portrait_05_woman_sunset_white.png', label: '프리랜서', tag: '감정 균형' },
    { src: 'portrait_06_woman_purple_sunset.png', label: '수련자', tag: '마음챙김' },
  ];
  return (
    <section style={{ background: '#FFFFFF', padding: '120px 32px' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
            gap: 64,
            alignItems: 'end',
            marginBottom: 56,
          }}
        >
          <div>
            <span className="mb-eyebrow">모두의 마음 안식</span>
            <h2
              style={{
                fontFamily: 'var(--mb-font-sans)',
                fontWeight: 700,
                fontSize: 42,
                lineHeight: '54px',
                letterSpacing: '-0.0336em',
                color: '#0A0A0A',
                margin: '20px 0 0',
              }}
            >
              다양한 일상에 스며드는
              <br />
              과학적인 명상
            </h2>
          </div>
          <p
            style={{
              fontFamily: 'var(--mb-font-text)',
              fontWeight: 500,
              fontSize: 16,
              lineHeight: '28px',
              color: 'rgba(0,0,0,0.6)',
              margin: 0,
              paddingBottom: 6,
            }}
          >
            MIND BREEZE는 누구의 호흡이든 측정합니다. 직장인의 점심 휴식, 시니어의 아침 루틴, 학생의 시험 전 5분 — 일상의
            모양은 달라도 뇌가 쉬는 방식은 동일합니다.
          </p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 14 }}>
          {people.map((p) => (
            <figure key={p.src} style={{ margin: 0, position: 'relative' }}>
              <div style={{ aspectRatio: '5 / 7', overflow: 'hidden', borderRadius: 18, background: '#EBE6E2' }}>
                <img
                  src={`${ASSET}/images/${p.src}`}
                  alt={p.label}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              </div>
              <figcaption
                style={{
                  marginTop: 12,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--mb-font-sans)',
                    fontWeight: 700,
                    fontSize: 14,
                    color: '#0A0A0A',
                    letterSpacing: '-0.01em',
                  }}
                >
                  {p.label}
                </span>
                <span style={{ fontFamily: 'var(--mb-font-text)', fontWeight: 500, fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>
                  {p.tag}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

function ProcessSection() {
  const steps = [
    { n: '01', title: 'LINK BAND 등록', body: '지도사 앱에서 측정 기기를 등록하고 참여자와 페어링합니다.' },
    { n: '02', title: '세션 진행', body: '오프라인·온라인 세션에서 실시간으로 뇌파를 측정합니다.' },
    { n: '03', title: 'AI 분석', body: '측정 데이터를 룩시드랩스의 학습 모델로 자동 해석합니다.' },
    { n: '04', title: '리포트 발급', body: '스트레스·집중·균형의 두뇌건강 리포트를 즉시 발급합니다.' },
  ];
  return (
    <section style={{ background: '#FFFFFF', padding: '120px 32px' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 64 }}>
          <span className="mb-eyebrow">서비스 흐름</span>
          <h2
            style={{
              fontFamily: 'var(--mb-font-sans)',
              fontWeight: 700,
              fontSize: 42,
              lineHeight: '54px',
              letterSpacing: '-0.0336em',
              color: '#1F1F1F',
              margin: '20px 0 0',
            }}
          >
            등록부터 리포트까지, 한 자리에서
          </h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20 }}>
          {steps.map((s, i) => (
            <div
              key={s.n}
              style={{ background: '#F5EDFC', borderRadius: 24, padding: 28, minHeight: 220, position: 'relative' }}
            >
              <div
                style={{
                  fontFamily: 'var(--mb-font-mono)',
                  fontWeight: 700,
                  fontSize: 14,
                  color: '#5F0080',
                  letterSpacing: '0.1em',
                }}
              >
                {s.n}
              </div>
              <h3
                style={{
                  fontFamily: 'var(--mb-font-sans)',
                  fontWeight: 700,
                  fontSize: 22,
                  lineHeight: '30px',
                  color: '#1F1F1F',
                  margin: '20px 0 10px',
                }}
              >
                {s.title}
              </h3>
              <p
                style={{
                  fontFamily: 'var(--mb-font-text)',
                  fontWeight: 500,
                  fontSize: 14,
                  lineHeight: '22px',
                  color: 'rgba(0,0,0,0.6)',
                  margin: 0,
                }}
              >
                {s.body}
              </p>
              {i < steps.length - 1 && (
                <div
                  style={{
                    position: 'absolute',
                    right: -14,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: '#B373EF',
                    fontSize: 22,
                    fontWeight: 300,
                  }}
                >
                  ›
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CTASection() {
  return (
    <section style={{ padding: '0 32px 96px', background: '#FFFFFF' }}>
      <div
        style={{
          maxWidth: 1280,
          margin: '0 auto',
          background: '#5F0080',
          borderRadius: 48,
          padding: '80px 60px',
          position: 'relative',
          overflow: 'hidden',
          color: '#FFFFFF',
        }}
      >
        <img
          src={`${ASSET}/logo_symbol_dark.svg`}
          alt=""
          style={{
            position: 'absolute',
            right: -60,
            bottom: -80,
            width: 520,
            opacity: 0.18,
            filter: 'brightness(0) invert(1)',
            transform: 'rotate(-8deg)',
          }}
        />
        <div style={{ position: 'relative', maxWidth: 720 }}>
          <span className="mb-eyebrow" style={{ background: '#191A1E', color: '#C6AEF6' }}>
            지도사를 위한 도구
          </span>
          <h2
            style={{
              fontFamily: 'var(--mb-font-sans)',
              fontWeight: 800,
              fontSize: 48,
              lineHeight: '60px',
              letterSpacing: '-0.03em',
              color: '#FFFFFF',
              margin: '24px 0 16px',
            }}
          >
            과학적인 명상 클래스를
            <br />
            여러분의 공간에서 시작하세요
          </h2>
          <p
            style={{
              fontFamily: 'var(--mb-font-text)',
              fontWeight: 500,
              fontSize: 17,
              lineHeight: '28px',
              color: '#C6AEF6',
              margin: 0,
              maxWidth: 560,
            }}
          >
            기관 단위로 도입할 수 있습니다. 도입 절차, LINK BAND 패키지, 지도사 교육까지 한 번에 안내합니다.
          </p>
          <div style={{ display: 'flex', gap: 12, marginTop: 36 }}>
            <button
              className="mb-btn"
              style={{ background: '#FFFFFF', color: '#5F0080', height: 52, padding: '0 28px', fontSize: 16, borderRadius: 14 }}
            >
              도입 문의
            </button>
            <button
              className="mb-btn mb-btn--ghost"
              style={{
                border: '1px solid rgba(255,255,255,0.4)',
                color: '#FFFFFF',
                background: 'transparent',
                height: 52,
                padding: '0 22px',
                fontSize: 16,
                borderRadius: 14,
              }}
            >
              지도사 안내서 다운로드
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer style={{ background: '#191A1E', color: '#FFFFFF', padding: '60px 32px 40px' }}>
      <div
        style={{
          maxWidth: 1280,
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: '2fr 1fr 1fr 1fr',
          gap: 40,
          alignItems: 'start',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img
              src={`${ASSET}/logo_symbol_dark.svg`}
              width="28"
              height="13"
              alt=""
              style={{ filter: 'brightness(0) invert(1)' }}
            />
            <span style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 800, fontSize: 18 }}>mind&nbsp;breeze</span>
          </div>
          <p
            style={{
              fontFamily: 'var(--mb-font-text)',
              fontSize: 13,
              lineHeight: '22px',
              color: '#A2A3AD',
              margin: '14px 0 0',
              maxWidth: 360,
            }}
          >
            ⓒ Looxid Labs Inc.
            <br />
            서울특별시 성동구 · contact@looxidlabs.com
          </p>
        </div>
        {[
          { title: '서비스', items: ['클래스 소개', 'AI 리포트', '도입 문의', '고객 사례'] },
          { title: '회사', items: ['룩시드랩스', '보도자료', '채용', '개인정보 처리방침'] },
          { title: '지원', items: ['고객센터', '지도사 가이드', 'FAQ', '이용약관'] },
        ].map((col) => (
          <div key={col.title}>
            <div
              style={{
                fontFamily: 'var(--mb-font-sans)',
                fontWeight: 700,
                fontSize: 14,
                color: '#FFFFFF',
                marginBottom: 14,
              }}
            >
              {col.title}
            </div>
            {col.items.map((it) => (
              <div
                key={it}
                style={{ fontFamily: 'var(--mb-font-text)', fontSize: 13, lineHeight: '26px', color: '#A2A3AD' }}
              >
                {it}
              </div>
            ))}
          </div>
        ))}
      </div>
    </footer>
  );
}

export default function HomepagePage() {
  return (
    <main>
      <Nav />
      <Hero />
      <FeatureCards />
      <PeopleSection />
      <ProcessSection />
      <CTASection />
      <Footer />
    </main>
  );
}
