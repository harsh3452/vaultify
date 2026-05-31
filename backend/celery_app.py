import os
import sys
from celery import Celery
from celery.schedules import crontab
from dotenv import load_dotenv

load_dotenv()

# Add both the backend/ directory AND the repo root to sys.path so that
#   (a) flat imports like `from auth import db` work (needs backend/ on path)
#   (b) dotted imports like `backend.tasks.*` work with -A backend.celery_app
_backend_dir = os.path.dirname(os.path.abspath(__file__))
_repo_root   = os.path.dirname(_backend_dir)
for _p in (_backend_dir, _repo_root):
    if _p not in sys.path:
        sys.path.insert(0, _p)

def make_celery(app_name='vaultify'):
    broker = os.getenv('CELERY_BROKER_URL', 'redis://localhost:6379/0')
    backend = os.getenv('CELERY_RESULT_BACKEND', 'redis://localhost:6379/1')
    celery = Celery(app_name, broker=broker, backend=backend)
    celery.conf.update(
        task_serializer='json',
        accept_content=['json'],
        result_serializer='json',
        timezone='UTC',
        enable_utc=True,
        # Use dotted path matching the -A backend.celery_app prefix
        imports=(
            'backend.tasks.reanalyze_tasks',
            'backend.tasks.periodic_tasks',
        ),
        # Beat schedule — periodic tasks run automatically
        beat_schedule={
            'retry-stuck-docs-every-5-minutes': {
                'task': 'backend.tasks.periodic_tasks.retry_stuck_documents',
                'schedule': crontab(minute='*/5'),  # every 5 minutes
            },
        },
    )
    return celery


celery = make_celery()