// 회원 화면 좌우 대칭·비율 균형 측정 (균형.md S1~S10, MS1~MS3)
// 사용: node e2e/class-player/symmetry-member.mjs [--base=http://localhost:5175] [--ids=M01,M10] [--out=파일]
// 하니스(/design/class-player)에 등록된 회원 케이스 × 4 뷰포트 + 시트 열림 변형. 위반이 있으면 종료 코드 1.
import { runCli } from './lib.mjs';

await runCli({
  role: 'member',
  mode: 'symmetry',
  title: 'MIND BREEZE 2.0 · 회원 화면 좌우 대칭·비율 균형 측정 (균형.md S1~S10, MS1~MS3)',
  defaultOut: 'member-symmetry.txt',
});
