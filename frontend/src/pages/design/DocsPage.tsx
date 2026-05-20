import type { ReactNode, CSSProperties } from 'react';

const ASSET = '/mb-design/assets';

function DocPage({ children, bg = '#FFFFFF', chapter, pageNo, bleed = false, hideChrome = false }: { children: ReactNode; bg?: string; chapter?: string; pageNo?: number | null; bleed?: boolean; hideChrome?: boolean }) {
  const inset: CSSProperties = bleed ? { inset: 0 } : { top: 92, left: 64, right: 64, bottom: 80 };
  return (
    <article style={{ width: 794, height: 1123, background: bg, position: 'relative', overflow: 'hidden', boxShadow: '0 12px 30px rgba(95,0,128,0.10)', borderRadius: 4 }}>
      {!hideChrome && (
        <header style={{ position: 'absolute', top: 32, left: 48, right: 48, display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src={`${ASSET}/logo_symbol_dark.svg`} alt="" style={{ width: 28, height: 'auto', display: 'block' }} />
            <span style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 600, fontSize: 14, lineHeight: 0.85, letterSpacing: '-0.025em', color: 'var(--mb-fg)' }}>Mind&nbsp;Breeze</span>
          </div>
          {chapter && <span style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--mb-fg-muted)' }}>{chapter}</span>}
        </header>
      )}
      <div style={{ position: 'absolute', ...inset, display: 'flex', flexDirection: 'column' }}>{children}</div>
      {!hideChrome && pageNo != null && (
        <footer style={{ position: 'absolute', bottom: 32, left: 48, right: 48, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontFamily: 'var(--mb-font-mono)', fontSize: 11, color: 'var(--mb-fg-muted)', letterSpacing: '0.08em' }}>
          <span>© LOOXID LABS · MIND BREEZE 2.0</span>
          <span style={{ fontWeight: 600, color: 'var(--mb-fg)' }}>{String(pageNo).padStart(2, '0')}</span>
        </footer>
      )}
    </article>
  );
}

function CoverPage() {
  return (
    <DocPage hideChrome bleed pageNo={null} bg="#EBE6E2">
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '56%', overflow: 'hidden' }}>
        <img src={`${ASSET}/images/hero_landing.png`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: '60% 38%', display: 'block' }} />
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: -1, height: 140, background: 'linear-gradient(180deg, rgba(235,230,226,0) 0%, #EBE6E2 100%)' }} />
      </div>
      <div style={{ position: 'absolute', top: 36, left: 48, display: 'flex', alignItems: 'center', gap: 12 }}>
        <img src={`${ASSET}/logo_symbol_dark.svg`} alt="" style={{ width: 32, height: 'auto', display: 'block' }} />
        <span style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 600, fontSize: 16, lineHeight: 0.85, letterSpacing: '-0.025em', color: '#1F1F1F' }}>Mind&nbsp;Breeze</span>
      </div>
      <div style={{ position: 'absolute', top: 36, right: 48, textAlign: 'right' }}>
        <div style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 9, fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.5)' }}>Product Brochure</div>
        <div style={{ fontFamily: 'var(--mb-font-mono)', fontWeight: 700, fontSize: 11, letterSpacing: '0.1em', color: '#1F1F1F', marginTop: 3 }}>2026 · EDITION 01</div>
      </div>
      <div style={{ position: 'absolute', left: 48, right: 48, bottom: 56, display: 'flex', flexDirection: 'column' }}>
        <span style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', padding: '7px 13px', borderRadius: 9999, background: '#FFFFFF', color: '#5F0080', fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 11, letterSpacing: '0.04em', boxShadow: '0 1px 1px rgba(25,26,30,0.06)' }}>뇌과학 IT기업, 룩시드랩스</span>
        <h1 style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 44, lineHeight: '54px', letterSpacing: '-0.034em', color: '#0A0A0A', margin: '22px 0 0' }}>
          과학으로 증명하는
          <br />
          <span style={{ color: '#5F0080' }}>한 호흡의 변화</span>
        </h1>
        <p style={{ fontFamily: 'var(--mb-font-text)', fontWeight: 500, fontSize: 14, lineHeight: '24px', color: 'rgba(0,0,0,0.66)', margin: '16px 0 0', maxWidth: 480 }}>
          LINK BAND가 뇌파를 측정하고, AI가 분석하여 지도사와 참여자에게 명상의 효과를 정확하게 전달합니다.
        </p>
        <div style={{ marginTop: 32, paddingTop: 22, borderTop: '1px solid rgba(0,0,0,0.12)', display: 'flex', gap: 32, alignItems: 'baseline' }}>
          {[
            { n: '14', l: '건의 뇌파 특허' },
            { n: '27K', l: '표준 뇌파 데이터' },
            { n: '10K', l: '시간 기능 데이터' },
            { n: 'CES 2×', l: '혁신상 수상' },
          ].map((s) => (
            <div key={s.l}>
              <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 22, letterSpacing: '-0.022em', color: '#0A0A0A', lineHeight: '26px' }}>{s.n}</div>
              <div style={{ fontFamily: 'var(--mb-font-text)', fontWeight: 500, fontSize: 11, color: 'rgba(0,0,0,0.55)', marginTop: 4 }}>{s.l}</div>
            </div>
          ))}
        </div>
      </div>
    </DocPage>
  );
}

