// @ts-nocheck — link-band-sdk 이식본 (verbatim/noUnusedLocals 완화)
// EEG 신호 처리 유틸리티 (JavaScript 구현)
// 나중에 WebAssembly로 최적화 예정

export interface BandPowers {
  delta: number;    // 0.5-4Hz (깊은 수면)
  theta: number;    // 4-8Hz (명상, 창의성)
  alpha: number;    // 8-13Hz (이완, 집중)
  beta: number;     // 13-30Hz (각성, 인지)
  gamma: number;    // 30-50Hz (고차 인지)
}

export interface SignalQuality {
  overall: number;        // 전체 품질 점수 (0-100)
  rms: number;           // RMS 값
  range: number;         // 신호 범위
  snr: number;           // 신호 대 잡음비
}

export interface ArtifactDetection {
  movement: boolean;      // 움직임 아티팩트
  eyeBlink: boolean;      // 눈 깜빡임 아티팩트
  muscleNoise: boolean;   // 근육 잡음
}

/**
 * 노치 필터 - 전원 잡음 (50/60Hz) 제거
 */
export function notchFilter(
  signal: Float32Array, 
  sampleRate: number, 
  notchFreq: number = 50,
  qFactor: number = 30
): Float32Array {
  const filtered = new Float32Array(signal.length);
  
  // 필터 계수 계산
  const omega = 2 * Math.PI * notchFreq / sampleRate;
  const alpha = Math.sin(omega) / (2 * qFactor);
  
  const b0 = 1;
  const b1 = -2 * Math.cos(omega);
  const b2 = 1;
  const a0 = 1 + alpha;
  const a1 = -2 * Math.cos(omega);
  const a2 = 1 - alpha;
  
  // 정규화
  const b0_norm = b0 / a0;
  const b1_norm = b1 / a0;
  const b2_norm = b2 / a0;
  const a1_norm = a1 / a0;
  const a2_norm = a2 / a0;
  
  // 필터 상태 변수
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  
  for (let i = 0; i < signal.length; i++) {
    const x0 = signal[i];
    const y0 = b0_norm * x0 + b1_norm * x1 + b2_norm * x2 - a1_norm * y1 - a2_norm * y2;
    
    filtered[i] = y0;
    
    // 상태 업데이트
    x2 = x1; x1 = x0;
    y2 = y1; y1 = y0;
  }
  
  return filtered;
}

/**
 * 밴드패스 필터 (0.5-50Hz)
 */
export function bandpassFilter(
  signal: Float32Array,
  sampleRate: number,
  lowFreq: number = 0.5,
  highFreq: number = 50
): Float32Array {
  // 고역 통과 필터 적용
  const highpassed = highpassFilter(signal, sampleRate, lowFreq);
  
  // 저역 통과 필터 적용
  const bandpassed = lowpassFilter(highpassed, sampleRate, highFreq);
  
  return bandpassed;
}

/**
 * 고역 통과 필터
 */
function highpassFilter(signal: Float32Array, sampleRate: number, cutoffFreq: number): Float32Array {
  const filtered = new Float32Array(signal.length);
  const omega = 2 * Math.PI * cutoffFreq / sampleRate;
  const alpha = Math.sin(omega) / (2 * 0.707); // Q = 0.707 (Butterworth)
  
  const b0 = (1 + Math.cos(omega)) / 2;
  const b1 = -(1 + Math.cos(omega));
  const b2 = (1 + Math.cos(omega)) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * Math.cos(omega);
  const a2 = 1 - alpha;
  
  // 정규화
  const b0_norm = b0 / a0;
  const b1_norm = b1 / a0;
  const b2_norm = b2 / a0;
  const a1_norm = a1 / a0;
  const a2_norm = a2 / a0;
  
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  
  for (let i = 0; i < signal.length; i++) {
    const x0 = signal[i];
    const y0 = b0_norm * x0 + b1_norm * x1 + b2_norm * x2 - a1_norm * y1 - a2_norm * y2;
    
    filtered[i] = y0;
    
    x2 = x1; x1 = x0;
    y2 = y1; y1 = y0;
  }
  
  return filtered;
}

/**
 * 저역 통과 필터
 */
