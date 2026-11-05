// 제품 React 화면 + 합성 API. 실제 계정/메일/OAuth/서버 연결을 하지 않는다.
const fs=require('fs'),path=require('path'),os=require('os');
const root=path.resolve(__dirname,'../../..'),front=path.join(root,'frontend');
process.chdir(front);
const {chromium}=require(path.join(front,'node_modules/playwright'));
const {fixture}=require('../../sdd-245-ui-unification/audit/base-fixtures.cjs');
(async()=>{
 const {createServer}=await import(path.join(front,'node_modules/vite/dist/node/index.js'));
 const server=await createServer({root:front,configFile:path.join(front,'vite.config.ts'),envDir:fs.mkdtempSync(path.join(os.tmpdir(),'sdd302-env-')),mode:'development',define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api/v1'),'import.meta.env.VITE_GOOGLE_CLIENT_ID':JSON.stringify('synthetic-client-id')},server:{host:'127.0.0.1',port:53202,strictPort:true}});await server.listen();
 const browser=await chromium.launch({headless:true});const results=[],errors=[];const base='http://127.0.0.1:53202';
 const fresh=()=>({id:'00000000-0000-4000-8000-000000000302',email:'member@example.test',name:'예시 회원',role:'client',verified_tier:'unverified',onboarding_completed:false,auth_provider:'google',counselors:[],gender:'female',birth_date:'1990-01-01',phone:null,client_required_fields:[],profile_prompt_dismissed:false});
 async function context(width,authenticated=false,missing=false){const ctx=await browser.newContext({viewport:{width,height:900},deviceScaleFactor:1});let user={...fresh(),...(missing?{gender:null,client_required_fields:['gender']}: {})};const writes=[];
 await ctx.route('**/*',async r=>{const u=new URL(r.request().url());if(u.origin!==base)return r.abort();if(!u.pathname.startsWith('/api/'))return r.continue();const p=u.pathname,method=r.request().method();let data;if(method!=='GET')writes.push({path:p,body:r.request().postDataJSON()});
 if(p.endsWith('/auth/refresh'))data={access_token:'synthetic-token',token_type:'bearer'};
 else if(p.endsWith('/auth/users/me')){if(method==='PATCH'){Object.assign(user,r.request().postDataJSON());user.client_required_fields=[]}data=user}
 else if(p.endsWith('/onboarding/client/profile-dismiss')){user.profile_prompt_dismissed=true;data=user}
 else if(p.endsWith('/onboarding/client/complete'))data={current_step:4,completed:true,completed_steps:[],step_data:{}};
 else if(p.endsWith('/auth/email/request-otp'))data={ok:true};
 else if(p.endsWith('/auth/email/verify-otp'))data={email_verify_token:'synthetic-email-verified'};
 else if(p.endsWith('/auth/counselor-code/check'))data={counselor_name:'예시 코치',organization_name:null};
 else if(p.endsWith('/auth/register/client')||p.endsWith('/auth/google')||p.endsWith('/auth/apple'))data={access_token:'synthetic-token',token_type:'bearer',user};
 else data=fixture(p,'client');
 return r.fulfill({status:data===undefined?404:200,json:data??{detail:'합성 fixture 미등록'}});
 });
 if(authenticated)await ctx.addInitScript(u=>localStorage.setItem('mb_user',JSON.stringify(u)),user);
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));return {ctx,page,writes};}
 async function capture(page,name,width){await page.locator('body').waitFor();await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(300);await page.screenshot({path:path.join(__dirname,`${name}-${width}.png`),fullPage:true});const m=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,bodyText:document.body.innerText.slice(0,180),cards:[...document.querySelectorAll('.signup-flow main,.signup-flow .rounded-3xl')].map(e=>({background:getComputedStyle(e).backgroundColor,radius:getComputedStyle(e).borderRadius})),inputs:[...document.querySelectorAll('input:not([type=checkbox]),select')].map(e=>({height:e.getBoundingClientRect().height,color:getComputedStyle(e).color}))}));results.push({name,width,...m});}
 try{
 for(const width of [390,768]){
 let t=await context(width);await t.page.goto(base+'/register?role=client');await t.page.getByRole('heading',{name:/나를 위한/}).waitFor();await capture(t.page,'start',width);
 await t.page.goto(base+'/register/client');await t.page.getByLabel('이메일',{exact:true}).waitFor();await capture(t.page,'email',width);
 await t.page.getByLabel('이메일',{exact:true}).fill('member@example.test');await t.page.getByRole('button',{name:'인증 요청',exact:true}).click();await t.page.getByLabel('인증 코드 6자리').fill('123456');await t.page.getByRole('button',{name:'다음',exact:true}).click();await t.page.getByLabel('이름',{exact:true}).fill('예시 회원');await t.page.getByRole('button',{name:'여성',exact:true}).click();await t.page.getByLabel('생년월일',{exact:true}).fill('19900101');await t.page.getByLabel('비밀번호',{exact:true}).fill('Synthetic302!');await t.page.getByLabel('비밀번호 확인',{exact:true}).fill('Synthetic302!');await t.page.getByLabel('초대 코치 코드').fill('123456');await t.page.getByRole('button',{name:'코드 확인',exact:true}).click();await t.page.getByLabel('필수 항목 전체 동의').check();await capture(t.page,'email-details',width);await t.page.getByRole('button',{name:'동의하고 가입하기'}).click();await t.page.waitForURL('**/app');const registered=t.writes.find(w=>w.path.endsWith('/auth/register/client'));if(registered?.body.gender!=='female'||registered?.body.birth_date!=='1990-01-01')throw Error('이메일 가입 필수정보 누락');await t.ctx.close();t=await context(width);await t.page.goto(base+'/register?role=client');
 await t.page.evaluate(async()=>{const m=await import('/src/stores/social-signup-store.ts');m.useSocialSignupStore.getState().begin({credential:{provider:'google',tokenKind:'access_token',token:'synthetic-google'},role:'client',rememberMe:true});history.pushState({},'', '/signup/confirm');window.dispatchEvent(new PopStateEvent('popstate'));});await t.page.getByLabel('성별',{exact:true}).waitFor();await capture(t.page,'social',width);await t.page.getByLabel('이름',{exact:true}).fill('예시 회원');await t.page.getByLabel('성별',{exact:true}).selectOption('female');await t.page.getByLabel('생년월일',{exact:true}).fill('19900101');await t.page.getByLabel('필수 항목 전체 동의').check();await t.page.getByRole('button',{name:'가입하기',exact:true}).click();await t.page.waitForURL('**/app');const social=t.writes.find(w=>w.path.endsWith('/auth/google'));if(social?.body.gender!=='female'||social?.body.name!=='예시 회원')throw Error('소셜 필수정보 누락');await t.ctx.close();
 t=await context(width,true,true);await t.page.goto(base+'/app');await t.page.getByLabel('성별',{exact:true}).waitFor();await capture(t.page,'required-gender',width);if(await t.page.locator('input').count())throw Error('성별만 누락인데 다른 입력노출');await t.page.getByLabel('성별',{exact:true}).selectOption('female');await t.page.getByRole('button',{name:'저장하고 시작하기'}).click();await t.page.waitForURL('**/app');const patch=t.writes.find(w=>w.path.endsWith('/auth/users/me'));if(JSON.stringify(patch?.body)!==JSON.stringify({gender:'female'}))throw Error('누락필드만 PATCH 위반');await t.ctx.close();
 t=await context(width,true);await t.page.goto(base+'/settings/optional-profile');await t.page.getByLabel('전화번호 · 선택').waitFor();await capture(t.page,'optional-phone',width);await t.page.getByRole('button',{name:'나중에 하기',exact:true}).click();await t.page.waitForURL('**/app');if(!t.writes.some(w=>w.path.endsWith('profile-dismiss')))throw Error('보류 API 미호출');await t.page.goto(base+'/role-redirect');await t.page.waitForURL('**/app');await t.ctx.close();
 }
 fs.writeFileSync(path.join(__dirname,'validation.json'),JSON.stringify({scope:'제품 소스+합성API, 실서버/실OAuth 아님',results,errors,flows:['이메일 OTP→정보동의→홈','소셜 정보동의→홈','성별만 보완 PATCH→홈','선택전화 보류→홈→재진입 홈']},null,2));if(results.some(x=>x.overflow)||errors.length)throw Error('넘침 또는 런타임 오류');console.log(JSON.stringify({captures:results.length,overflow:0,pageErrors:0,flows:8}));
 }finally{await browser.close();await server.close();}
})();