function TOCPage() {
  const sections = [
    { n: '01', title: '브랜드 이야기', sub: 'Mind Breeze가 다루는 것', page: 'p.04' },
    { n: '02', title: '제품 · LINK BAND', sub: '헤드밴드와 실시간 측정', page: 'p.06' },
    { n: '03', title: '작동 방식', sub: '등록부터 리포트까지 4단계', page: 'p.08' },
    { n: '04', title: '신뢰의 근거', sub: '특허 · 수상 · 데이터', page: 'p.10' },
    { n: '05', title: '함께하는 사람들', sub: '참여자와 지도사의 목소리', page: 'p.12' },
  ];
  return (
    <DocPage chapter="Contents" pageNo={2}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 56, height: '100%' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#6F6F6F' }}>Index · 2026</div>
          <h2 style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 40, lineHeight: '48px', letterSpacing: '-0.024em', color: '#1F1F1F', margin: '8px 0 28px' }}>목차</h2>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {sections.map((s) => (
              <div key={s.n} style={{ display: 'grid', gridTemplateColumns: '48px 1fr 60px', gap: 16, alignItems: 'baseline', padding: '18px 0', borderBottom: '1px solid #E8E4F0' }}>
                <span style={{ fontFamily: 'var(--mb-font-mono)', fontWeight: 700, fontSize: 14, color: '#5F0080', letterSpacing: '0.04em' }}>{s.n}</span>
                <div>
                  <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 19, color: '#1F1F1F', letterSpacing: '-0.014em' }}>{s.title}</div>
                  <div style={{ fontFamily: 'var(--mb-font-text)', fontWeight: 500, fontSize: 13, color: '#6F6F6F', marginTop: 3 }}>{s.sub}</div>
                </div>
                <span style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 12, color: '#6F6F6F', letterSpacing: '0.04em', textAlign: 'right' }}>{s.page}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ borderRadius: 16, overflow: 'hidden', aspectRatio: '5 / 7' }}>
            <img src={`${ASSET}/images/portrait_03_woman_robe.png`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          </div>
          <div style={{ background: '#F5EDFC', borderRadius: 16, padding: 18 }}>
            <div style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#5F0080', fontWeight: 700 }}>About this brochure</div>
            <p style={{ fontFamily: 'var(--mb-font-text)', fontWeight: 500, fontSize: 12, lineHeight: '20px', color: 'rgba(0,0,0,0.7)', margin: '8px 0 0' }}>
              본 자료는 명상 지도사·상담사·기관 도입 담당자를 위한 제품 소개서입니다. MIND BREEZE 2.0의 철학, 기기, 분석 방식, 도입 사례를 한 권에 담았습니다.
            </p>
          </div>
        </div>
      </div>
    </DocPage>
  );
}

