"""Stream-only FastAPI app — port 8001, 1 worker."""
import logging
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded

logger = logging.getLogger(__name__)

from app.core.db import Base, engine
from app.core.config import settings
from app.core.limiter import limiter
from app.api.routes.ml_stream_enterprise import router as ml_stream_router
from app.api.routes.project_ppe import router as project_ppe_router
from app.api.routes.project_workforce import router as project_workforce_router
from app.api.routes.user_notifications import router as user_notifications_router
from app.api.routes.project_tasks import router as project_tasks_router
from app.api.routes.admin_cameras import router as admin_cameras_router
from app.api.routes.projects import router as projects_router
from app.api.routes.project_reports import router as project_reports_router
from app.api.routes.project_risk import router as project_risk_router
from app.api.routes.admin_risk import router as admin_risk_router
from app.api.routes.dev_video_test import router as dev_video_test_router
from sqlalchemy import text

app = FastAPI(
    title="ConstructionSight Stream Service",
    version="1.0",
    openapi_url=None,
    docs_url=None,
)

app.state.limiter = limiter

@app.exception_handler(RateLimitExceeded)
def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(
        {"detail": "Too many attempts. Please wait a moment before trying again."},
        status_code=429,
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.allowed_origins),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def on_startup():
    if engine.dialect.name == "postgresql":
        with engine.begin() as _pre:
            _pre.execute(text("""
                DO $$ BEGIN
                    CREATE TYPE violationtype AS ENUM ('no_helmet', 'no_vest');
                EXCEPTION WHEN duplicate_object THEN NULL;
                END $$;
            """))
            _pre.execute(text("""
                DO $$ BEGIN
                    CREATE TYPE incidentstatus AS ENUM ('active', 'resolved');
                EXCEPTION WHEN duplicate_object THEN NULL;
                END $$;
            """))

    Base.metadata.create_all(bind=engine)

    import asyncio as _asyncio
    _loop = _asyncio.get_running_loop()

    # Register the running event loop with all SSE brokers so push() works
    try:
        from app.services.ppe_dashboard_broker import set_event_loop as _set_dash_loop
        _set_dash_loop(_loop)
        logger.info("[app_stream] PPE dashboard broker event loop registered")
    except Exception as e:
        logger.warning(f"[app_stream] PPE dashboard broker loop setup failed: {e}")

    try:
        from app.services.notification_broker import set_event_loop as _set_notif_loop
        _set_notif_loop(_loop)
        logger.info("[app_stream] Notification broker event loop registered")
    except Exception as e:
        logger.warning(f"[app_stream] Notification broker loop setup failed: {e}")

    try:
        from app.services.project_task_broker import set_event_loop as _set_task_loop
        _set_task_loop(_loop)
        logger.info("[app_stream] Project task broker event loop registered")
    except Exception as e:
        logger.warning(f"[app_stream] Project task broker loop setup failed: {e}")

    try:
        from app.services.camera_health_broker import set_event_loop as _set_cam_loop
        _set_cam_loop(_loop)
        logger.info("[app_stream] Camera health broker event loop registered")
    except Exception as e:
        logger.warning(f"[app_stream] Camera health broker loop setup failed: {e}")

    try:
        from app.services.project_camera_broker import set_event_loop as _set_proj_cam_loop
        _set_proj_cam_loop(_loop)
        logger.info("[app_stream] Project camera broker event loop registered")
    except Exception as e:
        logger.warning(f"[app_stream] Project camera broker loop setup failed: {e}")

    try:
        from app.services.workforce_dashboard_broker import set_event_loop as _set_wf_dash_loop
        _set_wf_dash_loop(_loop)
        logger.info("[app_stream] Workforce dashboard broker event loop registered")
    except Exception as e:
        logger.warning(f"[app_stream] Workforce dashboard broker loop setup failed: {e}")

    try:
        from app.services.risk_dashboard_broker import set_event_loop as _set_risk_dash_loop
        _set_risk_dash_loop(_loop)
        logger.info("[app_stream] Risk dashboard broker event loop registered")
    except Exception as e:
        logger.warning(f"[app_stream] Risk dashboard broker loop setup failed: {e}")

    try:
        from app.services.activity_dashboard_broker import set_event_loop as _set_act_dash_loop
        _set_act_dash_loop(_loop)
        logger.info("[app_stream] Activity dashboard broker event loop registered")
    except Exception as e:
        logger.warning(f"[app_stream] Activity dashboard broker loop setup failed: {e}")

    try:
        from app.services.equipment_dashboard_broker import set_event_loop as _set_eq_dash_loop
        _set_eq_dash_loop(_loop)
        logger.info("[app_stream] Equipment dashboard broker event loop registered")
    except Exception as e:
        logger.warning(f"[app_stream] Equipment dashboard broker loop setup failed: {e}")

    try:
        from app.services.workforce_event_queue import start_workers as _start_wf_workers
        _start_wf_workers()
        logger.info("[app_stream] Workforce event queue workers started")
    except Exception as e:
        logger.error(f"[app_stream] Failed to start workforce event queue workers: {e}", exc_info=True)

    try:
        from app.services.activity_event_queue import start_workers as _start_act_workers
        _start_act_workers()
        logger.info("[app_stream] Activity event queue workers started")
    except Exception as e:
        logger.error(f"[app_stream] Failed to start activity event queue workers: {e}", exc_info=True)

    try:
        from app.services.equipment_event_queue import start_workers as _start_eq_workers
        _start_eq_workers()
        logger.info("[app_stream] Equipment event queue workers started")
    except Exception as e:
        logger.error(f"[app_stream] Failed to start equipment event queue workers: {e}", exc_info=True)

    try:
        from app.services.incident_event_queue import start_workers as _start_workers
        logger.info("[app_stream] Starting incident event queue workers...")
        _start_workers()
        logger.info("[app_stream] Incident event queue workers started")
    except Exception as e:
        logger.error(f"[app_stream] Failed to start incident event queue workers: {e}", exc_info=True)

    # Pre-warm RTSP captures for all verified cameras in active projects.
    # This keeps FFmpeg connections open so when a feature is enabled the first
    # annotated frame arrives in ~200ms instead of waiting for RTSP reconnect (1–3s).
    try:
        import threading as _wt
        from app.core.db import SessionLocal as _SL_w
        from app.models.project_camera import ProjectCamera as _PC_w
        from app.models.project import Project as _Proj_w, ProjectStatus as _PS_w
        from app.models.camera import Camera as _Cam_w, CameraCredential as _Cred_w, RegistryStatus as _RS_w
        from app.core.crypto import decrypt_credential as _dec

        def _warm_captures():
            _db = _SL_w()
            try:
                rows = (
                    _db.query(_PC_w, _Cam_w, _Cred_w)
                    .join(_Cam_w, _Cam_w.id == _PC_w.camera_id)
                    .join(_Cred_w, _Cred_w.camera_id == _Cam_w.id)
                    .join(_Proj_w, _Proj_w.id == _PC_w.project_id)
                    .filter(
                        _Proj_w.status == _PS_w.ACTIVE,
                        _Cam_w.registry_status == _RS_w.verified,
                    )
                    .all()
                )
                from app.api.routes.ml_stream_enterprise import acquire_capture as _ac
                for pc, cam, cred in rows:
                    try:
                        rtsp = _dec(cred.rtsp_url_enc) if cred.rtsp_url_enc else None
                        if not rtsp:
                            continue
                        user = _dec(cred.username_enc) if cred.username_enc else None
                        pwd  = _dec(cred.password_enc) if cred.password_enc else None
                        if user and pwd:
                            if rtsp.startswith("rtsp://"):
                                rtsp = f"rtsp://{user}:{pwd}@{rtsp[7:]}"
                        transport = cred.transport_preference or "tcp"
                        _ac(cam.id, rtsp, transport)
                        logger.info(f"[app_stream] Pre-warmed capture camera={cam.id}")
                    except Exception as e:
                        logger.debug(f"[app_stream] Pre-warm failed camera={cam.id}: {e}")
            finally:
                _db.close()

        _wt.Thread(target=_warm_captures, daemon=True, name="capture-warmup").start()
    except Exception as e:
        logger.warning(f"[app_stream] Capture pre-warm setup failed (non-fatal): {e}")

    # Restore feature branches that were enabled before restart.
    # branch_manager is in-memory only — on restart all branches are dead.
    # Re-read the DB and restart any camera that had ppe_enabled or workforce_enabled=True.
    try:
        from app.core.db import SessionLocal as _SL
        from app.models.project_camera_analytics import ProjectCameraAnalytics
        from app.models.project_camera import ProjectCamera
        from app.models.project import Project, ProjectStatus
        from app.services import branch_manager as _bm

        _db = _SL()
        try:
            rows = (
                _db.query(ProjectCameraAnalytics)
                .join(ProjectCamera, ProjectCamera.id == ProjectCameraAnalytics.project_camera_id)
                .join(Project, Project.id == ProjectCamera.project_id)
                .filter(
                    Project.status == ProjectStatus.ACTIVE,
                )
                .all()
            )
            for row in rows:
                pc = _db.query(ProjectCamera).filter(ProjectCamera.id == row.project_camera_id).first()
                if not pc:
                    continue
                if row.ppe_enabled:
                    ok = _bm.enable_feature(pc.camera_id, "ppe", db=_db)
                    logger.info(f"[app_stream] Restored PPE branch camera={pc.camera_id}: {'ok' if ok else 'failed'}")
                if row.workforce_enabled:
                    ok = _bm.enable_feature(pc.camera_id, "workforce", db=_db)
                    logger.info(f"[app_stream] Restored workforce branch camera={pc.camera_id}: {'ok' if ok else 'failed'}")
        finally:
            _db.close()
    except Exception as e:
        logger.warning(f"[app_stream] Feature branch restore failed (non-fatal): {e}")

    # Keep inference in sync with DB toggles (important when API runs on 8000
    # and stream/inference runs on 8001). Feature toggles update DB via 8000,
    # so 8001 must reconcile and stop pipelines to release GPU.
    try:
        import threading as _threading
        import time as _time
        from app.core.db import SessionLocal as _SL2
        from app.models.project_camera_analytics import ProjectCameraAnalytics as _PCA
        from app.models.project_camera import ProjectCamera as _PC
        from app.models.project import Project as _Proj, ProjectStatus as _PS
        from app.services import branch_manager as _bm2

        def _reconcile_loop():
            while True:
                _db = _SL2()
                try:
                    rows = (
                        _db.query(_PCA, _PC.camera_id)
                        .join(_PC, _PC.id == _PCA.project_camera_id)
                        .join(_Proj, _Proj.id == _PC.project_id)
                        .filter(_Proj.status == _PS.ACTIVE)
                        .all()
                    )

                    ppe_enabled_ids       = set()
                    workforce_enabled_ids = set()
                    activity_enabled_ids  = set()
                    for _pca, cam_id in rows:
                        if _pca.ppe_enabled:
                            ppe_enabled_ids.add(cam_id)
                        if _pca.workforce_enabled:
                            workforce_enabled_ids.add(cam_id)
                        if getattr(_pca, "activity_enabled", False):
                            activity_enabled_ids.add(cam_id)

                    # PPE reconcile
                    for cam_id in list(ppe_enabled_ids):
                        if not _bm2.is_feature_running(cam_id, "ppe"):
                            _bm2.enable_feature(cam_id, "ppe", db=_db)
                    for cam_id in _bm2.get_cameras_with_running_feature("ppe"):
                        if cam_id not in ppe_enabled_ids:
                            _bm2.disable_feature(cam_id, "ppe")

                    # Workforce reconcile
                    for cam_id in list(workforce_enabled_ids):
                        if not _bm2.is_feature_running(cam_id, "workforce"):
                            _bm2.enable_feature(cam_id, "workforce", db=_db)
                    for cam_id in _bm2.get_cameras_with_running_feature("workforce"):
                        if cam_id not in workforce_enabled_ids:
                            _bm2.disable_feature(cam_id, "workforce")

                    # Activity reconcile
                    for cam_id in list(activity_enabled_ids):
                        if not _bm2.is_feature_running(cam_id, "activity"):
                            _bm2.enable_feature(cam_id, "activity", db=_db)
                    for cam_id in _bm2.get_cameras_with_running_feature("activity"):
                        if cam_id not in activity_enabled_ids:
                            _bm2.disable_feature(cam_id, "activity")

                except Exception as e:
                    # Deadlock or lock-timeout during startup migrations — skip cycle, retry next tick
                    from psycopg2.errors import DeadlockDetected, LockNotAvailable
                    import psycopg2
                    if isinstance(e.__cause__, (DeadlockDetected, LockNotAvailable)) or \
                       "deadlock" in str(e).lower() or "lock" in str(e).lower():
                        logger.debug(f"[app_stream] Reconcile loop transient lock conflict, retrying: {type(e).__name__}")
                        try:
                            _db.rollback()
                        except Exception:
                            pass
                    else:
                        logger.warning(f"[app_stream] Reconcile loop error: {e}")
                finally:
                    _db.close()

                _time.sleep(2.0)

        _t = _threading.Thread(target=_reconcile_loop, daemon=True)
        _t.start()
        logger.info("[app_stream] Feature toggle reconcile loop started")
    except Exception as e:
        logger.warning(f"[app_stream] Feature toggle reconcile setup failed (non-fatal): {e}")

