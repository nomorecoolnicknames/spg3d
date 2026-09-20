// Actual WebGL acceptance: shader errors, network failures, fixed landmark views, all cities/tiers.
// QA_OUT=/mnt/ramdisk/spg3d-photoreal/final node qa/city-materials.mjs [medium|low|high]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
const out = process.env.QA_OUT ?? '/mnt/ramdisk/spg3d-photoreal/final';
const quality = process.argv[2] ?? 'medium';
mkdirSync(out, { recursive: true });
const port = Number(process.env.QA_PORT ?? 3891);
const server = spawn('node', ['scripts/serve.mjs', '--dir', process.env.DIST ?? 'dist', '--port', String(port)], { stdio: 'ignore' });
let browser;
const results = [];
try {
  for (let i=0;i<50;i++) { try { if ((await fetch(`http://localhost:${port}/`)).ok) break; } catch {} await new Promise(r=>setTimeout(r,200)); }
  browser = await chromium.launch({ args: ['--mute-audio','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const views = {
    shchyolkovo: [[112,3.5,-139,102,7,-104],[-192,4,55,-184,13,5]],
    ligovsky: [[-88,4,-535,-32,16,-478],[-145,3.5,-289,-197,13,-260]],
    warsaw: [[253,5,-90,7,80,6],[-310,5,265,-400,55,330]],
  };
  const insideRing=(x,z,flat)=>{
    let inside=false;
    for(let i=0,j=flat.length-2;i<flat.length;j=i,i+=2){
      const ax=flat[i]/10,az=flat[i+1]/10,bx=flat[j]/10,bz=flat[j+1]/10;
      if((az>z)!==(bz>z)&&x<(bx-ax)*(z-az)/(bz-az)+ax)inside=!inside;
    }
    return inside;
  };
  for (const [track, cameras] of Object.entries(views)) {
    if (process.env.QA_TRACKS && !process.env.QA_TRACKS.split(',').includes(track)) continue;
    const map=JSON.parse(readFileSync(new URL(`../src/data/maps/${track}.world.json`,import.meta.url),'utf8'));
    for(const [x,y,z] of cameras) for(const b of map.buildings){
      if(y>=b[1]/10 && y<b[0]/10 && insideRing(x,z,b[8]) && !b.slice(9).some(r=>insideRing(x,z,r))) throw new Error(`QA camera is inside building ${b[7]} in ${track}`);
    }
    const page = await browser.newPage({viewport:{width:1024,height:576}});
    await page.addInitScript(() => localStorage.setItem('spg3d-save-v2', JSON.stringify({settings:{dynamicRes:false}})));
    const errors=[];
    page.on('requestfailed', r=>errors.push(`request failed ${r.url()}: ${r.failure()?.errorText}`));
    page.on('pageerror', e=>errors.push(e.message));
    page.on('console', m=>{if(m.type()==='error') errors.push(m.text());});
    page.on('response', r=>{if(r.status()>=400) errors.push(`${r.status()} ${r.url()}`);});
    await page.goto(`http://localhost:${port}/?screen=race&track=${track}&q=${quality}&hud=0&opp=0&traffic=0&maxdt=0.2`,{timeout:120000});
    await page.waitForFunction(()=>window.__spg?.ready && window.__spg.knobs.viewFrom,null,{timeout:300000});
    await page.addStyleTag({content:'.hud, .music-widget { visibility: hidden !important; }'});
    const shots=[];
    for (const [i, camera] of cameras.entries()) {
      await page.evaluate(a=>window.__spg.knobs.viewFrom(...a),camera);
      await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
      const file=path.join(out,`${track}-${quality}-${i}.png`);
      await page.screenshot({path:file,timeout:240000});
      if (process.env.QA_REFLECTIONS && track === 'ligovsky' && quality === 'high' && i === 0) {
        await page.evaluate(()=>window.__spg.knobs.wetReflections(false));
        await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
        await page.screenshot({path:path.join(out, 'ligovsky-reflections-off.png'),timeout:240000});
        await page.evaluate(()=>window.__spg.knobs.wetReflections(true));
        await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
      }
      const snapshot=await page.evaluate(()=>window.__spg.snapshot());
      shots.push({file,camera,drawCalls:snapshot.drawCalls,triangles:snapshot.triangles,textures:snapshot.textures});
    }
    const visuals = await page.evaluate(()=>window.__spg.knobs.visualStats?.());
    if (visuals && (!visuals.interiorVertices || visuals.invalidPanes || (quality !== 'low' && (visuals.treeHeight < 5 || visuals.treeHeight > 12)))) errors.push('Invalid pane UVs or tree world-space geometry');
    const world=await page.evaluate(()=>window.__spg.knobs.worldStats());
    const surfaces = await page.evaluate(()=>window.__spg.knobs.surfaceStats());
    if (surfaces.invalid || !surfaces.meshes || !surfaces.layers.slice(1).some(n=>n>0)) errors.push('Invalid / missing city surface attributes');
    results.push({track,quality,world,surfaces,visuals,shots,errors});
    console.log(track,quality,JSON.stringify(shots.map(s=>({calls:s.drawCalls,triangles:s.triangles}))), 'errors',errors.length);
    writeFileSync(path.join(out,`report-${quality}.json`),JSON.stringify(results,null,2));
    await page.close();
  }
  if(results.some(r=>r.errors.length || r.shots.some(s=>!(s.drawCalls>0) || !(s.triangles>0)))) process.exitCode=1;
} finally {
  await browser?.close();
  server.kill();
}

// All evidence is written and the browser is closed; do not keep Node alive on server handles.
process.exit(process.exitCode ?? 0);
