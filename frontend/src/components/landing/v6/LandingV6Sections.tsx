// 랜딩 v6 섹션 (SDD-248) — 승인 시안 design-v6/landing.html 의 카피·순서 그대로
import { Link } from 'react-router-dom';
import { isAiEnabled } from '../../../lib/feature-flags';
import { useInquiryModal, type InquiryCtaSource } from './use-inquiry-modal';

const IMG = '/landing-v6';

function InquiryCta({ source, className = 'btn btn-cta', children }: { source: InquiryCtaSource; className?: string; children: string }) {
  const { open } = useInquiryModal();
  return <button type="button" className={className} data-cta={source} onClick={() => open(source)}>{children}</button>;
}

interface RoleCard { label: string; title: string; sub: string; body: string; points: string[]; img: string; alt: string }
const ROLES: RoleCard[] = [
  { label: '01　기관', title: '운영의 흐름을 한눈에', sub: '사람과 일정이 연결되는 운영', body: '소속 지도자와 회원, 클래스 일정을 함께 관리하세요. 기관이 준비하는 여러 만남의 흐름을 살펴볼 수 있습니다.', points: ['지도자·회원 관리', '클래스 일정'], img: 'device-02', alt: '클래스 일정 대표 화면' },
  { label: '02　상담사 · 지도자', title: '함께하는 시간에 집중', sub: '수업의 준비와 진행을 한곳에서', body: '클래스 일정을 준비하고 회원과 소통하세요. LINK BAND를 연결한 참여자의 몸과 마음의 흐름도 함께 살펴볼 수 있습니다.', points: ['클래스 준비·진행', '회원과 소통', '선택형 신호 확인'], img: 'device-01', alt: '진행자의 회원별 흐름 화면' },
  { label: '03　회원', title: '오늘의 경험을 나의 기록으로', sub: '함께한 시간을 다시 돌아보세요', body: '초대나 입장 코드로 클래스에 참여하세요. 수업 후에는 자신의 클래스 기록과 제공된 리포트를 확인할 수 있습니다.', points: ['초대·코드 참여', '나의 기록', '제공된 리포트'], img: 'device-04', alt: '회원의 몸·마음 리포트 화면' },
];

const FAQS: ReadonlyArray<{ q: string; a: string }> = [
  { q: 'LINK BAND가 반드시 있어야 하나요?', a: '아니요. 밴드 없이도 클래스 참여, 기록, 제공된 리포트를 이용할 수 있습니다. 생체신호 항목은 측정 데이터가 있을 때만 표시됩니다.' },
  { q: '기관은 어떻게 시작하나요?', a: '기관 가입 문의에 운영 형태와 필요한 기능을 남겨 주세요. 회원은 기관이나 진행자의 초대 또는 입장 코드로 참여할 수 있습니다.' },
  { q: '앱 설치와 밴드 연결은 어떻게 하나요?', a: '웹에서도 이용할 수 있습니다. 웹 밴드 연결은 Web Bluetooth를 지원하는 Chrome·Edge를 이용하며 Safari·Firefox는 지원하지 않습니다. 운영체제와 기기의 Bluetooth 지원 여부도 확인해 주세요. 앱 다운로드는 각 스토어 공개 출시 후 안내합니다.' },
  { q: '내 정보의 보관·삭제 기준은 어디서 확인하나요?', a: '기록 종류와 이용 목적에 따라 기준이 다릅니다. 개인정보 처리방침과 계정 삭제 안내에서 상세 내용을 확인할 수 있습니다. 기관 문의로 제출한 개인정보의 보관 기간은 접수일로부터 1년입니다.' },
];

// AI 비공개(기본)에서는 AI 문구를 노출하지 않는다(기존 공개 문구 규칙). 켜진 경우 시안 원문 그대로.
const counselingFaq = (): { q: string; a: string } => isAiEnabled()
  ? { q: '1:1 상담과 AI 상담 기록도 이용할 수 있나요?', a: '1:1 상담과 AI 상담 기록·요약은 기관별 제공 범위를 먼저 확인해 주세요. 현재 공개 안내는 명상 클래스를 중심으로 합니다.' }
  : { q: '1:1 상담 기록도 이용할 수 있나요?', a: '1:1 상담 기능은 기관별 제공 범위를 먼저 확인해 주세요. 현재 공개 안내는 명상 클래스를 중심으로 합니다.' };