function SectionDividerPage() {
  return (
    <DocPage chapter="01 · Brand" pageNo={3}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ position: 'relative', height: 360, borderRadius: 22, overflow: 'hidden', marginBottom: 36 }}>
          <img src={`${ASSET}/images/feature_inhale_mountain.png`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0) 50%, rgba(0,0,0,0.45) 100%)' }} />
          <div style={{ position: 'absolute', left: 24, bottom: 22, right: 24, color: '#FFFFFF' }}>
            <div style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', opacity: 0.85 }}>Chapter 01</div>
            <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 32, letterSpacing: '-0.022em', marginTop: 6 }}>마음의 풍경을 데이터로</div>
          </div>
        </div>
        <h2 style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 30, lineHeight: '40px', letterSpacing: '-0.022em', color: '#1F1F1F', margin: 0, maxWidth: 520 }}>
          MIND BREEZE는 명상의 효과를
          <br />
          <span style={{ color: '#5F0080' }}>객관적인 데이터</span>로 보여줍니다.
        </h2>
        <p style={{ fontFamily: 'var(--mb-font-text)', fontWeight: 500, fontSize: 14, lineHeight: '24px', color: 'rgba(0,0,0,0.66)', margin: '16px 0 0', maxWidth: 600 }}>
          뇌과학 IT기업 룩시드랩스가 10년 동안 축적한 뇌파 분석 기술로, 지도사와 참여자가 한 호흡, 한 회차의 변화를 함께 확인합니다.
        </p>
        <div style={{ marginTop: 'auto', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
          {[
            { n: '01', t: 'MEASURE', k: '측정', b: 'LINK BAND가 호흡과 함께 뇌파를 읽습니다.' },
            { n: '02', t: 'ANALYZE', k: '분석', b: 'AI가 휴식·집중·균형의 지표를 해석합니다.' },
            { n: '03', t: 'GUIDE', k: '안내', b: '지도사와 참여자에게 정확한 피드백을 전달합니다.' },
          ].map((p) => (
            <div key={p.n} style={{ background: '#FAFAFB', borderRadius: 18, padding: 22, border: '1px solid #EFEFEF' }}>
              <div style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 10, letterSpacing: '0.14em', color: '#5F0080', fontWeight: 700 }}>{p.n} · {p.t}</div>
              <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 20, color: '#1F1F1F', marginTop: 10, letterSpacing: '-0.014em' }}>{p.k}</div>
              <p style={{ fontFamily: 'var(--mb-font-text)', fontWeight: 500, fontSize: 12, lineHeight: '20px', color: 'rgba(0,0,0,0.6)', margin: '8px 0 0' }}>{p.b}</p>
            </div>
          ))}
        </div>
      </div>
    </DocPage>
  );
}

