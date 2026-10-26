// 이미 측정한 PNG를 CSS 크기 변경 없이 나란히 배치한 비교 캡처를 만든다.
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require(path.resolve(__dirname,'../../../frontend/node_modules/playwright'));
const pairs=[
 ['member-reports-mobile','client-390-app','client-390-app-reports',390,844,'회원 홈: 본문 x=16','리포트: 본문 x=32 (+16px)'],
 ['member-classes-desktop','client-1440-app','client-1440-app-classes',1440,900,'회원 홈: 본문 x=280','내 클래스: 본문 x=320 (+40px)'],
 ['member-profile-mobile','client-390-app','client-390-app-participation-profile',390,844,'회원 홈: 본문 x=16','참여 프로필: 본문 x=32 (+16px)'],
 ['admin-data-mobile','platform_admin-390-admin-orgs','platform_admin-390-admin-data-center',390,844,'플랫폼 홈: 페이지 x=16','데이터 센터: 내부 x=30 (+14px)'],
 ['host-invite-mobile','counselor-390-dashboard','counselor-390-clients-invite',390,844,'상담사 홈: hero CTA 48px','회원 초대: CTA 40px, radius 6px'],
];
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});
try{for(const [name,a,b,w,h,la,lb] of pairs){
const doc=`<!doctype html><html lang="ko"><meta charset="utf-8"><title>${name}</title><style>*{box-sizing:border-box}body{margin:0;background:#eee;font:16px sans-serif}main{display:flex;gap:16px}section{width:${w}px;flex:none}h2{height:58px;margin:0;padding:16px 12px;background:#fff;font-size:16px}img{display:block;width:${w}px;height:${h}px}</style><main><section><h2>${la}</h2><img src="captures/${a}.png"></section><section><h2>${lb}</h2><img src="captures/${b}.png"></section></main></html>`;
fs.writeFileSync(path.join(__dirname,`compare-${name}.html`),doc);
const page=await browser.newPage({viewport:{width:w*2+16,height:h+58},deviceScaleFactor:1});
await page.goto('file://'+path.join(__dirname,`compare-${name}.html`));await page.locator('img').evaluateAll(els=>Promise.all(els.map(e=>e.decode())));
await page.screenshot({path:path.join(__dirname,`compare-${name}.png`),fullPage:true});await page.close();}
}finally{await browser.close();}})();
