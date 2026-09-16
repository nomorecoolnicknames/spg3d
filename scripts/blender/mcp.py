#!/usr/bin/env python3
"""Client for the Blender MCP addon (ahujasid/blender-mcp) that runs inside a live Blender.

Start the server once (it keeps a GUI Blender alive on a virtual display):

    xvfb-run -a $BLENDER --python scripts/blender/mcp_start.py

Then drive it:

    python3 scripts/blender/mcp.py info                 # scene summary
    python3 scripts/blender/mcp.py code build_sign.py   # run a script inside that Blender
    python3 scripts/blender/mcp.py code - <<'PY' ...    # or from stdin

Modelling scripts see the live scene, so they can be re-run and re-rendered without restarting Blender.
"""
import json
import socket
import sys

HOST, PORT = 'localhost', 9876


def send(cmd: str, params: dict | None = None, timeout: float = 900.0) -> dict:
    s = socket.create_connection((HOST, PORT), timeout=20)
    s.settimeout(timeout)
    s.sendall(json.dumps({'type': cmd, 'params': params or {}}).encode())
    buf = b''
    while True:
        chunk = s.recv(1 << 16)
        if not chunk:
            break
        buf += chunk
        try:
            data = json.loads(buf.decode())
            break
        except json.JSONDecodeError:
            continue
    else:
        raise RuntimeError('connection closed before a full reply')
    s.close()
    return data


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 2
    cmd = args[0]
    if cmd == 'info':
        out = send('get_scene_info')
    elif cmd == 'code':
        src = sys.stdin.read() if len(args) < 2 or args[1] == '-' else open(args[1]).read()
        out = send('execute_code', {'code': src})
    else:
        out = send(cmd, json.loads(args[1]) if len(args) > 1 else {})
    if out.get('status') == 'error':
        print('ERROR:', out.get('message'), file=sys.stderr)
        return 1
    res = out.get('result', out)
    print(res.get('result', json.dumps(res, ensure_ascii=False, indent=1)) if isinstance(res, dict) else res)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
