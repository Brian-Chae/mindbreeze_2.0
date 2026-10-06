// 테스트 하네스 호환: 기본은 node:test(`node --test tests/*.test.cjs`)로 실행한다.
// vitest(`npx vitest run`)는 CJS 파일에서 require('vitest') 를 지원하지 않으므로
// vite.config.ts 의 `test.globals=true` 가 주입한 전역 test 를 사용한다.
//
// TQ-05: 기존에는 DSP 파이프라인 전체(노치/밴드패스 필터·SQI·파워스펙트럼·밴드파워)를
// 스텁으로 덮어쓰고, 그 모의 밴드파워로 기대 지수값을 테스트 안에서 다시 계산해 비교하는
// 자기충족 단언이었다. 이제 **실 파이프라인을 결정적 합성 신호로 통과**시키고:
//   · 지수 정본 수식은 실제 계산 메서드를 손 계산 기대값과 대조하고,
//   · 필터·SQI·스펙트럼·병합은 스텁 없이 실 구현으로 검증하며,
//   · 분석적 기대값(진폭² 비례 FAA, DC 제거)과 대조한다.
const test = process.env.VITEST && typeof globalThis.test === 'function'
  ? globalThis.test
  : require('node:test').test;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

/**
 * biquadjs 의 package.json `main`(dist/BiquadFilters.js)은 export 없는 IIFE 라 Node 의
 * require/import 로는 named export 를 얻지 못한다(브라우저는 `module` 필드의 ESM 을 쓴다).
 * 프로덕션 필터 경로를 그대로 검증하기 위해 ESM 빌드를 CJS 로 주입한 뒤 모듈을 로드한다.
 */
function withRealBiquadFilters(fn) {
  const mainPath = require.resolve('biquadjs');
  const esmPath = path.join(path.dirname(mainPath), 'BiquadFilters.esm.js');
  const source = fs.readFileSync(esmPath, 'utf8').replace(/export\{([^}]*)\};?\s*$/s, (match, body) => {
    const pairs = body
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const alias = entry.match(/^(\S+)\s+as\s+(\S+)$/);
        return alias ? `${alias[2]}:${alias[1]}` : `${entry}:${entry}`;
      });
    return `module.exports = {${pairs.join(',')}};`;
  });
  const shim = new Module(esmPath, null);
  shim.filename = esmPath;
  shim.paths = Module._nodeModulePaths(path.dirname(esmPath));
  shim._compile(source, esmPath);
  const previous = Module._cache[mainPath];
  Module._cache[mainPath] = shim;
  try {
    return fn();
  } finally {
    if (previous) Module._cache[mainPath] = previous;
    else delete Module._cache[mainPath];
  }
}

function loadProcessor(name) {
  const filename = path.resolve(__dirname, '../src/lib/eeg', `${name}.ts`);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod._compile(compiled.outputText, filename);
  return mod.exports[name];
}

// 모듈 로드 시점에 biquadjs named export 를 실제 구현으로 고정한다(DSP 스텁 없음).
const { EEGSignalProcessor, PPGSignalProcessor } = withRealBiquadFilters(() => ({
  EEGSignalProcessor: loadProcessor('EEGSignalProcessor'),
  PPGSignalProcessor: loadProcessor('PPGSignalProcessor'),
}));

const SAMPLE_RATE = 250;
const near = (actual, expected, tolerance = 1e-8) =>
  assert.ok(
    Number.isFinite(actual) && Math.abs(actual - expected) < tolerance,
    `${actual} ≉ ${expected} (tol ${tolerance})`,
  );

/** 결정적 합성 EEG — 채널별 주파수 성분 합(진폭 μV). 실 파이프라인을 그대로 통과시킨다. */
function synthEeg(components, { samples = 1000, dc = 0 } = {}) {
  return Array.from({ length: samples }, (_, i) => {
    const t = i / SAMPLE_RATE;
    const channel = (list) =>
      list.reduce((sum, tone) => sum + tone.a * Math.sin(2 * Math.PI * tone.f * t + (tone.phase ?? 0)), 0) + dc;
    return { timestamp: i * 4, fp1: channel(components.fp1), fp2: channel(components.fp2) };
  });
}

const processEeg = (components, options) =>
  new EEGSignalProcessor().processEEGData(synthEeg(components, options));

