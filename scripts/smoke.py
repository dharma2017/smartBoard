"""Exercise the production frontend proxy and a real API process with isolated data.

Run after `npm --prefix apps/web run build`: python scripts/smoke.py
No browser or live LLM credentials are required.
"""

import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from uuid import uuid4

ROOT = Path(__file__).resolve().parent.parent


def free_port():
    with socket.socket() as connection:
        connection.bind(("127.0.0.1", 0))
        return connection.getsockname()[1]


def wait_ready(url, process):
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"Service exited early: {process.returncode}")
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status == 200:
                    return
        except (urllib.error.URLError, TimeoutError):
            pass
        time.sleep(0.2)
    raise RuntimeError(f"Service did not become ready: {url}")


def stop(process):
    if process and process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def main():
    api_process = web_process = None
    with tempfile.TemporaryDirectory(prefix="smartboard-smoke-") as temporary:
        temp = Path(temporary)
        api_port, web_port = free_port(), free_port()
        api_url, web_url = (
            f"http://127.0.0.1:{api_port}",
            f"http://127.0.0.1:{web_port}",
        )
        environment = {
            **os.environ,
            "DATABASE_URL": f"sqlite:///{(temp / 'boards.db').as_posix()}",
            "LLM_PROVIDER": "demo",
            "AUTH_MODE": "dev",
            "BOARD_SERVICE_URL": api_url,
        }
        venv_python = (
            ROOT / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        )
        python = os.getenv(
            "SMARTBOARD_PYTHON",
            str(venv_python) if venv_python.exists() else sys.executable,
        )
        api_command = [
            python,
            "-B",
            "-m",
            "uvicorn",
            "smartboard.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(api_port),
        ]
        hidden = (
            {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}
        )
        with (
            (temp / "api.log").open("w+") as api_log,
            (temp / "web.log").open("w+") as web_log,
        ):

            def launch_api():
                return subprocess.Popen(
                    api_command,
                    cwd=ROOT / "services/api",
                    env=environment,
                    stdout=api_log,
                    stderr=subprocess.STDOUT,
                    **hidden,
                )

            def request(path, data=None, headers=None):
                req = urllib.request.Request(
                    web_url + "/api/v1" + path,
                    data=json.dumps(data).encode() if data is not None else None,
                    headers={"Content-Type": "application/json", **(headers or {})},
                )
                return urllib.request.urlopen(req, timeout=30)

            def api(path, data=None, headers=None):
                with request(path, data, headers) as response:
                    return json.load(response)["data"]

            try:
                api_process = launch_api()
                wait_ready(api_url + "/api/v1/health", api_process)
                node = os.getenv("SMARTBOARD_NODE", "node")
                web_process = subprocess.Popen(
                    [
                        node,
                        str(ROOT / "apps/web/node_modules/next/dist/bin/next"),
                        "start",
                        "--hostname",
                        "127.0.0.1",
                        "--port",
                        str(web_port),
                    ],
                    cwd=ROOT / "apps/web",
                    env=environment,
                    stdout=web_log,
                    stderr=subprocess.STDOUT,
                    **hidden,
                )
                wait_ready(web_url, web_process)
                assert api("/health")["provider"] == "demo"
                board = api(
                    "/boards",
                    {"title": "Isolated vertical slice check"},
                    {"Idempotency-Key": str(uuid4())},
                )
                bid = board["boardId"]
                heading, equation, unrelated = str(uuid4()), str(uuid4()), str(uuid4())
                objects = [
                    {
                        "id": heading,
                        "boardId": bid,
                        "type": "TEXT",
                        "x": 80,
                        "y": 90,
                        "width": 400,
                        "height": 50,
                        "content": {"text": "Newton’s second law", "role": "heading"},
                    },
                    {
                        "id": equation,
                        "boardId": bid,
                        "type": "EQUATION",
                        "x": 120,
                        "y": 260,
                        "width": 350,
                        "height": 95,
                        "content": {"text": "F = ma"},
                    },
                    {
                        "id": unrelated,
                        "boardId": bid,
                        "type": "TEXT",
                        "x": 750,
                        "y": 120,
                        "width": 200,
                        "height": 80,
                        "content": {"text": "Unrelated chemistry"},
                    },
                ]
                operations = {
                    "baseVersion": 1,
                    "operations": [
                        {
                            "operationId": str(uuid4()),
                            "type": "OBJECT_CREATE",
                            "object": o,
                        }
                        for o in objects
                    ],
                }
                saved = api(f"/boards/{bid}/operations", operations)
                assert saved["currentVersion"] == 2
                retry = api(f"/boards/{bid}/operations", operations)
                assert retry["savedOperations"] == 0 and len(retry["objects"]) == 3
                selection = api(
                    f"/boards/{bid}/selection",
                    {"selectionType": "OBJECT", "objectIds": [equation]},
                )
                assert selection["surroundingContext"][0]["id"] == heading
                assert unrelated not in json.dumps(selection)
                payload = {
                    "boardId": bid,
                    "selectionId": selection["selectionId"],
                    "question": "Explain this in simple language.",
                }
                first_delta = completed = None
                event_names = []
                with request("/ai/ask/stream", payload) as response:
                    for raw in response:
                        line = raw.decode()
                        if line.startswith("event:"):
                            event_names.append(line.strip())
                        if (
                            line.startswith("event: answer_delta")
                            and first_delta is None
                        ):
                            first_delta = time.monotonic()
                        if line.startswith("event: completed"):
                            completed = time.monotonic()
                stream_result = api(f"/boards/{bid}")["interactions"][0]
                assert first_delta and completed, (
                    f"Stream did not complete: {event_names}; saved state: {stream_result['status']}"
                )
                provider_seconds = stream_result["usage"]["durationMs"] / 1000
                assert completed - first_delta >= max(0.001, provider_seconds * 0.25), (
                    f"Proxy buffered generation: visible interval={completed - first_delta:.3f}s, provider duration={provider_seconds:.3f}s"
                )
                restored = api(f"/boards/{bid}")
                assert restored["interactions"][0]["status"] == "COMPLETED"
                assert "F = ma" in restored["interactions"][0]["answer"]
                # Close an in-progress stream through the actual web proxy.
                with request(
                    "/ai/ask/stream",
                    {**payload, "question": "Give me another example."},
                ) as response:
                    for raw in response:
                        if raw.startswith(b"event: answer_delta"):
                            break
                deadline = time.monotonic() + 5
                while time.monotonic() < deadline:
                    restored = api(f"/boards/{bid}")
                    if restored["interactions"][-1]["status"] == "CANCELLED":
                        break
                    time.sleep(0.1)
                assert restored["interactions"][-1]["status"] == "CANCELLED", (
                    "Disconnect did not cancel generation"
                )
                stop(api_process)
                api_process = launch_api()
                wait_ready(api_url + "/api/v1/health", api_process)
                restored = api(f"/boards/{bid}")
                assert len(restored["objects"]) == 3
                assert (
                    restored["latestSelection"]["selectionId"]
                    == selection["selectionId"]
                )
                assert restored["interactions"][0]["status"] == "COMPLETED"
                print(
                    "PASS: production frontend, proxy, save/retry, selection, streamed answer, disconnect cancellation, and restart persistence"
                )
            except Exception:
                for label, log in (("API", api_log), ("WEB", web_log)):
                    log.flush()
                    log.seek(0)
                    print(
                        f"{label} service log:\n{log.read()[-6000:]}", file=sys.stderr
                    )
                raise
            finally:
                stop(web_process)
                stop(api_process)


if __name__ == "__main__":
    main()