function ContentPage() {
  const specs = [
    { k: '센서', v: '건식 EEG 4채널 + 가속도계' },
    { k: '착용감', v: '전체 무게 38g · 헤드 사이즈 자동 조정' },
    { k: '배터리', v: '1회 충전 8시간 · USB-C 30분 급속' },
    { k: '연결', v: 'BLE 5.2 · 최대 8대 동시 측정' },
    { k: '데이터', v: '256Hz 원본 + 1Hz 지표 스트림' },
    { k: '지원', v: 'iOS · Android · macOS · Windows' },
  ];
  return (
    <DocPage chapter="02 · Product" pageNo={4}>
      <div style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 11, letterSpacing: '0.14em', color: '#5F0080', fontWeight: 700 }}>HARDWARE · LINK BAND</div>
      <h2 style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 36, lineHeight: '44px', letterSpacing: '-0.024em', color: '#1F1F1F', margin: '10px 0 8px' }}>
        머리에 닿는 순간,
        <br />
        뇌파를 읽습니다
      </h2>
      <p style={{ fontFamily: 'var(--mb-font-text)', fontWeight: 500, fontSize: 14, lineHeight: '24px', color: 'rgba(0,0,0,0.66)', margin: 0, maxWidth: 540 }}>
        의료용 등급 센서를 헤드밴드 한 줄에 담았습니다. 5가지 컬러, 가벼운 무게로 누구나 부담 없이 착용합니다.
      </p>
      <div style={{ marginTop: 26, borderRadius: 22, overflow: 'hidden' }}>
        <img src={`${ASSET}/images/feature_link_headbands.png`} alt="" style={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', display: 'block' }} />
      </div>
      <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 0 }}>
        {specs.map((s, i) => (
          <div key={s.k} style={{ display: 'grid', gridTemplateColumns: '84px 1fr', gap: 14, padding: '14px 0', borderTop: '1px solid #E8E4F0', borderRight: i % 2 === 0 ? '1px solid #E8E4F0' : '0', paddingRight: i % 2 === 0 ? 24 : 0, paddingLeft: i % 2 === 1 ? 24 : 0 }}>
            <span style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#6F6F6F', paddingTop: 3 }}>{s.k}</span>
            <span style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 600, fontSize: 13, color: '#1F1F1F', letterSpacing: '-0.008em', lineHeight: '20px' }}>{s.v}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 'auto', background: '#F5EDFC', borderRadius: 16, padding: 18, display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 14, color: '#5F0080' }}>함께 제공되는 명상 콘텐츠 200+</div>
          <div style={{ fontFamily: 'var(--mb-font-text)', fontWeight: 500, fontSize: 12, color: 'rgba(0,0,0,0.7)', marginTop: 4, lineHeight: '18px' }}>
            마음챙김 입문 · 직장인 스트레스 케어 · 수면 호흡 · 청소년 집중력 등 8개 카테고리
          </div>
        </div>
        <span style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 11, color: '#5F0080', fontWeight: 700, letterSpacing: '0.06em' }}>→ p.06</span>
      </div>
    </DocPage>
  );
}