export function LandingV6Sections() {
  const faqs = [FAQS[0], FAQS[1], counselingFaq(), ...FAQS.slice(2)];
  return (
    <>
      {/* 01 히어로 */}
      <section className="hero" id="hero">
        <div className="wrap hero-grid">
          <div>
            <p className="eyebrow">mind breeze</p>
            <h1>마음을 돌보는 일,<br /><em>변화가 보이도록.</em></h1>
            <p className="lead">명상 클래스의 준비부터 기록까지, 한곳에서.</p>
            <p className="body">마인드브리즈는 기관과 진행자, 회원을 연결하는 명상·웰니스 플랫폼입니다. 클래스 일정과 소통, 수업 후 기록을 하나의 흐름으로 이어갑니다.</p>
            <div className="actions">
              <a className="btn btn-ghost" href="#roles">서비스 화면 살펴보기</a>
              <InquiryCta source="hero">기관 가입 문의</InquiryCta>
            </div>
          </div>
          <div className="visual">
            <div className="halo" />
            <img className="person" src={`${IMG}/hero.webp`} alt="눈을 감고 편안하게 자신의 호흡에 집중하는 사람" width={800} height={1118} />
            <span className="person-tag">기술이 돕고, 사람이 돌봅니다</span>
            <div className="story-note"><small>● BODY &amp; MIND</small><h3>작은 변화에도,<br />이야기가 있으니까.</h3><p>나를 이해하는 새로운 기록</p></div>
          </div>
        </div>
        <div className="wrap points"><span>01　클래스·일정 관리</span><span>02　몸·마음 서사형 리포트</span><span>03　LINK BAND 선택 연결</span></div>
      </section>

      <section className="anywhere" aria-label="이용 환경">
        <div className="wrap anywhere-in">
          <p><b>웹과 앱, 어디서나.</b> 노트북, 데스크톱, 모바일 어디서나 편리하게 회원과 만나고 관리합니다.</p>
          <ul className="chips"><li>웹 브라우저</li><li>iPhone</li><li>iPad</li><li>Android</li></ul>
        </div>
      </section>

      {/* 02 역할 */}
      <section className="roles section" id="roles">
        <div className="wrap">
          <div className="head-center">
            <p className="eyebrow">one service, three perspectives</p>
            <h2>각자의 역할에 맞게,<br />하나의 흐름으로.</h2>
            <p className="lead">기관의 운영, 상담사·지도자의 클래스, 회원의 기록을 이어줍니다.</p>
            <p className="body">같은 클래스를 함께해도 필요한 화면은 다릅니다. 각자의 역할에서 필요한 정보를 살피고, 준비부터 기록까지 연결하세요.</p>
          </div>
          <div className="role-grid">
            {ROLES.map((r) => (
              <article className="role-card" key={r.label}>
                <span className="role-label">{r.label}</span>
                <h3>{r.title}</h3>
                <p className="role-sub">{r.sub}</p>
                <p className="role-body">{r.body}</p>
                <div className="role-points">{r.points.map((p) => <span key={p}>{p}</span>)}</div>
                <div className="role-shot"><img className="device" src={`${IMG}/${r.img}.webp`} alt={r.alt} loading="lazy" decoding="async" width={864} height={1816} /></div>
              </article>
            ))}
          </div>
          <p className="screen-notice">화면은 예시 데이터입니다. 일부 화면은 앱 코드 기반의 정적 재현이며 실제 이용 화면과 다를 수 있습니다.</p>
          <div className="role-cta">
            <h3>“우리 기관에서는 어떻게 활용할 수 있을까요?”</h3>
            <InquiryCta source="roles">우리 기관의 이용 방식 문의하기</InquiryCta>
            <p>기관의 운영 형태와 필요한 기능을 알려 주세요.</p>
          </div>
        </div>
      </section>

      {/* 03 클래스 관리 */}
      <section className="apps section" id="apps">
        <div className="wrap split">
          <div className="copy">
            <p className="eyebrow">prepare your class</p>
            <h2>뇌과학 기반 클래스 관리</h2>
            <p className="lead">온라인과 대면, 목록부터 지난 회차까지</p>
            <p className="body">클래스 목록에서 다음 회차 일정을 확인하고, 온라인과 대면 클래스를 같은 흐름으로 운영하세요. 참여자는 입장 코드 하나로 바로 들어오고, 수업이 끝난 뒤에는 지난 회차의 기록을 이어서 볼 수 있습니다.</p>
            <ul className="feat">
              <li><b>클래스 목록·회차 일정</b><span>진행 중인 클래스와 다음 회차를 한 화면에서 확인</span></li>
              <li><b>온라인·대면 운영</b><span>클래스마다 진행 방식을 정해 같은 방식으로 관리</span></li>
              <li><b>입장 코드로 바로 참여</b><span>참여자는 안내받은 코드로 간편하게 입장</span></li>
              <li><b>지난 회차 기록 이어보기</b><span>회차별 기록과 리포트를 다음 만남에 참고</span></li>
            </ul>
          </div>
          <div className="stage"><img className="device" src={`${IMG}/device-home.webp`} alt="회원 앱 홈 화면: 코드로 바로 입장 버튼과 다음 일정 카드, 클래스 현황" width={468} height={984} loading="lazy" decoding="async" /></div>
        </div>
      </section>

      {/* 03-2 멀티디바이스 */}
      <section className="multi section" id="multidevice">
        <div className="wrap">
          <div className="head-center">
            <p className="eyebrow">web &amp; app, anywhere</p>
            <h2>노트북에서 관리하고,<br />휴대폰으로 함께합니다.</h2>
            <p className="lead">웹과 앱, 같은 계정으로 이어집니다.</p>
            <p className="body">상담사·지도자는 웹에서 클래스 일정·회차·회원·리포트를 넓은 화면으로 관리하고, 회원은 앱이나 웹 링크로 바로 참여합니다.</p>
          </div>
          <div className="multi-stage">
            <div className="laptop" role="img" aria-label="노트북 웹 브라우저에서 상담사가 명상 클래스 목록을 관리하는 화면">
              <div className="laptop-screen">
                <div className="chrome-bar"><i /><i /><i /><span>mindbreeze.looxidlabs.com</span></div>
                <img src={`${IMG}/web-classes.webp`} alt="" width={1600} height={1000} loading="lazy" decoding="async" />
              </div>
              <div className="laptop-base" />
            </div>
            <img className="multi-phone device" src={`${IMG}/device-home.webp`} alt="회원 앱 홈 화면: 다음 일정 카드와 코드로 바로 입장 버튼" width={468} height={984} loading="lazy" decoding="async" />
          </div>
          <ul className="multi-points">
            <li><b>설치 없이 웹 브라우저에서</b><span>링크만 열면 바로 시작</span></li>
            <li><b>넓은 화면의 일정·회원 관리</b><span>클래스·회차·회원을 한눈에</span></li>
            <li><b>앱 알림으로 다음 클래스 안내</b><span>일정 전에 알려 드려요</span></li>
            <li><b>같은 계정으로 어디서나 이어짐</b><span>웹에서 하던 일을 앱에서도</span></li>
          </ul>
          <p className="screen-notice">화면은 예시 데이터입니다. 실제 이용 화면과 다를 수 있습니다.</p>
        </div>
      </section>

      {/* 04 자연 */}
      <section className="nature" id="pause">
        <img src={`${IMG}/nature.webp`} alt="고요한 자연 풍경" width={1920} height={1152} loading="lazy" decoding="async" />
        <div><p className="nl">매일의 작은 기록이</p><h2>나를 만나는<br />시간이 되도록.</h2><p className="nb">함께한 시간의 경험을, 나를 돌아보는 기록으로 이어가세요.</p></div>
      </section>

      {/* 05 진행 */}
      <section className="signals section" id="signals">
        <div className="wrap split rev">
          <div className="copy">
            <p className="eyebrow">during the class</p>
            <h2>뇌파로 살피는 명상 상태</h2>
            <p className="lead">클래스 중 회원별 실시간 흐름을 한눈에</p>
            <p className="body">LINK BAND를 연결하면 수업 중 몸과 마음의 흐름을 함께 살펴볼 수 있어요. 연결과 측정 상태에 따라 표시되는 항목은 달라질 수 있습니다. 밴드 없이도 클래스에 참여할 수 있어요.</p>
            <div className="tags"><span>마음의 흐름 — 집중·이완·감정안정</span><span>몸의 흐름 — 심박·호흡·심박변이</span><span>밴드 연결은 선택</span></div>
          </div>
          <div className="stage"><img className="device" src={`${IMG}/device-01.webp`} alt="클래스 진행 중 참여자별 신호 흐름을 살펴보는 화면" width={864} height={1816} loading="lazy" decoding="async" /></div>
        </div>
      </section>

      {/* 06 리포트 */}
      <section className="reports section" id="reports">
        <div className="wrap split">
          <div className="copy">
            <p className="eyebrow">your experience, your story</p>
            <h2>나의 명상을 이야기로</h2>
            <p className="lead">몸과 마음의 변화를 이야기로 돌아봐요</p>
            <p className="body">그날의 경험과 전반·후반의 흐름을 함께 살펴보세요. 측정 데이터가 있을 때는 몸과 마음의 변화도 이야기로 확인할 수 있습니다. 밴드 없이도 클래스 기록과 제공된 리포트를 만날 수 있어요.</p>
            <div className="tags"><span>경험을 돌아보는 서사</span><span>전반·후반의 변화</span><span>다음 만남에 참고할 기록</span></div>
          </div>
          <div className="stage"><img className="device" src={`${IMG}/device-04.webp`} alt="몸과 마음의 변화 이야기를 담은 리포트 화면" width={864} height={1816} loading="lazy" decoding="async" /></div>
        </div>
      </section>

      {/* 07 중간 문의 띠 */}
      <section className="inquiry" id="inquiry">
        <div className="inquiry-box">
          <div>
            <p className="eyebrow">bring it to your team</p>
            <h2>우리 기관의 다음 클래스,<br />마인드브리즈와 함께 준비해 보세요.</h2>
            <p className="lead">운영 방식에 맞는 시작을 함께 살펴봅니다.</p>
            <p className="body">기관의 유형과 예상 이용 규모, 필요한 기능을 알려 주세요.</p>
          </div>
          <div className="inquiry-act"><InquiryCta source="mid">기관 도입 문의하기</InquiryCta></div>
        </div>
      </section>

      {/* 08 LINK BAND */}
      <section className="band-sec" id="band">
        <div className="wrap section split">
          <div className="band-img"><img src={`${IMG}/band.webp`} alt="LINK BAND 2.0 제품과 센서" width={1200} height={752} loading="lazy" decoding="async" /></div>
          <div>
            <p className="eyebrow">meet link band</p>
            <h2>몸의 신호도 함께,<br />연결은 나의 선택으로.</h2>
            <p className="lead">LINK BAND 없이도 마인드브리즈를 이용할 수 있습니다.</p>
            <p className="body">LINK BAND는 머리에 착용하는 생체신호 센서입니다. 연결하면 뇌파와 맥파, 움직임을 통해 수업 속 변화를 살펴보는 단서를 더할 수 있습니다. 밴드 없이도 클래스·기록·제공된 리포트를 이용할 수 있습니다.</p>
            <div className="tags"><span>EEG · 뇌파</span><span>PPG · 맥파</span><span>ACC · 움직임</span></div>
            <div className="note-link"><a className="textlink" href="https://linkband.looxidlabs.com/ko" target="_blank" rel="noopener noreferrer">LINK BAND 제품 안내 ↗<span className="sr-only"> 새 창</span></a></div>
          </div>
        </div>
      </section>

      {/* 09 이용 과정 */}
      <section className="journey section" id="journey">
        <div className="wrap">
          <div className="head-center">
            <p className="eyebrow">from class to record</p>
            <h2>시작은 가볍게.<br />기록은 다음 만남까지.</h2>
            <p className="lead">준비하고, 함께하고, 다시 돌아보는 흐름.</p>
            <p className="body">진행자는 클래스와 일정을 준비하고, 회원은 초대나 입장 코드로 참여합니다. 수업 전 안내와 동의를 확인한 뒤 함께하는 시간에 집중하세요. 수업 후에는 제공된 기록과 리포트를 돌아보고 채팅으로 대화를 이어갈 수 있습니다.</p>
          </div>
          <ol className="steps">
            <li><span>01　준비</span><h3>일정·입장 안내·동의 확인</h3></li>
            <li><span>02　참여</span><h3>수업 진행·선택형 밴드 연결</h3></li>
            <li><span>03　돌아보기</span><h3>기록·리포트·채팅</h3></li>
          </ol>
          <div className="phones">
            <figure><img className="device" src={`${IMG}/device-05.webp`} alt="클래스 시작을 기다리는 화면" width={864} height={1816} loading="lazy" decoding="async" /><figcaption>대기실</figcaption></figure>
            <figure><img className="device" src={`${IMG}/device-03.webp`} alt="수업 전후 대화를 나누는 채팅 화면" width={864} height={1816} loading="lazy" decoding="async" /><figcaption>채팅</figcaption></figure>
          </div>
        </div>
      </section>

      {/* 09-2 다운로드 */}
      <section className="download section" id="download">
        <div className="wrap">
          <div className="head-center">
            <p className="eyebrow">get started</p>
            <h2>앱으로도, 웹에서도.<br />편한 곳에서 시작하세요.</h2>
            <p className="lead">두 경로 모두 같은 계정으로 이용합니다.</p>
          </div>
          <div className="dl-grid">
            <div className="dl-card">
              <span className="role-label">앱 다운로드</span><h3>iPhone · iPad · Android</h3><p>알림을 받고 클래스에 바로 참여하세요.</p>
              <div className="badges">
                <div className="badge-item"><span className="badge" role="img" aria-label="App Store에서 다운로드 (곧 출시)"><img src={`${IMG}/badge-appstore-ko.svg`} alt="App Store에서 다운로드" height={48} /></span><small>곧 출시</small></div>
                <div className="badge-item"><span className="badge" role="img" aria-label="Google Play에서 다운로드 (곧 출시)"><img src={`${IMG}/badge-googleplay-ko.png`} alt="Google Play에서 다운로드" height={48} /></span><small>곧 출시</small></div>
              </div>
            </div>
            <div className="dl-card">
              <span className="role-label">웹</span><h3>노트북 · 데스크톱 브라우저</h3><p>설치 없이 로그인하거나 입장 코드로 바로 참여하세요.</p>
              <div className="web-act"><Link className="btn btn-cta" to="/login">웹에서 바로 시작하기 →</Link></div>
            </div>
          </div>
          <p className="dev-note">웹 밴드 연결은 Chrome·Edge에서 지원합니다. iPhone·iPad·Android 앱의 공개 다운로드는 스토어 출시 후 안내합니다.</p>
        </div>
      </section>

      {/* 10 선택과 개인정보 */}
      <section className="trust section" id="trust">
        <div className="wrap">
          <div className="head-center">
            <p className="eyebrow">your choice, your information</p>
            <h2>무엇을 기록할지,<br />먼저 확인하고 시작하세요.</h2>
            <p className="lead">기록과 측정, 정보 이용의 안내를 확인할 수 있습니다.</p>
            <p className="body">클래스 기록에 필요한 안내와 동의를 확인하고 참여합니다. 생체신호 측정과 연구 활용은 각각의 안내와 선택을 확인해 주세요. 기록 종류별 보관·삭제 기준은 개인정보 처리방침에서 확인할 수 있습니다.</p>
          </div>
          <ul className="trust-grid">
            <li><span>01</span><h3>LINK BAND 착용은 선택</h3></li>
            <li><span>02</span><h3>기록·측정·연구 활용의 동의 구분</h3></li>
            <li><span>03</span><h3>보관·삭제 기준 확인</h3></li>
          </ul>
          <p className="fixed-note">마인드브리즈는 명상·웰니스 서비스입니다. 측정 정보는 자기 이해를 위한 참고 자료입니다.</p>
          <div className="links"><Link className="textlink" to="/privacy">개인정보 처리방침</Link><Link className="textlink" to="/account-deletion">계정 삭제 안내</Link></div>
        </div>
      </section>

      {/* 11 FAQ */}
      <section className="faq section" id="faq">
        <div className="wrap faq-grid">
          <div>
            <p className="eyebrow">before you begin</p>
            <h2>시작하기 전,<br />궁금한 이야기.</h2>
            <p className="lead">기관에서 도입을 살펴볼 때 필요한 안내입니다.</p>
            <p className="body">이용 환경과 기능 제공 범위를 확인해 주세요. 기관별 이용 조건은 기관 가입 문의로 남길 수 있습니다.</p>
          </div>
          <div className="faq-list">
            {faqs.map((f) => <details key={f.q}><summary>{f.q}<span aria-hidden="true">+</span></summary><p>{f.a}</p></details>)}
          </div>
        </div>
      </section>

      {/* 12 기관 가입 문의 안내 */}
      <section className="contact section" id="contact">
        <div className="wrap contact-short">
          <p className="eyebrow">start with your organization</p>
          <h2>우리 기관에 맞는 시작,<br />함께 살펴볼까요?</h2>
          <p className="lead">기관 가입과 도입에 필요한 안내를 요청하세요.</p>
          <p className="body">기관의 운영 형태와 필요한 기능을 알려 주세요. 남겨주신 연락처로 기관 가입과 이용에 관한 안내를 드립니다.</p>
          <InquiryCta source="contact">문의하기</InquiryCta>
        </div>
      </section>
    </>
  );
}

export default LandingV6Sections;
