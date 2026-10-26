// 저장소 .env를 읽지 않는 관련 회귀 테스트 실행기.
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
(async()=>{
 const root=path.resolve(__dirname,'../../frontend');process.chdir(root);
 const {startVitest}=await import(pathToFileURL(path.join(root,'node_modules/vitest/dist/node.js')).href);
 const filters=['tests/sdd233-floating-nav.test.tsx','tests/nav-badge-by-key.test.tsx','tests/nav-labels-characterization.test.tsx','tests/sdd232-counselor-home.test.tsx','tests/sdd221-home-components.test.tsx','tests/sdd221-member-home-layout.test.tsx','tests/chat-mobile-header.test.tsx'];
 const ctx=await startVitest(filters,{run:true,watch:false},{root,envDir:fs.mkdtempSync('/tmp/sdd234-vitest-env-'),resolve:{alias:{'../design-system':path.resolve(root,'../design-system')}}});
 await ctx.close();
})().catch(e=>{console.error(e);process.exitCode=1;});
