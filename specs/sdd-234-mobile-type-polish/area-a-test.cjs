// .env를 읽지 않고 A 홈 관련 회귀 테스트를 실행한다.
const fs=require('node:fs');
const path=require('node:path');
(async()=>{
 const root=path.resolve(__dirname,'../../frontend');process.chdir(root);
 const {startVitest}=await import(path.join(root,'node_modules/vitest/dist/node.js'));
 const filters=['tests/sdd234-a-mobile-home.test.tsx','tests/sdd232-counselor-home.test.tsx','tests/sdd221-home-components.test.tsx','tests/sdd221-member-home-layout.test.tsx','tests/sdd221-home-stats.test.ts','tests/class-flow-shell-home.test.tsx','tests/member-home-legacy-sections.test.tsx','tests/dashboard-card-navigation.test.tsx','tests/dashboard-session-navigation.test.ts'];
 const ctx=await startVitest(filters,{run:true,watch:false},{root,envDir:fs.mkdtempSync('/tmp/sdd234-a-test-env-'),resolve:{alias:{'../design-system':path.resolve(root,'../design-system')}}});
 await ctx.close();
})().catch(e=>{console.error(e);process.exitCode=1;});
