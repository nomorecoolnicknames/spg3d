"""Import CC0 Poly Haven surfaces into a Blender bake directory before assemble-surfaces.py.
Original downloads stay in the supplied cache. Each source is checked against the API MD5;
the manifest retains authors, real-world scale, source URLs and original file hashes.
"""
import concurrent.futures
import hashlib
import json
import sys
import urllib.request
from pathlib import Path
from PIL import Image

out = Path(sys.argv[1])
cache = Path(sys.argv[2])
cache.mkdir(parents=True, exist_ok=True)
selection = {
 'brick_red': 'brick_wall_001', 'brick_silicate': 'painted_brick',
 'plaster_smooth': 'painted_plaster_wall', 'plaster_rough': 'grey_plaster',
 'granite': 'granite_tile', 'roof_tiles': 'clay_roof_tiles',
 'pavement_slabs': 'concrete_pavement', 'cobbles': 'cobblestone_pavement',
 'tarmac_yard': 'asphalt_02', 'grass': 'leafy_grass',
 'gravel': 'gravel_floor', 'wood_planks': 'weathered_brown_planks',
}

def get(url):
    req = urllib.request.Request(url, headers={'User-Agent':'SPG3D-asset-builder/1.0 (local game art pipeline)'})
    with urllib.request.urlopen(req, timeout=90) as r:
        return r.read()

catalog_path = cache / 'catalog.json'
if not catalog_path.exists(): catalog_path.write_bytes(get('https://api.polyhaven.com/assets?t=textures'))
catalog = json.loads(catalog_path.read_text())
meta = json.loads((out/'tiles.json').read_text())

def fetch(item):
    name, asset = item
    info = catalog[asset]
    folder = cache / asset
    folder.mkdir(exist_ok=True)
    fp = folder / 'files.json'
    if not fp.exists(): fp.write_bytes(get('https://api.polyhaven.com/files/' + asset))
    files = json.loads(fp.read_text())
    channels = {'albedo': ['diff', 'Diffuse'], 'normal':['nor_gl'], 'rough':['rough', 'Rough'], 'ao':['ao', 'AO']}
    provenance = {}
    for channel, candidates in channels.items():
        key = next((k for k in candidates if k in files), None)
        if key is None and channel == 'ao':
            Image.new('RGB', (meta['size'], meta['size']), 'white').save(out / f'{name}_ao.png')
            continue
        if key is None: raise ValueError(f'{asset}: missing {channel}')
        data = files[key]['1k'].get('png') or files[key]['1k']['jpg']
        path = folder / data['url'].split('/')[-1]
        if not path.exists() or hashlib.md5(path.read_bytes()).hexdigest() != data['md5']:
            path.write_bytes(get(data['url']))
        assert hashlib.md5(path.read_bytes()).hexdigest() == data['md5'], path
        im = Image.open(path).convert('RGB').resize((meta['size'],meta['size']), Image.Resampling.LANCZOS)
        im.save(out / f'{name}_{channel}.png')
        provenance[channel] = {'url':data['url'], 'md5':data['md5']}
    print(name, '<-', asset, flush=True)
    return name, {'source':'https://polyhaven.com/a/'+asset, 'license':'CC0-1.0', 'authors':info['authors'],
                  'metres':info['dimensions'][0]/1000, 'files':provenance, 'seamless':True}

with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    results = dict(pool.map(fetch, selection.items()))
for t in meta['tiles']:
    if t['name'] in results: t.update(results[t['name']])
(out/'tiles.json').write_text(json.dumps(meta, indent=2)+'\n')
