"""
Development server with hot reload and multiple workers.
Watches for changes and restarts both API and Stream servers.
"""
import argparse
import subprocess
import sys
import time
from watchfiles import watch


def start_api_server(workers: int):
    print(f"🚀 Starting API Server on port 8000 ({workers} worker{'s' if workers != 1 else ''})...")
    return subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app",
         "--host", "0.0.0.0", "--port", "8000", "--workers", str(workers)],
        cwd="."
    )


def start_stream_server(workers: int):
    print(f"🚀 Starting Stream Server on port 8001 ({workers} worker{'s' if workers != 1 else ''})...")
    return subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app_stream:app",
         "--host", "0.0.0.0", "--port", "8001", "--workers", str(workers)],
        cwd="."
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("target", choices=["api", "stream", "both"], nargs="?", default="both")
    parser.add_argument("--api-workers", type=int, default=2)
    parser.add_argument("--stream-workers", type=int, default=1)
    parser.add_argument("--startup-delay", type=int, default=0, help="Seconds to wait before starting (use for stream to avoid migration deadlock with api)")
    args = parser.parse_args()

    api_proc = None
    stream_proc = None

    if args.startup_delay > 0:
        print(f"⏳ Waiting {args.startup_delay}s before starting...")
        time.sleep(args.startup_delay)

    if args.target in ("api", "both"):
        api_proc = start_api_server(args.api_workers)
    if args.target in ("stream", "both"):
        if args.target == "both":
            time.sleep(4)  # Let api finish migrations before stream starts
        stream_proc = start_stream_server(args.stream_workers)

    print("\n✅ Server(s) running!")
    print("👀 Watching for code changes...\n")
    print("Press Ctrl+C to stop\n")

    try:
        for _ in watch("app", "app_stream.py"):
            print("\n📝 Changes detected! Restarting servers...\n")

            if api_proc:
                api_proc.terminate()
                api_proc.wait()
            if stream_proc:
                stream_proc.terminate()
                stream_proc.wait()

            if args.target in ("api", "both"):
                api_proc = start_api_server(args.api_workers)
            if args.target in ("stream", "both"):
                if args.target == "both":
                    time.sleep(4)
                stream_proc = start_stream_server(args.stream_workers)

    except KeyboardInterrupt:
        print("\n\n🛑 Stopping servers...")
        if api_proc:
            api_proc.terminate()
            api_proc.wait()
        if stream_proc:
            stream_proc.terminate()
            stream_proc.wait()
        print("✅ Stopped!")
