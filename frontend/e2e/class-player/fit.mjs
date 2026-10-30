// 공통 합격 기준 측정: 스크롤 0 · 11px 이하 글자 0 · 터치 44px · 글자 대비 3:1 · 호흡 문구 0 · 경고색 · 빈 영역 · 겹침/이탈/잘림 + 보조 뷰포트 도크 도달성
// 사용: node e2e/class-player/fit.mjs --role=member|host [--base=URL] [--ids=M01,M02] [--reach=false] [--out=파일]
import { parseArgs, runCli } from './lib.mjs';

const role = parseArgs(process.argv).role;
if (role !== 'member' && role !== 'host') {
  console.error('사용: node e2e/class-player/fit.mjs --role=member|host');
  process.exit(2);
}

await runCli({
  role,
  mode: 'fit',
  title: `MIND BREEZE 2.0 · ${role === 'member' ? '회원' : '코치'} 화면 공통 합격 기준 측정 (verify P1~P3·P5·P9·P12~P14 + 글자 대비 PC)`,
  defaultOut: `${role}-fit.txt`,
});
