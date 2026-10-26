// SDD-245 Stage ⑤: 대표 불일치 10곳을 [홈 | 변경 전 | 변경 후] 3단으로 나란히 캡처한다. AFTER_DIR=재측정 출력.
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require(path.resolve(__dirname,'../../../frontend/node_modules/playwright'));
const AFTER=process.env.AFTER_DIR||'/tmp/sdd245-after';
const homeOf={client:'app',counselor:'dashboard',org_admin:'dashboard-org',platform_admin:'admin-orgs'};
const items=[
 ['01-member-reports-390','client',390,'app-reports','회원 리포트'],
 ['02-member-profile-390','client',390,'app-participation-profile','참여 프로필'],
 ['03-member-classes-1440','client',1440,'app-classes','내 클래스'],
 ['04-member-class-detail-1440','client',1440,'app-classes-sample-class','클래스 상세'],
 ['05-host-classes-1440','counselor',1440,'classes','상담사 클래스 목록'],
 ['06-admin-data-center-390','platform_admin',390,'admin-data-center','데이터 센터(모바일)'],
 ['07-admin-data-center-1440','platform_admin',1440,'admin-data-center','데이터 센터(데스크톱)'],
 ['08-host-invite-390','counselor',390,'clients-invite','회원 초대'],
 ['09-org-requests-390','counselor',390,'org-requests','기관 요청'],
 ['10-member-classes-390','client',390,'app-classes','내 클래스(모바일)'],
];
(async()=>{const b=await chromium.launch({channel:'chrome',headless:true});
try{for(const [name,role,w,slug,label] of items){
 const h=w===390?844:900,id=`${role}-${w}-${slug}`,home=`${role}-${w}-${homeOf[role]}`;
 const src=[[`홈(변경 후, 기준)`,path.join(AFTER,'captures',home+'.png')],['변경 전',path.join(__dirname,'captures',id+'.png')],['변경 후',path.join(AFTER,'captures',id+'.png')]];
 for(const [,p] of src) if(!fs.existsSync(p)) throw new Error('없음 '+p);
 const imgs=src.map(([l,p])=>`<section><h2>${label} — ${l}</h2><img src="data:image/png;base64,${fs.readFileSync(p).toString('base64')}"></section>`).join('');
 const doc=`<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#ddd;font:16px sans-serif}main{display:flex;gap:16px}section{width:${w}px;flex:none}h2{height:48px;margin:0;padding:14px 12px;background:#fff;font-size:15px}img{display:block;width:${w}px;height:${h}px}</style><main>${imgs}</main>`;
 const page=await b.newPage({viewport:{width:w*3+32,height:h+48}});await page.setContent(doc);
 await page.screenshot({path:path.join(__dirname,'after',`compare-${name}.png`)});await page.close();
 fs.copyFileSync(path.join(AFTER,'captures',id+'.png'),path.join(__dirname,'after','captures',id+'.png'));
 console.log('ok',name);
}}finally{await b.close()}})();
