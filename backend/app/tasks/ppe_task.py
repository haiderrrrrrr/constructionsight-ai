"""
Celery PPE detection task.
Runs in a separate Celery worker process (AI_MODE=celery).
"""

from __future__ import annotations

import logging

import cv2
import numpy as np

from ..celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(
    name="app.tasks.ppe_task.run_ppe_detection",
    bind=True,
    max_retries=2,
    queue="ppe",
)
def run_ppe_detection(self, camera_id: int, frame_bytes: bytes, ts: float) -> None:
    """
    Deserialise frame, run PPE inference, apply rules, persist + broadcast.
    Mirrors _process_frame() in ai_orchestrator.py but runs in a worker process.
    """
    try:
        from ..ml.inference.ppe_detector import ppe_detector
        from ..services.incident_engine import incident_engine
        from ..services.websocket_manager import ws_manager
        from ..services.ai_orchestrator import _save_events_to_db

        # Decode JPEG bytes → numpy frame
        buf   = np.frombuffer(frame_bytes, dtype=np.uint8)
        frame = cv2.imdecode(buf, cv2.IMREAD_COLOR)
        if frame is None:
            return

        detections = ppe_detector.detect(frame, camera_id=camera_id)
        events     = incident_engine.process(camera_id, detections, ts)
        _save_events_to_db(events)
        for ev in events:
            ws_manager.broadcast_sync(ev.camera_id, ev)

    except Exception as exc:
        logger.error("run_ppe_detection cam=%d: %s", camera_id, exc)
        raise self.retry(exc=exc, countdown=2)
