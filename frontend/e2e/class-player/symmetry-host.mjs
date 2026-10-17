// 상담사 화면 좌우 대칭·비율 균형 측정 (균형.md S1~S10, CS1~CS5)
// 사용: node e2e/class-player/symmetry-host.mjs [--base=http://localhost:5175] [--ids=C01,C18] [--out=파일]
// 하니스(/design/class-player)에 등록된 상담사 케이스 × 4 뷰포트 + 변형. 위반이 있으면 종료 코드 1.
import { runCli } from './lib.mjs';

await runCli({
  role: 'host',
  mode: 'symmetry',
  title: 'MIND BREEZE 2.0 · 상담사 화면 좌우 대칭·비율 균형 측정 (균형.md S1~S10, CS1~CS5)',
  defaultOut: 'host-symmetry.txt',
});