const ALPHA_40 = { f: 10, a: 40 };
const ALPHA_20 = { f: 10, a: 20 };
const BETA_40 = { f: 20, a: 40 };

// ── 1. 실 파이프라인: 지수 ↔ 반환 밴드파워 계약 ─────────────────────────────
test('실 파이프라인: 지수는 반환된 밴드파워와 정본 계약을 일치한다', async () => {
  const { indices, bandPowers } = await processEeg({ fp1: [ALPHA_40], fp2: [ALPHA_20] });
  const { alpha, beta, theta, gamma } = bandPowers;
  assert.ok(alpha > 0 && beta > 0, '실 파이프라인이 알파/베타 파워를 산출해야 한다');

  near(indices.relaxationIndex, alpha / (alpha + beta), 1e-8);
  near(indices.focusIndex, beta / (alpha + theta), 1e-8);
  near(indices.stressIndex, (beta + gamma) / (alpha + theta), 1e-8);
  // EEG-NUM-001: 인지 부하 = 전두엽 θ/α 비율
  near(indices.cognitiveLoad, theta / (alpha + 1e-10), 1e-9);
  near(indices.emotionalStability, (alpha + theta) / (gamma + 1e-10), 1e-6);
  near(indices.totalPower, indices.totalNeuralActivity, 1e-9);
  assert.ok(indices.totalPower > 0);
});

// ── 2. 실 파이프라인: FAA·반구 균형은 분석적 기대값과 일치 ───────────────────
test('실 파이프라인: 좌측 알파 우세 → FAA 음수·반구 균형 양수(진폭² 비례)', async () => {
  const { indices } = await processEeg({ fp1: [ALPHA_40], fp2: [ALPHA_20] });
  // Morlet 파워는 순수 정현파에서 진폭²에 비례 → 좌/우 알파비 (40/20)² = 4
  // FAA = ln(ch2.alpha) - ln(ch1.alpha) = ln(1/4)
  near(indices.faa, Math.log(0.25), 0.05);
  // 반구 균형 = (L - R) / (L + R) = (4 - 1) / (4 + 1) = 0.6
  near(indices.hemisphericBalance, 0.6, 0.03);
  assert.ok(indices.faa < 0);
  assert.ok(indices.hemisphericBalance > 0);
});

// ── 3. 실 파이프라인: 주파수 대역별 지수 방향성 ────────────────────────────
test('실 파이프라인: 알파 우세는 이완, 베타 우세는 집중 지수를 높인다', async () => {
  const alpha = await processEeg({ fp1: [ALPHA_40], fp2: [ALPHA_40] });
  const beta = await processEeg({ fp1: [BETA_40], fp2: [BETA_40] });
  assert.ok(alpha.indices.relaxationIndex > beta.indices.relaxationIndex);
  assert.ok(beta.indices.focusIndex > alpha.indices.focusIndex);
});

// ── 4. 실 필터 검증: DC 오프셋은 밴드패스가 제거한다 ───────────────────────
test('실 필터: DC 오프셋이 있어도 지수가 변하지 않는다(밴드패스 실 동작)', async () => {
  const clean = await processEeg({ fp1: [ALPHA_40], fp2: [ALPHA_40] });
  const shifted = await processEeg({ fp1: [ALPHA_40], fp2: [ALPHA_40] }, { dc: 60 });
  near(shifted.indices.relaxationIndex, clean.indices.relaxationIndex, 1e-6);
  near(shifted.indices.focusIndex, clean.indices.focusIndex, 1e-6);
});

// ── 5. 실 SQI 검증: 아티팩트가 채널 품질을 떨어뜨린다 ──────────────────────
test('실 SQI: 아티팩트 샘플이 채널 신호품질을 떨어뜨린다', async () => {
  const components = { fp1: [ALPHA_40], fp2: [ALPHA_40] };
  const clean = await processEeg(components);
  const noisy = synthEeg(components);
  noisy[500].fp1 = 500;
  noisy[500].fp2 = 500;
  const noisyResult = await new EEGSignalProcessor().processEEGData(noisy);

  assert.ok(clean.signalQuality.fp1 > 0 && clean.signalQuality.fp1 <= 100);
  assert.ok(
    noisyResult.signalQuality.fp1 < clean.signalQuality.fp1,
    `${noisyResult.signalQuality.fp1} < ${clean.signalQuality.fp1}`,
  );
});

