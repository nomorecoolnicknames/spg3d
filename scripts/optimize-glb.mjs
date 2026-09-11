// Optimizes the raw Sketchfab car GLBs (src/assets/cars-src) into src/assets/cars:
// meshopt compression + webp textures capped at 1024px. Run: npm run assets:optimize
import { execFileSync } from 'node:child_process';
import { readdirSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const src = 'src/assets/cars-src';
const out = 'src/assets/cars';
mkdirSync(out, { recursive: true });
for (const f of readdirSync(src).filter((x) => x.endsWith('.glb'))) {
  const i = join(src, f), o = join(out, f);
  execFileSync('npx', ['gltf-transform', 'optimize', i, o, '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', '1024', '--simplify', 'false', '--join', 'false', '--flatten', 'false', '--prune', 'true'], { stdio: 'inherit' });
  console.log(f, (statSync(i).size / 1e6).toFixed(1), 'MB ->', (statSync(o).size / 1e6).toFixed(1), 'MB');
}
