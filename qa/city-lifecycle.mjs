// Shared surface / foliage textures must survive scene disposal without growing on repeated visits.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const quality=process.argv[2]??'low';
const port=Number(process.env.QA_PORT??3896);
const server=spawn('node',['scripts/serve.mjs','--dir',process.env.DIST??'dist','--port',String(port)],{stdio:'ignore'});
let browser;
const samples=[],errors=[];
try {
 for(let i=0;i<50;i++){try{if((await fetch(`http://localhost:${port}/`)).ok)break;}catch{}await new Promise(r=>setTimeout(r,200));}
 browser=await chromium.launch({args:['--mute-audio','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
 const page=await browser.newPage({viewport:{width:480,height:270}});
 if (process.env.QA_GL_TRACE) await page.addInitScript(() => {
  const live=new Map(), ids=new WeakMap();let next=0;
  const proto=WebGL2RenderingContext.prototype;
  const create=proto.createTexture, del=proto.deleteTexture, bind=proto.bindTexture;
  const bindings=new Map();
  proto.createTexture=function(...a){const t=create.apply(this,a);const id=++next;ids.set(t,id);live.set(id,{id,stack:new Error().stack,uploads:[]});return t;};
  proto.deleteTexture=function(t){live.delete(ids.get(t));return del.call(this,t);};
  proto.bindTexture=function(target,t){bindings.set(target,t);return bind.call(this,target,t);};
  for(const method of ['texImage2D','texStorage2D','texImage3D']) {
   const original=proto[method];
   proto[method]=function(...a){const t=bindings.get(a[0]);const rec=live.get(ids.get(t));if(rec)rec.uploads.push({method,args:a.slice(0,8).map(x=>typeof x==='number'?x:x?.width?[x.width,x.height]:'data')});return original.apply(this,a);};
  }
  window.__textureAudit=()=>[...live.values()];
 });
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(`http://localhost:${port}/?q=${quality}&maxdt=0.2`,{timeout:120000});
 await page.waitForFunction(()=>window.__spg?.ready,null,{timeout:300000});
 const frames=()=>page.evaluate(()=>new Promise(resolve=>{let n=0;const step=()=>++n===4?resolve():requestAnimationFrame(step);requestAnimationFrame(step);}));
 for(let i=0;i<3;i++){
  await page.evaluate(track=>window.__spg.goto('race',{track,opp:0}),process.env.QA_TRACK??'shchyolkovo');
  await page.waitForFunction(()=>window.__spg?.screen==='race' && window.__spg.knobs.surfaceStats,null,{timeout:180000});
  await frames();
  const s=await page.evaluate(()=>window.__spg.snapshot());
  samples.push({cycle:i,screen:'race',geometries:s.geometries,textures:s.textures});
  await page.evaluate(()=>window.__spg.goto('menu'));
  await page.waitForFunction(()=>window.__spg.screen==='menu' && !window.__spg.knobs.surfaceStats);
  await frames();
  const m=await page.evaluate(()=>window.__spg.snapshot());
  samples.push({cycle:i,screen:'menu',geometries:m.geometries,textures:m.textures,...(process.env.QA_GL_TRACE?{gpuTextures:await page.evaluate(()=>window.__textureAudit())}:{})});
 }
 const [a,b]=samples.filter(s=>s.screen==='menu').slice(-2);
 const pass=!errors.length && a.geometries===b.geometries && a.textures===b.textures;
 const report={pass,quality,track:process.env.QA_TRACK??'shchyolkovo',samples,errors};
 writeFileSync(process.env.QA_REPORT??'/mnt/ramdisk/spg3d-photoreal/lifecycle.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({...report,samples:samples.map(({gpuTextures,...s})=>s)}));
 if(!pass)process.exitCode=1;
}finally{await browser?.close();server.kill();}
