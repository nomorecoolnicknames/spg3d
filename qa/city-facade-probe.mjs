import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const server=spawn('node',['scripts/serve.mjs','--dir',process.env.DIST??'dist','--port','3904'],{stdio:'ignore'});
let browser;
try{
 for(let i=0;i<40;i++){try{if((await fetch('http://localhost:3904/')).ok)break;}catch{}await new Promise(r=>setTimeout(r,200));}
 browser=await chromium.launch({args:['--mute-audio','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
 const page=await browser.newPage({viewport:{width:1024,height:576}});
 await page.goto('http://localhost:3904/?screen=race&track=ligovsky&q=high&opp=0&traffic=0&maxdt=0.2',{timeout:120000});
 await page.waitForFunction(()=>window.__spg?.ready&&window.__spg.knobs.pickFacade,null,{timeout:300000});
 await page.evaluate(()=>window.__spg.knobs.viewFrom(-202,4,-272,-148,14,-252));
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const result=await page.evaluate(()=>[[.5,.15],[.4,.25],[.8,.4],[.5,.72]].map(p=>({pixel:p,hits:window.__spg.knobs.pickFacade(...p)})));
 writeFileSync(process.env.QA_REPORT??'/mnt/ramdisk/spg3d-photo-v2/facade-probe.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify(result.map(r=>({pixel:r.pixel,hits:r.hits.slice(0,3)}))));
}finally{await browser?.close();server.kill();}
process.exit(0);