function FeatureGridPage() {
  const steps = [
    { n: '01', title: '기기 등록', body: '지도사 앱에서 LINK BAND를 등록하고 참여자와 페어링합니다.', img: 'device_register.png' },
    { n: '02', title: '세션 진행', body: '오프라인·온라인 어디서든 실시간으로 뇌파를 측정합니다.', img: 'portrait_05_woman_sunset_white.png' },
    { n: '03', title: 'AI 분석', body: '룩시드랩스의 학습 모델로 휴식·집중·균형 지표를 자동 산출합니다.', img: null as string | null },
    { n: '04', title: '리포트 발급', body: '세션이 끝나면 두뇌건강 리포트가 자동 생성됩니다.', img: 'report_sample_1.png' },
  ];
  return (
    <DocPage chapter="03 · How it works" pageNo={5}>
      <div style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 11, letterSpacing: '0.14em', color: '#5F0080', fontWeight: 700 }}>SERVICE FLOW</div>
      <h2 style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 36, lineHeight: '44px', letterSpacing: '-0.024em', color: '#1F1F1F', margin: '10px 0 6px' }}>
        등록부터 리포트까지,
        <br />
        한 자리에서
      </h2>
      <p style={{ fontFamily: 'var(--mb-font-text)', fontWeight: 500, fontSize: 14, lineHeight: '24px', color: 'rgba(0,0,0,0.66)', margin: 0, maxWidth: 520 }}>
        지도사가 신경 써야 할 것은 명상의 흐름뿐. 나머지는 MIND BREEZE가 처리합니다.
      </p>
      <div style={{ marginTop: 30, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gridTemplateRows: '1fr 1fr', gap: 16, flex: 1 }}>
        {steps.map((s) => (
          <div key={s.n} style={{ background: '#FFFFFF', border: '1px solid #E8E4F0', borderRadius: 18, padding: 18, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 32, height: 32, borderRadius: 10, background: '#5F0080', color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mb-font-mono)', fontWeight: 800, fontSize: 12, letterSpacing: '0.04em' }}>{s.n}</span>
              <span style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 18, color: '#1F1F1F', letterSpacing: '-0.014em' }}>{s.title}</span>
            </div>
            <div style={{ height: 130, borderRadius: 12, overflow: 'hidden', background: '#F5EDFC', position: 'relative' }}>
              {s.img ? (
                <img src={`${ASSET}/images/${s.img}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              ) : (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 6, padding: 14 }}>
                  {[0.25, 0.42, 0.58, 0.36, 0.72, 0.55, 0.86, 0.62, 0.94, 0.78].map((v, i) => (
                    <div key={i} style={{ width: 14, height: `${v * 100}%`, borderRadius: '4px 4px 2px 2px', background: i < 3 ? '#D7BCEC' : i < 6 ? '#A775D6' : i < 9 ? '#7D3399' : '#5F0080' }} />
                  ))}
                </div>
              )}
            </div>
            <p style={{ fontFamily: 'var(--mb-font-text)', fontWeight: 500, fontSize: 12, lineHeight: '20px', color: 'rgba(0,0,0,0.66)', margin: 0 }}>{s.body}</p>
          </div>
        ))}
      </div>
    </DocPage>
  );
}

function StatsPage() {
  const big = [
    { n: '14', u: '건', l: '뇌파 관련 특허', sub: '출원 · 등록 누적' },
    { n: '2×', u: '회', l: 'CES 혁신상 수상', sub: '2018 최고혁신상 · 2022 혁신상' },
    { n: '27K', u: '건', l: '표준 뇌파 데이터', sub: '인지기능 측정 데이터셋' },
    { n: '10K', u: '시간', l: '기능적 뇌파 데이터', sub: '명상·집중·휴식 라벨링 완료' },
  ];
  return (
    <DocPage chapter="04 · Credibility" pageNo={6} bg="#FAFAFB">
      <div style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 11, letterSpacing: '0.14em', color: '#5F0080', fontWeight: 700 }}>BY THE NUMBERS</div>
      <h2 style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 36, lineHeight: '44px', letterSpacing: '-0.024em', color: '#1F1F1F', margin: '10px 0 8px' }}>
        10년의 연구가
        <br />
        증명하는 신뢰
      </h2>
      <p style={{ fontFamily: 'var(--mb-font-text)', fontWeight: 500, fontSize: 14, lineHeight: '24px', color: 'rgba(0,0,0,0.66)', margin: 0, maxWidth: 520 }}>
        룩시드랩스는 의료기관, 연구소, 기업과 함께 뇌파의 학술적 근거를 쌓아왔습니다. MIND BREEZE는 이 위에서 만들어집니다.
      </p>
      <div style={{ marginTop: 30, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
        {big.map((s) => (
          <div key={s.l} style={{ background: '#FFFFFF', border: '1px solid #E8E4F0', borderRadius: 18, padding: '22px 22px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 800, fontSize: 56, lineHeight: 1, color: '#5F0080', letterSpacing: '-0.04em' }}>{s.n}</div>
              <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 18, color: '#1F1F1F' }}>{s.u}</div>
            </div>
            <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 15, color: '#1F1F1F', marginTop: 14, letterSpacing: '-0.012em' }}>{s.l}</div>
            <div style={{ fontFamily: 'var(--mb-font-text)', fontWeight: 500, fontSize: 12, color: 'rgba(0,0,0,0.6)', marginTop: 3 }}>{s.sub}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 'auto', background: '#FFFFFF', border: '1px solid #E8E4F0', borderRadius: 18, padding: 18, display: 'grid', gridTemplateColumns: '180px 1fr', gap: 18, alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <img src={`${ASSET}/images/report_sample_1.png`} alt="" style={{ width: 78, height: 110, objectFit: 'cover', borderRadius: 6 }} />
          <img src={`${ASSET}/images/report_sample_2.png`} alt="" style={{ width: 78, height: 110, objectFit: 'cover', borderRadius: 6 }} />
        </div>
        <div>
          <div style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#5F0080', fontWeight: 700 }}>AI Report Sample</div>
          <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 16, color: '#1F1F1F', marginTop: 6 }}>휴식·집중·균형의 두뇌건강 리포트</div>
          <p style={{ fontFamily: 'var(--mb-font-text)', fontWeight: 500, fontSize: 12, lineHeight: '20px', color: 'rgba(0,0,0,0.6)', margin: '6px 0 0' }}>세션 종료 시점에 자동 발급.</p>
        </div>
      </div>
    </DocPage>
  );
}

function QuotePage() {
  const people = [
    { src: 'portrait_01_warm_sweater.png', label: '직장인', tag: '스트레스 관리' },
    { src: 'portrait_02_young_man_concrete.png', label: '청년', tag: '집중력 회복' },
    { src: 'portrait_04_young_man_warm.png', label: '대학생', tag: '수면의 질' },
    { src: 'portrait_05_woman_sunset_white.png', label: '프리랜서', tag: '감정 균형' },
  ];
  return (
    <DocPage chapter="05 · People" pageNo={7}>
      <div style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 11, letterSpacing: '0.14em', color: '#5F0080', fontWeight: 700 }}>MEDITATION FOR EVERYONE</div>
      <h2 style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 36, lineHeight: '44px', letterSpacing: '-0.024em', color: '#1F1F1F', margin: '10px 0 8px' }}>
        다양한 일상에 스며드는
        <br />
        과학적인 명상
      </h2>
      <p style={{ fontFamily: 'var(--mb-font-text)', fontWeight: 500, fontSize: 14, lineHeight: '24px', color: 'rgba(0,0,0,0.66)', margin: 0, maxWidth: 520 }}>
        직장인의 점심 휴식, 대학생의 시험 전 5분, 시니어의 아침 루틴 — 삶의 모양은 달라도 뇌가 쉬는 방식은 같습니다.
      </p>
      <div style={{ marginTop: 28, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {people.map((p) => (
          <figure key={p.src} style={{ margin: 0 }}>
            <div style={{ aspectRatio: '5 / 7', overflow: 'hidden', borderRadius: 14 }}>
              <img src={`${ASSET}/images/${p.src}`} alt={p.label} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            </div>
            <figcaption style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 13, color: '#1F1F1F', letterSpacing: '-0.01em' }}>{p.label}</span>
              <span style={{ fontFamily: 'var(--mb-font-text)', fontWeight: 500, fontSize: 11, color: 'rgba(0,0,0,0.5)' }}>{p.tag}</span>
            </figcaption>
          </figure>
        ))}
      </div>
      <div style={{ marginTop: 'auto', background: '#5F0080', color: '#FFFFFF', borderRadius: 22, padding: '32px 32px 28px', position: 'relative', overflow: 'hidden' }}>
        <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 800, fontSize: 80, lineHeight: 1, color: 'rgba(255,255,255,0.18)', position: 'absolute', top: 6, left: 24 }}>"</div>
        <blockquote style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 22, lineHeight: '32px', letterSpacing: '-0.018em', color: '#FFFFFF', margin: 0, position: 'relative', paddingLeft: 30 }}>
          이전엔 ‘오늘 명상이 잘 됐을까’ 라는 막연한 질문에 답하기 어려웠어요. 지금은 참여자분들과 데이터를 보며 진짜 대화가 시작됩니다.
        </blockquote>
        <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'linear-gradient(135deg,#FFC79A,#E6593D)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF', fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 14, border: '2px solid #FFFFFF' }}>김</div>
          <div>
            <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 14 }}>김지수</div>
            <div style={{ fontFamily: 'var(--mb-font-text)', fontWeight: 500, fontSize: 12, color: '#E2C9F0' }}>마인드브리즈 청담센터 · 지도사 4년차</div>
          </div>
        </div>
      </div>
    </DocPage>
  );
}

function BackCoverPage() {
  return (
    <DocPage hideChrome bleed bg="#5F0080" pageNo={null}>
      <img src={`${ASSET}/logo_symbol_dark.svg`} alt="" style={{ position: 'absolute', right: -120, bottom: -160, width: 720, opacity: 0.12, filter: 'brightness(0) invert(1)', transform: 'rotate(-6deg)' }} />
      <div style={{ position: 'absolute', top: 48, left: 48, display: 'flex', alignItems: 'center', gap: 12 }}>
        <img src={`${ASSET}/logo_symbol_dark.svg`} alt="" style={{ width: 38, height: 'auto', display: 'block', filter: 'brightness(0) invert(1)' }} />
        <span style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 600, fontSize: 17, lineHeight: 0.85, letterSpacing: '-0.025em', color: '#FFFFFF' }}>Mind&nbsp;Breeze</span>
      </div>
      <div style={{ position: 'absolute', left: 48, top: 240, right: 280 }}>
        <span style={{ display: 'inline-flex', padding: '6px 12px', borderRadius: 9999, background: 'rgba(255,255,255,0.16)', color: '#FFFFFF', fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 11, letterSpacing: '0.04em' }}>FOR INSTITUTIONS &amp; STUDIOS</span>
        <h2 style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 800, fontSize: 48, lineHeight: '60px', letterSpacing: '-0.03em', color: '#FFFFFF', margin: '20px 0 0' }}>
          과학적인 명상 클래스를
          <br />
          여러분의 공간에서
          <br />
          시작하세요
        </h2>
        <p style={{ fontFamily: 'var(--mb-font-text)', fontWeight: 500, fontSize: 15, lineHeight: '26px', color: '#E2C9F0', maxWidth: 460, margin: '20px 0 0' }}>
          기관 단위 도입, LINK BAND 패키지, 지도사 양성 프로그램까지 한 번에 안내해 드립니다.
        </p>
        <div style={{ display: 'flex', gap: 10, marginTop: 32 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', height: 48, padding: '0 22px', borderRadius: 14, background: '#FFFFFF', color: '#5F0080', fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 14 }}>도입 문의하기</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', height: 48, padding: '0 22px', borderRadius: 14, border: '1px solid rgba(255,255,255,0.4)', color: '#FFFFFF', fontFamily: 'var(--mb-font-sans)', fontWeight: 600, fontSize: 14 }}>지도사 안내서 받기 →</span>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 48, bottom: 48, right: 48, display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 32, color: '#FFFFFF', borderTop: '1px solid rgba(255,255,255,0.18)', paddingTop: 24 }}>
        {[
          { h: '회사', t: '주식회사 룩시드랩스', s: '서울특별시 성동구 성수일로 99\n가나스튜디오 5층' },
          { h: '연락처', t: 'contact@looxidlabs.com', s: '+82 02-1234-5678' },
          { h: '웹', t: 'mindbreeze.kr', s: 'looxidlabs.com' },
        ].map((c) => (
          <div key={c.h}>
            <div style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#C6AEF6' }}>{c.h}</div>
            <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 15, marginTop: 8 }}>{c.t}</div>
            <div style={{ fontFamily: 'var(--mb-font-text)', fontWeight: 500, fontSize: 12, lineHeight: '20px', color: '#E2C9F0', marginTop: 4, whiteSpace: 'pre-line' }}>{c.s}</div>
          </div>
        ))}
      </div>
      <div style={{ position: 'absolute', top: 48, right: 48, textAlign: 'right', color: '#FFFFFF' }}>
        <div style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 10, letterSpacing: '0.14em', color: '#C6AEF6' }}>PRODUCT BROCHURE</div>
        <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 13, marginTop: 4 }}>2026 · Edition 01</div>
      </div>
    </DocPage>
  );
}

export default function DocsPage() {
  return (
    <main style={{ minHeight: '100vh', background: '#EBE6E2', padding: '40px 32px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 32 }}>
      <CoverPage />
      <TOCPage />
      <SectionDividerPage />
      <ContentPage />
      <FeatureGridPage />
      <StatsPage />
      <QuotePage />
      <BackCoverPage />
    </main>
  );
}
