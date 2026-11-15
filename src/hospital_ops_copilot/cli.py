"""Command line interface: ``hoc download | build | index | ask | api | ui | eval``."""

from __future__ import annotations

import argparse
import json
import logging
import subprocess
import sys
from pathlib import Path


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="hoc", description="Hospital Ops Copilot")
    p.add_argument("-v", "--verbose", action="store_true")
    sub = p.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("download", help="Download CMS cost report files")
    d.add_argument("--years", type=int, nargs="*")
    d.add_argument("--force", action="store_true")

    b = sub.add_parser("build", help="Build the KPI table from downloaded files")
    b.add_argument("--years", type=int, nargs="*")

    i = sub.add_parser("index", help="Build the documentation embedding index")
    i.add_argument("--embed-model")

    a = sub.add_parser("ask", help="Ask the copilot a question")
    a.add_argument("question")
    a.add_argument("--ccn")
    a.add_argument("--year", type=int)
    a.add_argument("--model")
    a.add_argument("--offline", action="store_true")
    a.add_argument("--json", action="store_true")

    api = sub.add_parser("api", help="Run the REST API")
    api.add_argument("--port", type=int, default=8000)
    api.add_argument("--host", default="127.0.0.1")

    sub.add_parser("ui", help="Run the Streamlit app")

    e = sub.add_parser("eval", help="Run evaluations")
    e.add_argument("suite", choices=["retrieval", "agent", "rescore", "report"])
    e.add_argument("--models", nargs="*")
    e.add_argument("--embed-models", nargs="*")
    e.add_argument("--limit", type=int)
    e.add_argument("--offline", action="store_true", help="Agent suite: also score the offline router")

    args = p.parse_args(argv)
    logging.basicConfig(level=logging.INFO if args.verbose or args.cmd in ("download", "build", "index") else logging.WARNING,
                        format="%(levelname)s %(name)s: %(message)s")

    if args.cmd == "download":
        from .data.download import download
        for path in download(args.years, force=args.force):
            print(path)
    elif args.cmd == "build":
        from .data.build import build
        df = build(years=args.years)
        print(f"{len(df):,} hospital-years, {df['ccn'].nunique():,} hospitals, years {sorted(int(y) for y in df['year'].unique())}")
    elif args.cmd == "index":
        from .rag.index import Retriever
        r = Retriever(embed_model=args.embed_model)
        r.search("operating margin")
        print(f"{len(r.chunks)} chunks indexed, mode={r.active_mode}, embed_model={r.embed_model}")
    elif args.cmd == "ask":
        from .llm.agent import Copilot
        c = Copilot(model=args.model)
        ans = c.ask(args.question, context_ccn=args.ccn, context_year=args.year, force_offline=args.offline)
        if args.json:
            print(json.dumps(ans.to_dict(), indent=2, default=str))
        else:
            print(ans.answer)
            g = ans.grounding.to_dict() if ans.grounding else {}
            print(f"\n[{ans.backend}{' ' + ans.model if ans.model else ''} | tools: {', '.join(ans.tools_called) or 'none'} | "
                  f"grounded {g.get('numbers_grounded', 0)}/{g.get('numbers_checked', 0)} | {ans.latency_s:.1f}s]")
            for n in ans.notes:
                print(f"note: {n}")
    elif args.cmd == "api":
        import uvicorn
        uvicorn.run("hospital_ops_copilot.api.main:app", host=args.host, port=args.port)
    elif args.cmd == "ui":
        app = Path(__file__).parent / "ui" / "app.py"
        proc = subprocess.Popen([sys.executable, "-m", "streamlit", "run", str(app)])
        try:
            return proc.wait()
        except KeyboardInterrupt:  # Ctrl+C: let Streamlit shut down, then exit without a traceback
            proc.wait()
            print("\nStopped.")
            return 0
    elif args.cmd == "eval":
        root = Path(__file__).resolve().parents[2]
        sys.path.insert(0, str(root))
        from evals import run as evals_run
        return evals_run.main(args)
    return 0


def _entry() -> int:
    try:
        return main()
    except KeyboardInterrupt:
        print("\nStopped.")
        return 130


if __name__ == "__main__":
    raise SystemExit(_entry())
