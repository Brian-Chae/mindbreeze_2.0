// 감사 전용 빌드: 환경파일/실서버를 사용하지 않고 제품 소스를 그대로 빌드한다.
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
(async()=>{
 const root=path.resolve(__dirname,'../../../frontend');
 process.chdir(root);
 const {build}=await import(pathToFileURL(path.join(root,'node_modules/vite/dist/node/index.js')).href);
 const outDir=fs.mkdtempSync('/tmp/sdd245-build-');
 const envDir=fs.mkdtempSync('/tmp/sdd245-env-');
 await build({root,configFile:path.join(root,'vite.config.ts'),mode:'development',envDir,resolve:{alias:{'../design-system':path.resolve(root,'../design-system')}},define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api/v1'),'import.meta.env.VITE_COUNSELING_ENABLED':'"true"','import.meta.env.VITE_AI_ENABLED':'"true"','import.meta.env.VITE_DESIGN_ROUTES_ENABLED':'"true"'},build:{outDir,emptyOutDir:false}});
 fs.writeFileSync(process.env.AUDIT_BUILD_INFO?path.resolve(process.env.AUDIT_BUILD_INFO):path.join(__dirname,'build-info.json'),JSON.stringify({outDir,mode:'development',flags:{counseling:true,ai:true,designRoutes:true},sourceCommit:require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()},null,2));
})();
