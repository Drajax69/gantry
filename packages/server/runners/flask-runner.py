"""Gantry managed python runtime: run a Flask app from the checkout only.

Imports ``$GANTRY_ENTRY`` (a module under the checkout's ``src/``), takes its
``app`` and serves it on 127.0.0.1:$PORT with the reloader enabled and the
debugger disabled. No worker, queue or cleanup process is started here.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(os.environ["GANTRY_CHECKOUT"]) / "src"))
module = __import__(os.environ["GANTRY_ENTRY"])
app = module.app

app.run(host="127.0.0.1", port=int(os.environ["PORT"]), use_reloader=True, use_debugger=False)