function lowpassFilter(signal: Float32Array, sampleRate: number, cutoffFreq: number): Float32Array {
  const filtered = new Float32Array(signal.length);
  const omega = 2 * Math.PI * cutoffFreq / sampleRate;
  const alpha = Math.sin(omega) / (2 * 0.707); // Q = 0.707 (Butterworth)
  
  const b0 = (1 - Math.cos(omega)) / 2;
  const b1 = 1 - Math.cos(omega);
  const b2 = (1 - Math.cos(omega)) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * Math.cos(omega);
  const a2 = 1 - alpha;
  
  // 정규화
  const b0_norm = b0 / a0;
  const b1_norm = b1 / a0;
  const b2_norm = b2 / a0;
  const a1_norm = a1 / a0;
  const a2_norm = a2 / a0;
  
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  
  for (let i = 0; i < signal.length; i++) {
    const x0 = signal[i];
    const y0 = b0_norm * x0 + b1_norm * x1 + b2_norm * x2 - a1_norm * y1 - a2_norm * y2;
    
    filtered[i] = y0;
    
    x2 = x1; x1 = x0;
    y2 = y1; y1 = y0;
  }
  
  return filtered;
}

/**
 * FFT 구현 (Cooley-Tukey 알고리즘)
 */
export function performFFT(signal: Float32Array): Float32Array {
  const N = signal.length;
  
  // 2의 거듭제곱으로 패딩
  let size = 1;
  while (size < N) size *= 2;
  
  const paddedSignal = new Float32Array(size);
  paddedSignal.set(signal);
  
  // 복소수 배열 생성
  const real = new Float32Array(paddedSignal);
  const imag = new Float32Array(size);
  
  // Bit-reversal permutation
  let j = 0;
  for (let i = 1; i < size; i++) {
    let bit = size >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }
  
  // FFT 계산
  let length = 2;
  while (length <= size) {
    const angle = -2 * Math.PI / length;
    const wreal = Math.cos(angle);
    const wimag = Math.sin(angle);
    
    for (let i = 0; i < size; i += length) {
      let wr = 1, wi = 0;
      
      for (let j = 0; j < length / 2; j++) {
        const u_real = real[i + j];
        const u_imag = imag[i + j];
        const v_real = real[i + j + length / 2] * wr - imag[i + j + length / 2] * wi;
        const v_imag = real[i + j + length / 2] * wi + imag[i + j + length / 2] * wr;
        
        real[i + j] = u_real + v_real;
        imag[i + j] = u_imag + v_imag;
        real[i + j + length / 2] = u_real - v_real;
        imag[i + j + length / 2] = u_imag - v_imag;
        
        const temp_wr = wr * wreal - wi * wimag;
        wi = wr * wimag + wi * wreal;
        wr = temp_wr;
      }
    }
    length *= 2;
  }
  
  // 크기 계산
  const magnitude = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    magnitude[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
  }
  
  return magnitude;
}

/**
 * 주파수 대역별 파워 추출
 */
export function extractBandPowers(
  powerSpectrum: Float32Array,
  sampleRate: number
): BandPowers {
  const freqResolution = sampleRate / powerSpectrum.length;
  
  let deltaPower = 0;
  let thetaPower = 0;
  let alphaPower = 0;
  let betaPower = 0;
  let gammaPower = 0;
  
  // DC 성분 제외하고 Nyquist 주파수까지
  for (let i = 1; i < powerSpectrum.length / 2; i++) {
    const freq = i * freqResolution;
    const power = powerSpectrum[i] * powerSpectrum[i]; // 파워 계산
    
    if (freq >= 0.5 && freq < 4) {
      deltaPower += power;
    } else if (freq >= 4 && freq < 8) {
      thetaPower += power;
    } else if (freq >= 8 && freq < 13) {
      alphaPower += power;
    } else if (freq >= 13 && freq < 30) {
      betaPower += power;
    } else if (freq >= 30 && freq < 50) {
      gammaPower += power;
    }
  }
  
  // 정규화 (총 파워 대비 비율)
  const totalPower = deltaPower + thetaPower + alphaPower + betaPower + gammaPower;
  if (totalPower > 0) {
    deltaPower /= totalPower;
    thetaPower /= totalPower;
    alphaPower /= totalPower;
    betaPower /= totalPower;
    gammaPower /= totalPower;
  }
  
  return {
    delta: deltaPower,
    theta: thetaPower,
    alpha: alphaPower,
    beta: betaPower,
    gamma: gammaPower
  };
}