// ── 6. calculateRawIndices 정본 수식(실 메서드 + 손 계산 기대값) ────────────
test('calculateRawIndices: 비대칭 밴드파워 raw 지수·FAA 정본 수식', () => {
  const processor = new EEGSignalProcessor();
  const merged = { delta: 1, theta: 4, alpha: 9, beta: 16, gamma: 25 };
  const ch1 = { delta: 1, theta: 4, alpha: 9, beta: 16, gamma: 25 };
  const ch2 = { delta: 9, theta: 16, alpha: 81, beta: 4, gamma: 1 };

  const indices = processor.calculateRawIndices(merged, ch1, ch2, true, true);
  near(indices.focusIndex, 16 / (9 + 4));
  near(indices.relaxationIndex, 9 / (9 + 16));
  near(indices.stressIndex, (16 + 25) / (9 + 4));
  near(indices.cognitiveLoad, 4 / 9);
  near(indices.emotionalStability, (9 + 4) / 25);
  near(indices.totalNeuralActivity, ((1 + 4 + 9 + 16 + 25) + (9 + 16 + 81 + 4 + 1)) / 2);
  near(indices.faa, Math.log(81) - Math.log(9));
  near(indices.hemisphericBalance, (9 - 81) / (9 + 81));
});

// ── 7. mergeChannelBandPowers: SQI 가중 기하평균 · 가중치 0 제외 ────────────
test('mergeChannelBandPowers: SQI 가중 기하평균과 가중치 0 제외', () => {
  const processor = new EEGSignalProcessor();
  const ch1 = { delta: 1, theta: 2, alpha: 3, beta: 4, gamma: 5 };
  const ch2 = { delta: 5, theta: 4, alpha: 3, beta: 2, gamma: 1 };

  assert.deepEqual(processor.mergeChannelBandPowers(ch1, ch2, 0, 1), ch2);
  assert.deepEqual(processor.mergeChannelBandPowers(ch1, ch2, 1, 0), ch1);
  assert.deepEqual(processor.mergeChannelBandPowers(ch1, ch2, 0, 0), {
    delta: 0,
    theta: 0,
    alpha: 0,
    beta: 0,
    gamma: 0,
  });

  const weighted = { delta: 1, theta: 4, alpha: 9, beta: 16, gamma: 25 };
  const other = { delta: 9, theta: 16, alpha: 81, beta: 4, gamma: 1 };
  const merged = processor.mergeChannelBandPowers(weighted, other, 0.8, 0.4);
  const w1 = 0.8;
  const w2 = 0.4;
  near(merged.alpha, Math.exp((w1 * Math.log(9) + w2 * Math.log(81)) / (w1 + w2)));
  near(merged.beta, Math.exp((w1 * Math.log(16) + w2 * Math.log(4)) / (w1 + w2)));
});

// ── 8. 품질 미달 채널은 FAA 를 산출하지 않는다 ─────────────────────────────
test('품질이 낮은(미검증) 채널의 FAA는 null 이다', () => {
  const processor = new EEGSignalProcessor();
  const band = { delta: 1, theta: 4, alpha: 9, beta: 16, gamma: 25 };
  assert.equal(processor.calculateRawIndices(band, band, band, true, false).faa, null);
  assert.equal(processor.calculateRawIndices(band, band, band, false, true).faa, null);
});

// ── 9. 빈 밴드 파워 경계 ───────────────────────────────────────────────────
test('빈 밴드 파워에서 raw 값은 유한하고 FAA는 null이다', () => {
  const processor = new EEGSignalProcessor();
  const zero = { delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0 };
  const indices = processor.calculateRawIndices(zero, zero, zero, true, true);
  assert.equal(indices.faa, null);
  for (const [key, value] of Object.entries(indices)) {
    if (key !== 'faa') assert.equal(value, 0);
  }
});

// ── 10. PPG RR 경계 ────────────────────────────────────────────────────────
for (const interval of [192, 200, 2000, 2008]) {
  test(`RR ${interval}ms 경계`, () => {
    const processor = new PPGSignalProcessor();
    const result = processor.calculateRRIntervalsWithOutlierRemoval([
      0,
      interval / (1000 / processor.ppgSamplingRate),
    ]);
    assert.deepEqual(result, interval >= 200 && interval <= 2000 ? [interval] : []);
  });
}