# Only streaming routes
app.include_router(user_notifications_router)
app.include_router(ml_stream_router)
app.include_router(project_ppe_router)
app.include_router(project_workforce_router)
from app.api.routes.project_activity import router as project_activity_router
app.include_router(project_activity_router)
app.include_router(project_tasks_router)
app.include_router(admin_cameras_router)
app.include_router(projects_router)
app.include_router(project_reports_router)
app.include_router(project_risk_router)
app.include_router(admin_risk_router)
app.include_router(dev_video_test_router)

@app.get("/health")
def health():
    return {"status": "ok"}


# ── Internal trigger: API server (8000) calls this immediately after a feature
# toggle DB commit so the stream server doesn't have to wait for the 2s reconcile
# loop tick. The reconcile loop remains as a safety net.
from fastapi import Body as _Body

@app.post("/internal/sync-features", include_in_schema=False)
def internal_sync_features():
    """
    Immediately reconcile all feature branches against DB state.
    Called by the API server after a feature toggle so streams start without delay.
    """
    try:
        from app.core.db import SessionLocal as _SL
        from app.models.project_camera_analytics import ProjectCameraAnalytics as _PCA
        from app.models.project_camera import ProjectCamera as _PC
        from app.models.project import Project as _Proj, ProjectStatus as _PS
        from app.services import branch_manager as _bm

        _db = _SL()
        try:
            rows = (
                _db.query(_PCA, _PC.camera_id)
                .join(_PC, _PC.id == _PCA.project_camera_id)
                .join(_Proj, _Proj.id == _PC.project_id)
                .filter(_Proj.status == _PS.ACTIVE)
                .all()
            )

            for _pca, cam_id in rows:
                for feature in ("ppe", "workforce", "activity"):
                    enabled = getattr(_pca, f"{feature}_enabled", False)
                    running = _bm.is_feature_running(cam_id, feature)
                    if enabled and not running:
                        _bm.enable_feature(cam_id, feature, db=_db)
                    elif not enabled and running:
                        _bm.disable_feature(cam_id, feature)
        finally:
            _db.close()
    except Exception as e:
        logger.warning(f"[internal_sync_features] error: {e}")
    return {"ok": True}