/**
 * 신호 품질 평가
 */
export function assessSignalQuality(signal: Float32Array): SignalQuality {
  // RMS 계산
  let rms = 0;
  for (let i = 0; i < signal.length; i++) {
    rms += signal[i] * signal[i];
  }
  rms = Math.sqrt(rms / signal.length);
  
  // 신호 범위 계산
  let min = signal[0];
  let max = signal[0];
  for (let i = 1; i < signal.length; i++) {
    if (signal[i] < min) min = signal[i];
    if (signal[i] > max) max = signal[i];
  }
  const range = max - min;
  
  // SNR 추정 (간단한 방법)
  const mean = signal.reduce((sum, val) => sum + val, 0) / signal.length;
  let signalPower = 0;
  let noisePower = 0;
  
  for (let i = 0; i < signal.length; i++) {
    const deviation = signal[i] - mean;
    signalPower += deviation * deviation;
    
    // 고주파 성분을 노이즈로 간주
    if (i > 0) {
      const diff = signal[i] - signal[i - 1];
      noisePower += diff * diff;
    }
  }
  
  const snr = signalPower > 0 && noisePower > 0 ? 10 * Math.log10(signalPower / noisePower) : 0;
  
  // 품질 점수 계산 (0-100)
  let quality = 100;
  
  // 신호가 너무 작으면 품질 감소
  if (rms < 1) quality *= rms;
  
  // 신호가 포화되면 품질 감소
  if (range > 200) quality *= (200 / range);
  
  // SNR이 낮으면 품질 감소
  if (snr < 20) quality *= (snr / 20);
  
  quality = Math.max(0, Math.min(100, quality));
  
  return {
    overall: quality,
    rms,
    range,
    snr
  };
}

/**
 * 아티팩트 검출
 */
export function detectArtifacts(
  signal: Float32Array,
  sampleRate: number
): ArtifactDetection {
  // 고주파 성분 분석 (근육 잡음)
  let highFreqPower = 0;
  for (let i = 1; i < signal.length - 1; i++) {
    const diff = signal[i + 1] - signal[i - 1];
    highFreqPower += diff * diff;
  }
  highFreqPower /= (signal.length - 2);
  
  // 저주파/큰 진폭 성분 분석 (움직임/눈 깜빡임)
  const windowSize = Math.floor(sampleRate * 0.5); // 0.5초 윈도우
  let maxWindowPower = 0;
  
  for (let i = 0; i < signal.length - windowSize; i += windowSize) {
    let windowPower = 0;
    let windowMean = 0;
    
    // 윈도우 평균 계산
    for (let j = 0; j < windowSize; j++) {
      windowMean += signal[i + j];
    }
    windowMean /= windowSize;
    
    // 윈도우 파워 계산
    for (let j = 0; j < windowSize; j++) {
      const deviation = signal[i + j] - windowMean;
      windowPower += deviation * deviation;
    }
    
    if (windowPower > maxWindowPower) {
      maxWindowPower = windowPower;
    }
  }
  
  // 임계값 기반 아티팩트 검출
  const muscleNoise = highFreqPower > 100;
  const eyeBlink = maxWindowPower > 500;
  const movement = maxWindowPower > 1000;
  
  return {
    movement,
    eyeBlink,
    muscleNoise
  };
}

/**
 * 완전한 EEG 신호 처리 파이프라인
 */
export function processEEGSignal(
  rawSignal: Float32Array,
  sampleRate: number
): {
  filteredSignal: Float32Array;
  bandPowers: BandPowers;
  signalQuality: SignalQuality;
  artifacts: ArtifactDetection;
} {
  // 1. 전처리: 노치 필터 + 밴드패스 필터
  const notchFiltered = notchFilter(rawSignal, sampleRate);
  const filteredSignal = bandpassFilter(notchFiltered, sampleRate);

  // 2. 주파수 분석
  const fftResult = performFFT(filteredSignal);
  const bandPowers = extractBandPowers(fftResult, sampleRate);
  
  // 3. 신호 품질 평가
  const signalQuality = assessSignalQuality(filteredSignal);
  
  // 4. 아티팩트 검출
  const artifacts = detectArtifacts(rawSignal, sampleRate);
  
  return {
    filteredSignal,
    bandPowers,
    signalQuality,
    artifacts
  };
} 
