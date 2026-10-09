#!/usr/bin/env python3
"""Start remote Jupyter, keep an SSH tunnel, and print a local login address."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shlex
import socket
import subprocess
import time
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parents[1]


def remote(host, command):
    return subprocess.run(["ssh", "-o", "BatchMode=yes", host, command],
                          check=True, capture_output=True, text=True, timeout=30).stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", required=True, help="SSH 配置中的实验机别名")
    parser.add_argument("--remote-dir", required=True, help="远程 hello-gpu 的绝对路径")
    parser.add_argument("--remote-port", type=int, default=8895)
    parser.add_argument("--local-port", type=int, default=8895)
    parser.add_argument("--show-url", action="store_true", help="在终端显示含登录 token 的地址")
    args = parser.parse_args()
    for port in (args.local_port, args.remote_port):
        if not 1024 < port < 65536:
            parser.error("端口必须在 1025–65535 之间")
    if not args.remote_dir.startswith("/"):
        parser.error("--remote-dir 请使用绝对路径")
    work = ROOT / ".artifacts/connections"
    work.mkdir(parents=True, exist_ok=True)
    key = f"localhost-{args.local_port}"
    record_path = work / f"{key}.json"
    if record_path.exists():
        previous = json.loads(record_path.read_text())
        try:
            os.kill(previous["tunnel_pid"], 0)
        except ProcessLookupError:
            pass
        else:
            if previous["host"] != args.host or previous["remote_dir"] != args.remote_dir or previous["remote_port"] != args.remote_port:
                parser.error("这个本地端口已有另一个连接，请改用 --local-port")
            print(previous["login_url"] if args.show_url else previous["url"])
            print(f"登录地址保存于 {record_path}")
            return
    with socket.socket() as probe:
        try:
            probe.bind(("127.0.0.1", args.local_port))
        except OSError:
            parser.error("本地端口被占用，请改用 --local-port")
    remote_root = args.remote_dir + "/notebooks"
    listing = (
        "import json; from jupyter_server.serverapp import list_running_servers; "
        "print(json.dumps(list(list_running_servers())))"
    )
    python = shlex.quote(remote_root + "/part0-intro/.venv/bin/python")
    list_command = python + " -c " + shlex.quote(listing)
    servers = json.loads(remote(args.host, list_command))
    matching = [s for s in servers if s["port"] == args.remote_port and s["root_dir"] == remote_root]
    if not matching:
        # Close inherited SSH descriptors before detaching the server, so the
        # startup request can return while Jupyter continues running.
        starter = (
            "import subprocess; from pathlib import Path; "
            f"root=Path({remote_root!r}); "
            "log=root/'.artifacts/jupyter/server.log'; log.parent.mkdir(parents=True, exist_ok=True); "
            "stream=log.open('ab'); "
            f"p=subprocess.Popen(['bash',str(root/'tools/serve.sh'),{str(args.remote_port)!r}], "
            "cwd=root.parent,stdin=subprocess.DEVNULL,stdout=stream,stderr=stream, "
            "start_new_session=True,close_fds=True); print(p.pid)"
        )
        command = python + " -c " + shlex.quote(starter)
        remote(args.host, command)
        for _ in range(20):
            time.sleep(0.5)
            servers = json.loads(remote(args.host, list_command))
            matching = [s for s in servers if s["port"] == args.remote_port and s["root_dir"] == remote_root]
            if matching:
                break
        if not matching:
            raise RuntimeError("Jupyter 未启动，请查看远程 notebooks/.artifacts/jupyter/server.log")
    log = (work / f"{key}.log").open("ab")
    tunnel = subprocess.Popen([
        "ssh", "-N", "-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes",
        "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=3",
        "-L", f"127.0.0.1:{args.local_port}:127.0.0.1:{args.remote_port}", args.host,
    ], stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
    time.sleep(0.5)
    if tunnel.poll() is not None:
        raise RuntimeError(f"SSH 转发失败，详情见 {log.name}")
    server = matching[0]
    url = f"http://127.0.0.1:{args.local_port}/lab"
    login_url = url + ("?" + urlencode({"token": server["token"]}) if server.get("token") else "")
    record = {"host": args.host, "remote_dir": args.remote_dir, "remote_port": args.remote_port,
              "local_port": args.local_port, "tunnel_pid": tunnel.pid,
              "url": url, "login_url": login_url}
    # The token stays in an ignored local file with owner-only permissions.
    descriptor = os.open(record_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        json.dump(record, stream, ensure_ascii=False, indent=2)
    print(login_url if args.show_url else url)
    print(f"登录地址保存于 {record_path}；结束连接可执行 kill {tunnel.pid}")


if __name__ == "__main__":
    main()
