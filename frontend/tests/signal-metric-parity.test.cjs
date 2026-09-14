const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
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
const EEGSignalProcessor = loadProcessor('EEGSignalProcessor');
const PPGSignalProcessor = loadProcessor('PPGSignalProcessor');
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
async function eeg(quality = [0.8, 0.4]) {
  const processor = new EEGSignalProcessor();
  processor.applyNotchFilter = values => values;
  processor.bandpassFilter = values => values;
  processor.calculateAmplitudeSQI = values => values;
  processor.calculateFrequencySQI = values => values;
  let calls = 0;
  processor.calculateCombinedSQI = values => {
    const sqi = quality[calls++];
    return values.map(() => sqi);
  };
  processor.calculatePowerSpectrum = () => [];
  let bandCalls = 0;
  processor.computeBandPowers = () => (++bandCalls === 1
    ? { delta: 1, theta: 4, alpha: 9, beta: 16, gamma: 25 }
    : { delta: 9, theta: 16, alpha: 81, beta: 4, gamma: 1 });
  return processor.processEEGData(Array.from({ length: 500 }, (_, i) => ({ timestamp: i * 4, fp1: 1, fp2: 2 })));
}
test('비대칭 채널 raw 수치와 FAA가 정본과 일치한다', async () => {
  const { indices } = await eeg();
  const alpha = Math.cbrt(9 * 9 * 81), theta = Math.cbrt(4 * 4 * 16);
  const beta = Math.cbrt(16 * 16 * 4), gamma = Math.cbrt(25 * 25);
  near(indices.focusIndex, beta / (alpha + theta + 1e-10));
  near(indices.relaxationIndex, alpha / (alpha + beta + 1e-10));
  near(indices.stressIndex, (beta + gamma) / (alpha + theta + 1e-10));
  near(indices.emotionalStability, (alpha + theta) / (gamma + 1e-10));
  near(indices.cognitiveLoad, 78);
  near(indices.totalPower, 83);
  near(indices.totalNeuralActivity, 83);
  near(indices.faa, Math.log(9));
  near(indices.hemisphericBalance, -0.8);
});
test('품질이 낮은 채널의 FAA는 null이다', async () => {
  assert.equal((await eeg([0.8, 0.1])).indices.faa, null);
});
for (const interval of [192, 200, 2000, 2008]) {
  test(`RR ${interval}ms 경계`, () => {
    const processor = new PPGSignalProcessor();
    const result = processor.calculateRRIntervalsWithOutlierRemoval([0, interval / (1000 / processor.ppgSamplingRate)]);
    assert.deepEqual(result, interval >= 200 && interval <= 2000 ? [interval] : []);
  });
}
test('SQI 가중치가 0인 채널은 병합에서 제외한다', () => {
  const processor = new EEGSignalProcessor();
  const left = { delta: 1, theta: 2, alpha: 3, beta: 4, gamma: 5 };
  const right = { delta: 5, theta: 4, alpha: 3, beta: 2, gamma: 1 };
  assert.deepEqual(processor.mergeChannelBandPowers(left, right, 0, 1), right);
  assert.deepEqual(processor.mergeChannelBandPowers(left, right, 1, 0), left);
  assert.deepEqual(processor.mergeChannelBandPowers(left, right, 0, 0), { delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0 });
});
test('빈 밴드 파워에서 raw 값은 유한하고 FAA는 null이다', () => {
  const processor = new EEGSignalProcessor();
  const zero = { delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0 };
  const indices = processor.calculateRawIndices(zero, zero, zero, true, true);
  assert.equal(indices.faa, null);
  for (const [key, value] of Object.entries(indices)) {
    if (key !== 'faa') assert.equal(value, 0);
  }
});
