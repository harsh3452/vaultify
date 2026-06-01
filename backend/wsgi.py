"""
WSGI entry point for Gunicorn.
Adds the backend/ directory to sys.path so flat imports (e.g. "from auth import db")
work correctly when running from the repo root.
"""
import os
import sys

# Add backend/ directory to sys.path so flat imports resolve
_backend_dir = os.path.dirname(os.path.abspath(__file__))
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

from app_secure import app

if __name__ == "__main__":
    app.run()