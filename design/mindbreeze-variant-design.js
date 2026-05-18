import React, { useState, useEffect, useRef } from 'react';

const App = () => {
  const [theme, setTheme] = useState('dark');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const webglContainerRef = useRef(null);
  const materialRef = useRef(null);
  const targetMouseRef = useRef({ x: 0.5, y: 0.5 });

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Space+Grotesk:wght@300;400;500;600&display=swap');
      
      * { box-sizing: border-box; margin: 0; padding: 0; }
      
      body {
        font-family: 'Space Grotesk', sans-serif;
        overflow: hidden;
        -webkit-font-smoothing: antialiased;
      }

      input::placeholder { color: rgba(123, 47, 255, 0.4); }

      .btn-sso-google:hover { background-color: #f5f5f5 !important; transform: translateY(-2px); }
      .btn-sso-kakao:hover { background-color: #f0d800 !important; transform: translateY(-2px); }

      .btn-primary-login:hover {
        transform: translateY(-2px);
        filter: brightness(1.1);
      }

      .theme-toggle-btn:hover {
        border-color: #FFD580 !important;
      }

      input:focus {
        outline: none;
      }

      .tech-label {
        position: absolute;
        font-family: 'JetBrains Mono', monospace;
        font-size: 10px;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        z-index: 20;
      }
    `;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);

  useEffect(() => {
    const container = webglContainerRef.current;
    if (!container || typeof window === 'undefined') return;

    let THREE;
    try {
      THREE = window.THREE;
    } catch (e) {
      return;
    }

    if (!THREE) return;

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 1;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const geometry = new THREE.PlaneGeometry(2, 2);

    const vertexShader = `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position, 1.0);
      }
    `;

    const fragmentShader = `
      uniform float u_time;
      uniform vec2 u_resolution;
      uniform vec2 u_mouse;
      uniform vec3 u_colorCore;
      uniform vec3 u_colorFringe;
      uniform float u_isLightMode;
      varying vec2 vUv;

      vec2 hash( vec2 p ) {
        p = vec2( dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3)) );
        return -1.0 + 2.0*fract(sin(p)*43758.5453123);
      }
      float noise( in vec2 p ) {
        const float K1 = 0.366025404;
        const float K2 = 0.211324865;
        vec2 i = floor( p + (p.x+p.y)*K1 );
        vec2 a = p - i + (i.x+i.y)*K2;
        vec2 o = (a.x>a.y) ? vec2(1.0,0.0) : vec2(0.0,1.0);
        vec2 b = a - o + K2;
        vec2 c = a - 1.0 + 2.0*K2;
        vec3 h = max( 0.5-vec3(dot(a,a), dot(b,b), dot(c,c) ), 0.0 );
        vec3 n = h*h*h*h*vec3( dot(a,hash(i+0.0)), dot(b,hash(i+o)), dot(c,hash(i+1.0)));
        return dot( n, vec3(70.0) );
      }

      float sdArc(vec2 p, vec2 center, float radius, float width, float warp) {
        p.y += sin(p.x * 3.0 + u_time * 0.5) * warp;
        p.x += noise(p * 2.0 + u_time * 0.2) * (warp * 0.5);
        float d = length(p - center) - radius;
        return abs(d) - width;
      }

      void main() {
        vec2 uv = gl_FragCoord.xy / u_resolution.xy;
        vec2 st = uv;
        st.x *= u_resolution.x / u_resolution.y;
        vec2 mouseOffset = (u_mouse - 0.5) * 0.1;
        st += mouseOffset;

        vec2 center = vec2(u_resolution.x / u_resolution.y - 0.2, 0.5);
        float d1 = sdArc(st, center, 0.8, 0.01, 0.1);
        float d2 = sdArc(st, center, 0.82, 0.04, 0.15);
        
        float coreGlow = exp(-d1 * 40.0);
        float fringeGlow = exp(-d2 * 15.0);
        float wash = smoothstep(1.0, -0.2, st.x) * 0.3;

        vec3 finalColor = vec3(0.0);
        finalColor += u_colorCore * coreGlow;
        finalColor += u_colorFringe * fringeGlow;
        finalColor += u_colorFringe * wash * (sin(u_time) * 0.1 + 0.9);

        float alpha = clamp(coreGlow + fringeGlow + wash, 0.0, 1.0);
        finalColor = vec3(1.0) - exp(-finalColor * 2.0);
        
        if(u_isLightMode > 0.5) {
          alpha = clamp((coreGlow * 1.5 + fringeGlow + wash * 0.5), 0.0, 0.6);
        }

        gl_FragColor = vec4(finalColor, alpha);
      }
    `;

    const isDark = theme === 'dark';
    const coreColor = isDark ? new THREE.Color('#FFD580') : new THREE.Color('#7B2FFF');
    const fringeColor = isDark ? new THREE.Color('#7B2FFF') : new THREE.Color('#FFD580');

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        u_time: { value: 0.0 },
        u_resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
        u_mouse: { value: new THREE.Vector2(0.5, 0.5) },
        u_colorCore: { value: coreColor },
        u_colorFringe: { value: fringeColor },
        u_isLightMode: { value: isDark ? 0.0 : 1.0 }
      },
      transparent: true,
      blending: THREE.AdditiveBlending
    });

    materialRef.current = material;

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    const handleMouseMove = (e) => {
      targetMouseRef.current = {
        x: e.clientX / window.innerWidth,
        y: 1.0 - (e.clientY / window.innerHeight)
      };
    };
    document.addEventListener('mousemove', handleMouseMove);

    let animFrameId;
    const clock = new THREE.Clock();
    const currentMouse = new THREE.Vector2(0.5, 0.5);

    const animate = () => {
      animFrameId = requestAnimationFrame(animate);
      const elapsedTime = clock.getElapsedTime();
      material.uniforms.u_time.value = elapsedTime;
      const target = targetMouseRef.current;
      currentMouse.x += (target.x - currentMouse.x) * 0.05;
      currentMouse.y += (target.y - currentMouse.y) * 0.05;
      material.uniforms.u_mouse.value.set(currentMouse.x, currentMouse.y);
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      renderer.setSize(w, h);
      material.uniforms.u_resolution.value.set(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animFrameId);
      document.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  useEffect(() => {
    if (!materialRef.current || !window.THREE) return;
    const THREE = window.THREE;
    const isDark = theme === 'dark';
    materialRef.current.uniforms.u_colorCore.value = isDark
      ? new THREE.Color('#FFD580')
      : new THREE.Color('#7B2FFF');
    materialRef.current.uniforms.u_colorFringe.value = isDark
      ? new THREE.Color('#7B2FFF')
      : new THREE.Color('#FFD580');
    materialRef.current.uniforms.u_isLightMode.value = isDark ? 0.0 : 1.0;
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  const isDark = theme === 'dark';

  const bgBase = isDark ? '#07030F' : '#F9F7FF';
  const bgSurface1 = isDark ? 'rgba(123, 47, 255, 0.05)' : 'rgba(123, 47, 255, 0.04)';
  const bgSurface2 = isDark ? 'rgba(123, 47, 255, 0.1)' : 'rgba(123, 47, 255, 0.08)';
  const bgSurface3 = isDark ? 'rgba(123, 47, 255, 0.18)' : 'rgba(123, 47, 255, 0.15)';
  const textPrimary = isDark ? '#FFFFFF' : '#07030F';
  const textSecondary = isDark ? 'rgba(255,255,255,0.6)' : 'rgba(7,3,15,0.6)';
  const textTech = '#7B2FFF';
  const bgAccent = isDark ? '#FFD580' : '#07030F';

  const handleSubmit = (e) => {
    e.preventDefault();
  };

  return (
    <div style={{
      fontFamily: "'Space Grotesk', sans-serif",
      backgroundColor: bgBase,
      color: textPrimary,
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      transition: 'background-color 0.6s cubic-bezier(0.16, 1, 0.3, 1), color 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
      position: 'relative',
      WebkitFontSmoothing: 'antialiased',
    }}>
      {/* WebGL Background */}
      <div
        ref={webglContainerRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          zIndex: 0,
          pointerEvents: 'none',
        }}
      />

      {/* Top Bar */}
      <div style={{
        position: 'absolute',
        top: 48,
        right: 48,
        zIndex: 20,
        display: 'flex',
        gap: 16,
        alignItems: 'center',
      }}>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 12,
          color: textTech,
          display: 'flex',
          alignItems: 'center',
        }}>V03.01</div>
        <button
          className="theme-toggle-btn"
          onClick={toggleTheme}
          style={{
            height: 40,
            padding: '0 16px',
            backgroundColor: bgSurface2,
            color: textPrimary,
            gap: 8,
            fontSize: 13,
            backdropFilter: 'blur(10px)',
            border: `1px solid rgba(123, 47, 255, 0.1)`,
            borderRadius: 999,
            cursor: 'pointer',
            fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background-color 0.3s ease, transform 0.2s ease',
          }}
        >
          <i className={isDark ? 'ph ph-moon' : 'ph ph-sun'} style={{ fontSize: 16 }}></i>
          <span style={{ marginLeft: 8 }}>{isDark ? 'DARK' : 'LIGHT'}</span>
        </button>
      </div>

      {/* Tech Labels */}
      <div className="tech-label" style={{
        top: 48,
        left: 48,
        color: textTech,
        transition: 'color 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
      }}>SYS.CORE // ON-LINE</div>

      <div className="tech-label" style={{
        bottom: 48,
        left: 48,
        color: textTech,
        transition: 'color 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
      }}>UPLINK_ESTABLISHED_</div>

      <div style={{
        position: 'absolute',
        top: '50%',
        right: 48,
        transform: 'translateY(-50%) rotate(90deg)',
        transformOrigin: 'center right',
        display: 'flex',
        gap: 24,
        alignItems: 'center',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10,
        letterSpacing: '0.2em',
        color: textTech,
        textTransform: 'uppercase',
        zIndex: 20,
      }}>
        <span style={{ opacity: 0.5 }}>[</span>
        <span>TELE</span>
        <span>=</span>
        <span>PROMPT</span>
        <span>-3R</span>
        <span style={{ opacity: 0.5 }}>]</span>
      </div>

      {/* Layout Grid */}
      <div style={{
        position: 'relative',
        zIndex: 10,
        width: '100%',
        maxWidth: 1440,
        height: '100vh',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        padding: 48,
        alignItems: 'center',
      }}>

        {/* Left Brand Panel */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          height: '100%',
          padding: '48px 64px',
          color: textPrimary,
        }}>
          <div>
            {/* Logo */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 64 }}>
              <div style={{
                width: 40,
                height: 40,
                background: 'rgba(255,255,255,0.15)',
                borderRadius: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backdropFilter: 'blur(10px)',
              }}>
                <i className="ph ph-brain" style={{ fontSize: 24, color: '#FFD580' }}></i>
              </div>
              <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: '0.1em' }}>MIND BREEZE</span>
            </div>

            {/* Title */}
            <h1 style={{
              fontSize: 42,
              fontWeight: 700,
              lineHeight: 1.3,
              marginBottom: 24,
              letterSpacing: '-0.02em',
              color: textPrimary,
            }}>
              마음의 평화를<br />과학으로 만나다
            </h1>

            {/* Description */}
            <p style={{
              fontSize: 15,
              lineHeight: 1.7,
              opacity: 0.85,
              marginBottom: 40,
              maxWidth: 380,
              color: textPrimary,
            }}>
              AI 기반 자동 기록과 뇌파 분석으로<br />상담사와 내담자 모두를 위한 통합 멘탈 케어 플랫폼
            </p>

            {/* Features */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {[
                { icon: 'ph ph-mic', text: 'AI 자동 기록 · 요약 · 리포트 생성' },
                { icon: 'ph ph-wave-sine', text: 'LINK BAND 실시간 뇌파 모니터링' },
                { icon: 'ph ph-calendar-check', text: '세션 관리 · 예약 · 내담자 관리' },
              ].map((feature, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 32,
                    height: 32,
                    background: 'rgba(255,255,255,0.1)',
                    borderRadius: 8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <i className={feature.icon} style={{ fontSize: 16, color: '#FFD580' }}></i>
                  </div>
                  <span style={{ fontSize: 13, opacity: 0.9, color: textPrimary }}>{feature.text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div style={{
            fontSize: 11,
            opacity: 0.5,
            fontFamily: "'JetBrains Mono', monospace",
            color: textPrimary,
          }}>
            © 2026 MIND BREEZE · Powered by Lookit Labs
          </div>
        </div>

        {/* Right Auth Panel */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          paddingLeft: 0,
        }}>
          <div style={{
            width: '100%',
            maxWidth: 440,
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            borderRadius: 48,
            padding: 48,
            display: 'flex',
            flexDirection: 'column',
            gap: 32,
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            boxShadow: '0 25px 80px -20px rgba(107, 33, 168, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.5)',
            border: '1px solid rgba(255, 213, 128, 0.05)',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <h1 style={{
                fontSize: 28,
                fontWeight: 700,
                marginBottom: 8,
                color: '#07030F',
                letterSpacing: '-0.02em',
                lineHeight: 1.1,
              }}>로그인</h1>
              <p style={{ color: 'rgba(7,3,15,0.6)', fontSize: 14, fontWeight: 400 }}>
                MIND BREEZE에 오신 것을 환영합니다
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: 12, fontWeight: 500, color: textTech, paddingLeft: 16 }}>
                  이메일
                </label>
                <input
                  type="email"
                  placeholder="name@example.com"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onFocus={() => setEmailFocused(true)}
                  onBlur={() => setEmailFocused(false)}
                  style={{
                    width: '100%',
                    padding: '0 24px',
                    height: 56,
                    border: 'none',
                    outline: 'none',
                    borderRadius: 999,
                    backgroundColor: emailFocused ? 'rgba(123, 47, 255, 0.15)' : 'rgba(123, 47, 255, 0.08)',
                    color: '#07030F',
                    fontFamily: "'Space Grotesk', sans-serif",
                    fontSize: 15,
                    transition: 'background-color 0.3s ease',
                    boxShadow: emailFocused ? '0 0 0 1px rgba(255, 213, 128, 0.2)' : 'none',
                  }}
                />
              </div>

              <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingLeft: 16 }}>
                  <label style={{ fontSize: 12, fontWeight: 500, color: textTech }}>
                    비밀번호
                  </label>
                  <a href="#" style={{ fontSize: 11, color: textTech, textDecoration: 'none', opacity: 0.7 }}
                    onClick={(e) => e.preventDefault()}>
                    비밀번호를 잊으셨나요?
                  </a>
                </div>
                <input
                  type="password"
                  placeholder="••••••••"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setPasswordFocused(true)}
                  onBlur={() => setPasswordFocused(false)}
                  style={{
                    width: '100%',
                    padding: '0 24px',
                    height: 56,
                    border: 'none',
                    outline: 'none',
                    borderRadius: 999,
                    backgroundColor: passwordFocused ? 'rgba(123, 47, 255, 0.15)' : 'rgba(123, 47, 255, 0.08)',
                    color: '#07030F',
                    fontFamily: "'Space Grotesk', sans-serif",
                    fontSize: 15,
                    transition: 'background-color 0.3s ease',
                    boxShadow: passwordFocused ? '0 0 0 1px rgba(255, 213, 128, 0.2)' : 'none',
                  }}
                />
              </div>

              <button
                type="submit"
                className="btn-primary-login"
                style={{
                  height: 64,
                  background: 'linear-gradient(135deg, #6B21A8 0%, #A855F7 100%)',
                  color: '#FFD580',
                  fontSize: 16,
                  letterSpacing: '0.02em',
                  marginTop: 8,
                  boxShadow: '0 10px 40px -10px rgba(107, 33, 168, 0.5)',
                  border: 'none',
                  outline: 'none',
                  borderRadius: 999,
                  cursor: 'pointer',
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease',
                }}
              >
                로그인 <i className="ph ph-arrow-right" style={{ marginLeft: 8, fontSize: 20 }}></i>
              </button>
            </form>

            {/* Divider */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              color: textTech,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}>
              <span style={{ flex: 1, height: 1, backgroundColor: 'rgba(123, 47, 255, 0.1)' }}></span>
              또는
              <span style={{ flex: 1, height: 1, backgroundColor: 'rgba(123, 47, 255, 0.1)' }}></span>
            </div>

            {/* SSO Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
              <button
                className="btn-sso-google"
                aria-label="Sign in with Google"
                onClick={() => {}}
                style={{
                  height: 56,
                  background: '#fff',
                  color: '#333',
                  border: '1px solid #e0e0e0',
                  borderRadius: 999,
                  cursor: 'pointer',
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 14,
                  transition: 'background-color 0.3s ease, transform 0.2s ease',
                }}
              >
                <i className="ph-fill ph-google-logo" style={{ marginRight: 8, fontSize: 20 }}></i> Google
              </button>
              <button
                className="btn-sso-kakao"
                aria-label="Sign in with Kakao"
                onClick={() => {}}
                style={{
                  height: 56,
                  background: '#FEE500',
                  color: '#3C1E1E',
                  border: 'none',
                  borderRadius: 999,
                  cursor: 'pointer',
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 14,
                  transition: 'background-color 0.3s ease, transform 0.2s ease',
                }}
              >
                <i className="ph-fill ph-chat-circle-fill" style={{ marginRight: 8, fontSize: 20 }}></i> 카카오
              </button>
            </div>

            {/* Sign up */}
            <p style={{ textAlign: 'center', fontSize: 13, color: 'rgba(7,3,15,0.6)', marginTop: 8 }}>
              아직 계정이 없으신가요?{' '}
              <a
                href="#"
                onClick={(e) => e.preventDefault()}
                style={{ color: textTech, textDecoration: 'none', fontWeight: 600 }}
              >
                회원가입
              </a>
            </p>
          </div>
        </div>
      </div>

      {/* Load Phosphor Icons */}
      <script src="https://unpkg.com/@phosphor-icons/web" async></script>
      {/* Load Three.js */}
      <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r134/three.min.js" async></script>
    </div>
  );
};

export default App;