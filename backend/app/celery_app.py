from celery import Celery
from app.core.config import settings

celery_app = Celery(
    "constructionsight",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=[
        "app.tasks.ppe_task",
        "app.tasks.clipper_task",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    result_expires=3600,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,   # one task at a time per worker (GPU-bound)
    task_routes={
        "app.tasks.ppe_task.*": {"queue": "ppe"},
        "app.tasks.clipper_task.*": {"queue": "clipper"},
    },
)
