"""Fetch the original CC0 tree with every dependency, checking all recorded source MD5s.
python3 scripts/fetch-city-tree.py /path/to/cache
The small source manifest is versioned beside the processed game asset.
"""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import sys
import urllib.request

root = Path(__file__).resolve().parents[1]
cache = Path(sys.argv[1])
source = json.loads((root / 'src/assets/trees/street-tree-source.json').read_text())['download']


def fetch(item):
    name, record = item
    target = cache / name
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and hashlib.md5(target.read_bytes()).hexdigest() == record['md5']:
        return
    request = urllib.request.Request(record['url'], headers={'User-Agent': 'SPG3D-asset-builder/1.0'})
    with urllib.request.urlopen(request, timeout=90) as response:
        data = response.read()
    if hashlib.md5(data).hexdigest() != record['md5']:
        raise RuntimeError(f'Source checksum mismatch: {name}')
    target.write_bytes(data)
    print(name, len(data), flush=True)


with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    list(pool.map(fetch, [('tree.gltf', source), *source['include'].items()]))
