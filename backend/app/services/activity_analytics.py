"""
Activity Analytics Engine — WorkerMotionTrack state machine + ActivityProcessor.

Architecture:
  - ActivityProcessor reads from _activity_detection_inbox (posted by PPE inferencer
    after ByteTrack, or by standalone activity detector when PPE/Workforce is off).
  - Zero extra YOLO/ByteTrack when PPE or Workforce is co-running on the same camera.
  - Draws premium overlays (motion trails, intensity bar, idle timer, timeline strip,
    motion field arrow, smart alert banner) onto a copy of the raw frame.
  - Zone state machine uses consecutive-cycle hysteresis + no-workers grace window
    to prevent flicker and false IDLE transitions from brief detection dropout.
  - Computes per-camera metrics every 30 inbox reads.
  - Checks alert thresholds, enqueues snapshots/alerts via activity_event_queue.
  - Pushes SSE stats to activity_dashboard_broker.
"""

from __future__ import annotations

import json
import logging
import math
import threading
import time
from collections import deque
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np

logger = logging.getLogger(__name__)

# ── Worker motion states ──────────────────────────────────────────────────────
MS_ENTERING   = "ENTERING"
MS_MOVING     = "MOVING"
MS_STATIONARY = "STATIONARY"
MS_IDLE       = "IDLE"

# ── Zone states ───────────────────────────────────────────────────────────────
ZS_ACTIVE        = "ACTIVE"
ZS_LOW_ACTIVITY  = "LOW_ACTIVITY"
ZS_IDLE          = "IDLE"
ZS_ALERTED       = "ALERTED"

# ── Module-level processor registry ──────────────────────────────────────────
_processors: Dict[int, "ActivityProcessor"] = {}
_processors_lock = threading.Lock()


def get_processor(camera_id: int) -> Optional["ActivityProcessor"]:
    with _processors_lock:
        return _processors.get(camera_id)


def register_processor(camera_id: int, processor: "ActivityProcessor") -> None:
    with _processors_lock:
        _processors[camera_id] = processor


def unregister_processor(camera_id: int) -> None:
    with _processors_lock:
        _processors.pop(camera_id, None)


def get_all_processors() -> Dict[int, "ActivityProcessor"]:
    with _processors_lock:
        return dict(_processors)


# ─────────────────────────────────────────────────────────────────────────────
# WorkerMotionTrack — per-worker motion state machine
# ─────────────────────────────────────────────────────────────────────────────

class WorkerMotionTrack:
    """Tracks a single worker (one ByteTrack ID) with activity motion state machine."""

    __slots__ = (
        "track_id", "logical_id", "first_seen_at", "last_seen_at",
        "frames_seen", "frames_lost", "last_positions",
        "motion_state", "stationary_since", "idle_since",
        "idle_duration_accumulated",   # preserved across reconciliation
        "height_px",
        "x1", "y1", "x2", "y2",
    )

    def __init__(self, track_id: int, logical_id: int):
        self.track_id                  = track_id
        self.logical_id                = logical_id
        self.first_seen_at             = time.time()
        self.last_seen_at              = time.time()
        self.frames_seen               = 0
        self.frames_lost               = 0
        self.last_positions: deque     = deque(maxlen=15)
        self.motion_state              = MS_ENTERING
        self.stationary_since: Optional[float] = None
        self.idle_since:       Optional[float] = None
        self.idle_duration_accumulated = 0.0   # total seconds idle (accumulated)
        self.height_px                 = 0
        self.x1 = self.y1 = self.x2 = self.y2 = 0

    def update(self, x1: int, y1: int, x2: int, y2: int, cfg: dict) -> None:
        """Update position and advance state machine."""
        now = time.time()
        cx  = (x1 + x2) / 2.0
        cy  = (y1 + y2) / 2.0

        self.x1 = x1; self.y1 = y1; self.x2 = x2; self.y2 = y2
        self.height_px    = y2 - y1
        self.last_positions.append((cx, cy))
        self.last_seen_at  = now
        self.frames_seen  += 1
        self.frames_lost   = 0

        move_thresh_px      = cfg.get("activity_movement_thresh_px", 6.0)
        idle_threshold_secs = cfg.get("activity_idle_threshold_seconds", 300)
        confirm_frames      = cfg.get("activity_confirm_frames", 6)
        # Hysteresis: need 1.8× the move threshold to EXIT idle
        reactivation_thresh = move_thresh_px * 1.8

        # Compute displacement (avg frame-to-frame distance over last 10 positions)
        displacement = 0.0
        if len(self.last_positions) >= 2:
            positions = list(self.last_positions)[-10:]
            dists = [
                math.sqrt((positions[i][0] - positions[i-1][0])**2 +
                          (positions[i][1] - positions[i-1][1])**2)
                for i in range(1, len(positions))
            ]
            displacement = sum(dists) / len(dists) if dists else 0.0

        # Accumulate idle time if currently idle
        if self.idle_since is not None:
            self.idle_duration_accumulated += now - self.idle_since
            self.idle_since = now   # reset anchor so next call doesn't double-count

        if self.frames_seen < confirm_frames:
            self.motion_state = MS_ENTERING
            return

        if self.motion_state == MS_ENTERING:
            if displacement > move_thresh_px:
                self.motion_state = MS_MOVING
                self.stationary_since = None
                self.idle_since = None
            else:
                self.motion_state = MS_STATIONARY
                self.stationary_since = now
            return

        if self.motion_state == MS_IDLE:
            # Hysteresis: need more movement to exit IDLE (prevents bbox jitter flicker)
            if displacement > reactivation_thresh:
                self.motion_state = MS_MOVING
                self.stationary_since = None
                self.idle_since = None
            return

        if displacement > move_thresh_px:
            self.motion_state = MS_MOVING
            self.stationary_since = None
        else:
            if self.motion_state == MS_MOVING:
                self.stationary_since = now
                self.motion_state = MS_STATIONARY
            # In STATIONARY: check if we've been stationary long enough → IDLE
            if self.motion_state == MS_STATIONARY and self.stationary_since is not None:
                if (now - self.stationary_since) >= idle_threshold_secs:
                    self.motion_state = MS_IDLE
                    self.idle_since = now

    def mark_lost(self) -> None:
        self.frames_lost += 1

    @property
    def current_idle_seconds(self) -> float:
        """Current continuous idle duration in seconds."""
        if self.idle_since is None and self.motion_state != MS_IDLE:
            return 0.0
        if self.idle_since is not None:
            return time.time() - self.idle_since
        return 0.0


# ─────────────────────────────────────────────────────────────────────────────
# ActivityProcessor — consumer thread + overlays + metrics + alerts
# ─────────────────────────────────────────────────────────────────────────────

class ActivityProcessor:
    """
    Per-camera activity analytics processor.
    Reads from _activity_detection_inbox, applies WorkerMotionTrack state machines,
    computes zone-level activity state, draws overlays, pushes SSE stats, checks alerts.
    """

    def __init__(self, camera_id: int, project_id: int, zone_id: Optional[int],
                 zone_name: Optional[str]):
        self.camera_id  = camera_id
        self.project_id = project_id
        self.zone_id    = zone_id
        self.zone_name  = zone_name or f"Camera {camera_id}"

        self._stop    = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._cfg: dict = {}

        # Track registry
        self._tracks: Dict[int, WorkerMotionTrack] = {}
        self._next_logical_id = 1
        self._recently_exited: Dict[int, dict] = {}

        # Zone state machine
        self._zone_state         = ZS_ACTIVE
        self._zone_state_since   = time.time()
        self._zone_pending_state = ZS_ACTIVE
        self._zone_pending_cycles = 0         # hysteresis counter

        # "No workers" grace window before IDLE
        self._no_workers_since: Optional[float] = None

        # Idle tracking
        self._idle_started_at:   Optional[float] = None
        self._longest_idle_secs  = 0.0
        self._idle_event_count_today = 0

        # Rolling minute accumulators (today)
        self._active_minutes_today       = 0
        self._idle_minutes_today         = 0
        self._low_activity_minutes_today = 0
        self._last_minute_bucket: Optional[int] = None   # minute-of-day

        # Timeline: (timestamp, zone_state) per zone state change (appended in _advance_zone_state)
        # maxlen=200 stores up to 200 distinct zone transitions (unbounded in time coverage)
        self._timeline: deque = deque(maxlen=200)

        # Metrics (updated every 30 frames)
        self._metrics: dict = {}
        self._metrics_lock = threading.Lock()
        self._metrics_frame_count = 0
        self._motion_intensity_history: deque = deque(maxlen=5)

        # Alert tracking
        self._last_alert_times: Dict[str, float] = {}
        self._prev_intensity_history: deque = deque(maxlen=5)  # for activity_drop comparison
        self._low_activity_since: Optional[float] = None

        # Sparkline (last 20 activity scores)
        self._sparkline: deque = deque(maxlen=20)

        # Optical flow state
        self._optical_flow_prev_gray: Optional[np.ndarray] = None
        self._flow_frame_counter = 0
        self._last_flow_score = 0.0

        # Snapshot interval tracking
        self._last_snapshot_time = 0.0

        # Frame dimensions (set on first frame)
        self._frame_H = 0
        self._frame_W = 0

    # ── Public API ────────────────────────────────────────────────────────────

    def start(self, cfg: dict) -> None:
        self._cfg = cfg
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._consumer_loop,
            daemon=True,
            name=f"act-consumer-{self.camera_id}",
        )
        self._thread.start()
        logger.info(f"[ActivityProcessor] Camera {self.camera_id} started")

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2.0)
        logger.info(f"[ActivityProcessor] Camera {self.camera_id} stopped")

    def is_running(self) -> bool:
        return not self._stop.is_set()

    def update_config(self, cfg: dict) -> None:
        """Hot-reload config while the processor is running."""
        self._cfg = cfg

    def get_latest_metrics(self) -> dict:
        with self._metrics_lock:
            return dict(self._metrics)

    # ── Consumer loop ─────────────────────────────────────────────────────────

    def _consumer_loop(self) -> None:
        from ..api.routes.ml_stream_enterprise import (
            _activity_detection_inbox,
            _activity_inbox_locks,
            _activity_annotated,
        )
        last_seq = -1

        while not self._stop.is_set():
            lock_key = self.camera_id
            if lock_key not in _activity_inbox_locks:
                time.sleep(0.02)
                continue

            inbox_lock = _activity_inbox_locks[lock_key]
            with inbox_lock:
                inbox = _activity_detection_inbox.get(self.camera_id)

            if inbox is None or inbox["seq"] == last_seq:
                time.sleep(0.01)
                continue

            last_seq   = inbox["seq"]
            detections = inbox["detections"]
            frame      = inbox.get("frame")
            if frame is None:
                continue

            frame = frame.copy()
            H, W = frame.shape[:2]
            self._frame_H = H
            self._frame_W = W

            cfg = self._cfg
            self._metrics_frame_count += 1

            # ── Update / create WorkerMotionTrack instances ───────────────────
            seen_ids = set()
            for det in detections:
                tid = det["track_id"]
                seen_ids.add(tid)
                if tid not in self._tracks:
                    h_px = det["y2"] - det["y1"]
                    logical_id = self._reconcile_or_new(det["cx"], det["cy"], h_px, cfg)
                    self._tracks[tid] = WorkerMotionTrack(tid, logical_id)
                self._tracks[tid].update(det["x1"], det["y1"], det["x2"], det["y2"], cfg)

            # ── Mark lost tracks ──────────────────────────────────────────────
            lost_thresh = cfg.get("activity_lost_frames", 20)
            to_remove = []
            for tid, track in list(self._tracks.items()):
                if tid not in seen_ids:
                    track.mark_lost()
                    if track.frames_lost >= lost_thresh:
                        lx, ly = (track.last_positions[-1]
                                  if track.last_positions else (0.0, 0.0))
                        self._recently_exited[tid] = {
                            "last_cx":                  lx,
                            "last_cy":                  ly,
                            "exited_at":                time.time(),
                            "logical_id":               track.logical_id,
                            "height_px":                track.height_px,
                            "motion_state":             track.motion_state,
                            "idle_since":               track.idle_since,
                            "idle_duration_accumulated":track.idle_duration_accumulated,
                        }
                        to_remove.append(tid)

            for tid in to_remove:
                del self._tracks[tid]

            # Expire old reconciliation entries
            rec_window = cfg.get("activity_reconcile_window_secs", 5)
            now = time.time()
            expired = [k for k, v in self._recently_exited.items()
                       if now - v["exited_at"] > rec_window]
            for k in expired:
                del self._recently_exited[k]

            # ── Draw overlays ─────────────────────────────────────────────────
            annotated = self._draw_overlays(frame, cfg)

            # ── Compute metrics every 10 frames ───────────────────────────────
            if self._metrics_frame_count % 10 == 0:
                metrics = self._compute_metrics(cfg, frame)
                with self._metrics_lock:
                    self._metrics = metrics
                self._sparkline.append(metrics["activity_score"])
                self._push_sse(metrics)
                self._check_and_fire_alerts(metrics, cfg, annotated)
                self._maybe_enqueue_snapshot(metrics, cfg)

            if self.camera_id not in _activity_annotated:
                _activity_annotated[self.camera_id] = {
                    "frame": None, "seq": 0, "lock": threading.Lock()
                }
            ann = _activity_annotated[self.camera_id]
            with ann["lock"]:
                ann["frame"] = annotated
                ann["seq"]   = last_seq

    # ── Reconciliation ────────────────────────────────────────────────────────

    def _reconcile_or_new(self, cx: float, cy: float, height_px: float, cfg: dict) -> int:
        """
        Return existing logical_id if a recent exit matches (position + height scoring),
        else allocate new. On match: new track inherits motion_state, idle_since,
        idle_duration_accumulated from the exited track (preserves idle timer).
        """
        dist_thresh = cfg.get("activity_reconcile_distance_px", 100)
        window      = cfg.get("activity_reconcile_window_secs", 5)
        now         = time.time()
        best_key    = None
        best_score  = float("inf")

        for k, rec in self._recently_exited.items():
            if now - rec["exited_at"] > window:
                continue
            pos_dist = math.sqrt((cx - rec["last_cx"])**2 + (cy - rec["last_cy"])**2)
            if pos_dist >= dist_thresh:
                continue
            exited_h      = rec.get("height_px", height_px)
            height_penalty = abs(height_px - exited_h) * 0.5
            score = pos_dist + height_penalty
            if score < best_score:
                best_score = score
                best_key   = k

        if best_key is not None:
            rec        = self._recently_exited.pop(best_key)
            logical_id = rec["logical_id"]
            # Preserve idle state on the new track instance — will be applied after creation
            self._pending_reconcile = {
                "motion_state":              rec.get("motion_state", MS_ENTERING),
                "idle_since":                rec.get("idle_since"),
                "idle_duration_accumulated": rec.get("idle_duration_accumulated", 0.0),
            }
            logger.debug(
                f"[Activity reconcile] Camera {self.camera_id} → logical {logical_id} "
                f"(score={best_score:.1f}, state={rec.get('motion_state')})"
            )
            return logical_id

        self._pending_reconcile = None
        lid = self._next_logical_id
        self._next_logical_id += 1
        return lid

    def _apply_pending_reconcile(self, track: WorkerMotionTrack) -> None:
        """Apply reconcile state to a newly created track (called right after creation)."""
        rec = getattr(self, "_pending_reconcile", None)
        if rec:
            track.motion_state              = rec["motion_state"]
            track.idle_since                = rec["idle_since"]
            track.idle_duration_accumulated = rec["idle_duration_accumulated"]
            self._pending_reconcile = None

    # ── Metrics computation ───────────────────────────────────────────────────

    def _compute_metrics(self, cfg: dict, frame) -> dict:
        min_stable = cfg.get("activity_lost_frames", 20)
        confirmed  = [t for t in self._tracks.values()
                      if t.motion_state in (MS_MOVING, MS_STATIONARY, MS_IDLE)
                      and t.frames_seen >= min_stable
                      and t.frames_lost <= 5]

        moving_count     = len([t for t in confirmed if t.motion_state == MS_MOVING])
        stationary_count = len([t for t in confirmed if t.motion_state == MS_STATIONARY])
        idle_count       = len([t for t in confirmed if t.motion_state == MS_IDLE])
        entering_count   = len([t for t in self._tracks.values() if t.motion_state == MS_ENTERING])
        total            = len(confirmed)

        # Average displacement across MOVING tracks
        avg_displacement = 0.0
        if moving_count > 0:
            disps = []
            for t in confirmed:
                if t.motion_state == MS_MOVING and len(t.last_positions) >= 2:
                    pos = list(t.last_positions)
                    d = math.sqrt((pos[-1][0] - pos[-2][0])**2 + (pos[-1][1] - pos[-2][1])**2)
                    disps.append(d)
            avg_displacement = sum(disps) / len(disps) if disps else 0.0

        # Optical flow (throttled)
        flow_score = self._compute_optical_flow(frame, cfg, total)

        # Motion intensity score (0-100) with median smoothing
        opt_weight = cfg.get("activity_optical_flow_weight", 0.2)
        base        = (moving_count / max(total, 1)) * 60.0
        disp_bonus  = min(40.0, avg_displacement * 0.5)
        flow_bonus  = flow_score * opt_weight * 20.0
        raw_intensity = base + disp_bonus + flow_bonus
        self._motion_intensity_history.append(raw_intensity)
        sorted_hist = sorted(self._motion_intensity_history)
        motion_intensity_score = sorted_hist[len(sorted_hist) // 2]
        motion_intensity_score = min(100.0, max(0.0, motion_intensity_score))

        # Activity score (0-100)
        moving_ratio   = moving_count / max(total, 1)
        activity_score = int(min(100, max(0, round(
            motion_intensity_score * 0.5 + moving_ratio * 50.0
        ))))

        # Zone state machine with hysteresis
        zone_state = self._advance_zone_state(
            total, moving_count, motion_intensity_score, cfg
        )

        # Update minute accumulators
        self._update_minute_buckets(zone_state)

        # Idle duration
        idle_duration_seconds = None
        if zone_state in (ZS_IDLE, ZS_ALERTED) and self._idle_started_at:
            idle_duration_seconds = time.time() - self._idle_started_at
            if idle_duration_seconds > self._longest_idle_secs:
                self._longest_idle_secs = idle_duration_seconds

        # Current idle for individual workers
        max_worker_idle = 0.0
        for t in confirmed:
            if t.motion_state == MS_IDLE:
                max_worker_idle = max(max_worker_idle, t.current_idle_seconds)

        return {
            "camera_id":                   self.camera_id,
            "project_id":                  self.project_id,
            "zone_id":                     self.zone_id,
            "zone_name":                   self.zone_name,
            "zone_state":                  zone_state,
            "moving_count":                moving_count,
            "stationary_count":            stationary_count,
            "idle_count":                  idle_count,
            "entering_count":              entering_count,
            "total_count":                 total,
            "motion_intensity_score":      round(motion_intensity_score, 1),
            "activity_score":              activity_score,
            "avg_displacement":            round(avg_displacement, 2),
            "optical_flow_score":          round(flow_score, 2),
            "active_minutes_today":        self._active_minutes_today,
            "idle_minutes_today":          self._idle_minutes_today,
            "low_activity_minutes_today":  self._low_activity_minutes_today,
            "idle_duration_seconds":       round(idle_duration_seconds, 1) if idle_duration_seconds else 0.0,
            "longest_idle_seconds":        round(self._longest_idle_secs, 1),
            "max_worker_idle_seconds":     round(max_worker_idle, 1),
            "sparkline":                   list(self._sparkline),
            "timestamp":                   time.time(),
        }

    def _advance_zone_state(self, total: int, moving_count: int,
                            motion_intensity: float, cfg: dict) -> str:
        """
        Zone state machine with hysteresis on IDLE entry and immediate exit.

        Enterprise rule: motion detected → zone exits IDLE immediately (no hysteresis).
        Hysteresis (3-cycle) is applied only on entry to IDLE/LOW_ACTIVITY to prevent
        flicker from brief detection dropouts.

        Returns committed zone state.
        """
        now = time.time()
        low_thresh   = cfg.get("activity_low_activity_threshold", 30)   # % moving for ACTIVE
        idle_grace   = cfg.get("activity_idle_grace_window_secs", 15)
        zone_cycles  = cfg.get("activity_zone_transition_cycles", 3)
        alert_mins   = cfg.get("activity_alert_idle_minutes", 15)

        moving_pct = (moving_count / max(total, 1)) * 100 if total > 0 else 0

        # Determine candidate state
        if total == 0:
            # Track when workers first disappeared
            if self._no_workers_since is None:
                self._no_workers_since = now
            if (now - self._no_workers_since) >= idle_grace:
                candidate = ZS_IDLE
            else:
                candidate = self._zone_state  # hold current during grace
        else:
            self._no_workers_since = None   # reset grace timer
            if moving_pct >= low_thresh and motion_intensity >= 40:
                candidate = ZS_ACTIVE
            elif motion_intensity >= 10:
                candidate = ZS_LOW_ACTIVITY
            else:
                candidate = ZS_IDLE

        # ALERTED is computed after committing IDLE — immediate (no hysteresis)
        if self._zone_state in (ZS_IDLE, ZS_ALERTED) and self._idle_started_at:
            idle_mins = (now - self._idle_started_at) / 60.0
            if idle_mins >= alert_mins:
                candidate_alerted = ZS_ALERTED
            else:
                candidate_alerted = None
        else:
            candidate_alerted = None

        # ── Instant IDLE exit: if any worker is moving, commit ACTIVE immediately ──
        # Enterprise rule: movement detected → zone is active, no delay.
        # Hysteresis is only applied on the path *into* IDLE, not out of it.
        currently_idle = self._zone_state in (ZS_IDLE, ZS_ALERTED)
        if currently_idle and moving_count > 0:
            new_state = ZS_ACTIVE
            # Reset pending state so hysteresis doesn't carry over
            self._zone_pending_state  = ZS_ACTIVE
            self._zone_pending_cycles = zone_cycles  # pre-fill so next cycle stays ACTIVE
        else:
            # Hysteresis: require zone_cycles consecutive agreements before committing
            if candidate == self._zone_pending_state:
                self._zone_pending_cycles += 1
            else:
                self._zone_pending_state  = candidate
                self._zone_pending_cycles = 1

            if self._zone_pending_cycles >= zone_cycles:
                new_state = self._zone_pending_state
            else:
                new_state = self._zone_state  # not yet committed

            # Override with ALERTED (no hysteresis)
            if candidate_alerted and new_state in (ZS_IDLE, ZS_ALERTED):
                new_state = ZS_ALERTED

        # Track idle start/end
        if new_state in (ZS_IDLE, ZS_ALERTED) and self._zone_state not in (ZS_IDLE, ZS_ALERTED):
            self._idle_started_at = now
        elif new_state not in (ZS_IDLE, ZS_ALERTED) and self._zone_state in (ZS_IDLE, ZS_ALERTED):
            if self._idle_started_at:
                duration = now - self._idle_started_at
                if duration > self._longest_idle_secs:
                    self._longest_idle_secs = duration
            self._idle_started_at = None
            self._idle_event_count_today += 1

        if new_state != self._zone_state:
            self._zone_state_since = now
            self._zone_state = new_state
            # Record state change in timeline (bounded deque — each entry = one compute cycle)
            self._timeline.append((now, self._zone_state))

        return self._zone_state

    def _update_minute_buckets(self, zone_state: str) -> None:
        """Increment active/idle/low minute counters once per calendar minute."""
        import datetime
        now_minute = datetime.datetime.now().minute + datetime.datetime.now().hour * 60
        if now_minute == self._last_minute_bucket:
            return
        self._last_minute_bucket = now_minute

        if zone_state == ZS_ACTIVE:
            self._active_minutes_today += 1
        elif zone_state in (ZS_IDLE, ZS_ALERTED):
            self._idle_minutes_today += 1
        else:
            self._low_activity_minutes_today += 1

    def _compute_optical_flow(self, frame, cfg: dict, total_count: int) -> float:
        """
        Compute optional optical flow magnitude.
        Throttled to every N frames, skipped when total_count >= 8.
        Returns raw flow score (blended in caller).
        """
        flow_weight = cfg.get("activity_optical_flow_weight", 0.2)
        flow_every_n = cfg.get("activity_flow_every_n_frames", 10)

        self._flow_frame_counter += 1
        # Skip: weight is 0, or too many workers (unreliable), or throttle counter not reached
        if flow_weight == 0 or total_count >= 8 or self._flow_frame_counter % flow_every_n != 0:
            return self._last_flow_score

        try:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            if self._optical_flow_prev_gray is not None and \
               gray.shape == self._optical_flow_prev_gray.shape:
                flow = cv2.calcOpticalFlowFarneback(
                    self._optical_flow_prev_gray, gray, None,
                    0.5, 3, 15, 3, 5, 1.2, 0
                )
                mag, _ = cv2.cartToPolar(flow[..., 0], flow[..., 1])
                self._last_flow_score = float(np.mean(mag))
            self._optical_flow_prev_gray = gray
        except Exception:
            pass

        return self._last_flow_score

    # ── SSE push ──────────────────────────────────────────────────────────────

    def _push_sse(self, metrics: dict) -> None:
        try:
            from . import activity_dashboard_broker as broker
            from datetime import datetime, timezone
            payload = {
                "type":                      "activity_stats_update",
                "camera_id":                 metrics["camera_id"],
                "zone_name":                 metrics["zone_name"],
                "zone_state":                metrics["zone_state"],
                "moving_count":              metrics["moving_count"],
                "stationary_count":          metrics["stationary_count"],
                "idle_count":                metrics["idle_count"],
                "entering_count":            metrics["entering_count"],
                "total_count":               metrics["total_count"],
                "motion_intensity_score":    metrics["motion_intensity_score"],
                "activity_score":            metrics["activity_score"],
                "optical_flow_score":        metrics["optical_flow_score"],
                "active_minutes_today":      metrics["active_minutes_today"],
                "idle_minutes_today":        metrics["idle_minutes_today"],
                "low_activity_minutes_today":metrics["low_activity_minutes_today"],
                "idle_duration_seconds":     metrics["idle_duration_seconds"],
                "longest_idle_seconds":      metrics["longest_idle_seconds"],
                "max_worker_idle_seconds":   metrics["max_worker_idle_seconds"],
                "sparkline":                 metrics["sparkline"],
                "timestamp":                 datetime.now(timezone.utc).isoformat(),
            }
            broker.push(self.project_id, payload)
        except Exception as e:
            logger.debug(f"[ActivityProcessor] SSE push error: {e}")

    # ── Alerts ────────────────────────────────────────────────────────────────

    def _check_and_fire_alerts(self, metrics: dict, cfg: dict, frame=None) -> None:
        now          = time.time()
        _SENSITIVITY_COOLDOWN = {"low": 1200, "medium": 600, "high": 300, "ultra_high": 0}
        sensitivity  = cfg.get("alert_sensitivity", "medium")
        cooldown     = _SENSITIVITY_COOLDOWN.get(sensitivity, 600)
        zone_state   = metrics["zone_state"]
        intensity    = metrics["motion_intensity_score"]
        total        = metrics["total_count"]
        alert_mins   = cfg.get("activity_alert_idle_minutes", 15)

        # ── zone_idle: zone has been ALERTED (idle > alert_idle_minutes) ──────
        if zone_state == ZS_ALERTED:
            self._fire_alert(
                "zone_idle", metrics,
                f"Zone '{metrics['zone_name']}' has been idle for "
                f"{int(metrics['idle_duration_seconds'] / 60)} minutes",
                "medium", cooldown, now, frame,
            )

        # ── activity_drop: median intensity dropped >50% vs prior window ──────
        # Requires at least 2 confirmed workers (prevents false alarms from empty detection)
        if total >= 2 and len(self._prev_intensity_history) >= 5:
            prev_med = sorted(self._prev_intensity_history)[len(self._prev_intensity_history) // 2]
            curr_med = intensity
            if prev_med > 0 and (prev_med - curr_med) / prev_med > 0.5:
                self._fire_alert(
                    "activity_drop", metrics,
                    f"Zone '{metrics['zone_name']}' activity dropped from "
                    f"{int(prev_med)}% to {int(curr_med)}% intensity",
                    "high", cooldown, now, frame,
                )
        # Rotate intensity buffers every 5 metrics cycles
        if self._metrics_frame_count % 150 == 0:
            self._prev_intensity_history = deque(self._motion_intensity_history, maxlen=5)

        # ── low_activity_sustained: LOW_ACTIVITY for >30 min ─────────────────
        if zone_state == ZS_LOW_ACTIVITY:
            if self._low_activity_since is None:
                self._low_activity_since = now
            elif (now - self._low_activity_since) >= cfg.get("activity_low_activity_sustained_seconds", 1800):
                low_act_mins = cfg.get("activity_low_activity_sustained_seconds", 1800) // 60
                self._fire_alert(
                    "low_activity_sustained", metrics,
                    f"Zone '{metrics['zone_name']}' has shown low activity for over {low_act_mins} minutes",
                    "medium", cooldown, now, frame,
                )
                self._low_activity_since = now  # reset
        else:
            self._low_activity_since = None

        # ── repeated_inactivity: 3+ idle events today ─────────────────────────
        if self._idle_event_count_today >= 3:
            self._fire_alert(
                "repeated_inactivity", metrics,
                f"Zone '{metrics['zone_name']}' has gone idle "
                f"{self._idle_event_count_today} times today",
                "low", cooldown * 2, now, frame,
            )
            self._idle_event_count_today = 0  # reset after firing

    def _fire_alert(self, alert_type: str, metrics: dict, message: str,
                    severity: str, cooldown: float, now: float, frame=None) -> None:
        last = self._last_alert_times.get(alert_type, 0.0)
        if (now - last) < cooldown:
            return
        self._last_alert_times[alert_type] = now

        from .activity_event_queue import try_enqueue
        from . import activity_dashboard_broker as broker
        from datetime import datetime, timezone

        try_enqueue({
            "kind":           "alert",
            "project_id":     self.project_id,
            "camera_id":      self.camera_id,
            "zone_id":        self.zone_id,
            "zone_name":      self.zone_name,
            "alert_type":     alert_type,
            "severity":       severity,
            "message":        message,
            "snapshot_frame": frame,
            "triggered_at":   datetime.now(timezone.utc),
        })

        broker.push(self.project_id, {
            "type":       "activity_alert",
            "camera_id":  self.camera_id,
            "alert_type": alert_type,
            "zone_name":  self.zone_name,
            "message":    message,
            "severity":   severity,
            "timestamp":  datetime.now(timezone.utc).isoformat(),
        })

        logger.info(
            f"[ActivityProcessor] Alert fired: camera={self.camera_id} "
            f"type={alert_type} severity={severity}"
        )

    def _maybe_enqueue_snapshot(self, metrics: dict, cfg: dict) -> None:
        now      = time.time()
        interval = cfg.get("activity_snapshot_interval_secs", 60)
        if (now - self._last_snapshot_time) < interval:
            return
        self._last_snapshot_time = now

        from .activity_event_queue import try_enqueue
        from datetime import datetime, timezone
        import json

        try_enqueue({
            "kind":                        "snapshot",
            "project_id":                  self.project_id,
            "camera_id":                   self.camera_id,
            "zone_id":                     self.zone_id,
            "zone_name":                   self.zone_name,
            "trigger":                     "interval",
            "recorded_at":                 datetime.now(timezone.utc),
            "zone_state":                  metrics["zone_state"],
            "moving_count":                metrics["moving_count"],
            "stationary_count":            metrics["stationary_count"],
            "idle_count":                  metrics["idle_count"],
            "total_count":                 metrics["total_count"],
            "motion_intensity_score":      metrics["motion_intensity_score"],
            "activity_score":              metrics["activity_score"],
            "active_minutes_today":        metrics["active_minutes_today"],
            "idle_minutes_today":          metrics["idle_minutes_today"],
            "low_activity_minutes_today":  metrics["low_activity_minutes_today"],
            "idle_duration_seconds":       metrics["idle_duration_seconds"],
            "longest_idle_seconds":        metrics["longest_idle_seconds"],
            "sparkline_json":              json.dumps(metrics["sparkline"]),
            "optical_flow_score":          metrics["optical_flow_score"],
        })

    # ── Overlay helpers (mirrored from WorkforceAnalytics for visual consistency) ─

    @staticmethod
    def _blend_rect(frame: np.ndarray, x1: int, y1: int, x2: int, y2: int,
                    color_bgr: tuple, alpha: float) -> None:
        """Alpha-blend a filled rectangle onto frame in-place."""
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(frame.shape[1] - 1, x2), min(frame.shape[0] - 1, y2)
        if x2 <= x1 or y2 <= y1:
            return
        roi     = frame[y1:y2, x1:x2]
        colored = np.full_like(roi, color_bgr, dtype=np.uint8)
        cv2.addWeighted(colored, alpha, roi, 1 - alpha, 0, roi)

    @staticmethod
    def _draw_rounded_rect(frame: np.ndarray, x1: int, y1: int, x2: int, y2: int,
                           color: tuple, thickness: int, radius: int = 8) -> None:
        """Draw a rounded-corner rectangle border."""
        r = min(radius, (x2 - x1) // 2, (y2 - y1) // 2)
        cv2.line(frame, (x1 + r, y1), (x2 - r, y1), color, thickness)
        cv2.line(frame, (x1 + r, y2), (x2 - r, y2), color, thickness)
        cv2.line(frame, (x1, y1 + r), (x1, y2 - r), color, thickness)
        cv2.line(frame, (x2, y1 + r), (x2, y2 - r), color, thickness)
        cv2.ellipse(frame, (x1 + r, y1 + r), (r, r), 180, 0, 90, color, thickness)
        cv2.ellipse(frame, (x2 - r, y1 + r), (r, r), 270, 0, 90, color, thickness)
        cv2.ellipse(frame, (x1 + r, y2 - r), (r, r),  90, 0, 90, color, thickness)
        cv2.ellipse(frame, (x2 - r, y2 - r), (r, r),   0, 0, 90, color, thickness)

    # ── Overlays ──────────────────────────────────────────────────────────────

    def _draw_overlays(self, frame, cfg: dict) -> np.ndarray:
        """Draw all activity overlays onto a copy of the frame. Returns annotated frame."""
        out = frame.copy()
        H, W = out.shape[:2]
        cfg  = self._cfg

        # ── Scale factor — 640px reference so elements stay readable at any size ──
        # Using 640 (not 1280) as the reference means scale ≥ 1.0 for typical streams,
        # keeping fonts and panels at the same visual weight as Workforce Analytics.
        scale = max(0.75, min(2.0, W / 640.0))

        # ── Thread-safe snapshot of zone state + idle timer ───────────────────
        with self._metrics_lock:
            intensity  = self._metrics.get("motion_intensity_score", 0)
            act_score  = self._metrics.get("activity_score", 0)
        # Read zone_state and idle_started_at atomically (written by consumer thread)
        zone_state      = self._zone_state
        idle_started_at = self._idle_started_at

        # ── Unified color palette (matches workforce analytics) ───────────────
        # MOVING = green, STATIONARY = cyan, IDLE = blue, ALERTED = orange
        C_MOVING     = (50, 220, 50)
        C_STATIONARY = (50, 165, 245)
        C_IDLE       = (20, 160, 255)    # blue — matches workforce IDLE, not red
        C_ALERTED    = (0, 100, 255)     # orange-red — visually distinct from IDLE
        C_ACTIVE_BAR = (50, 200, 50)
        C_LOW_BAR    = (50, 165, 245)
        C_IDLE_BAR   = (20, 100, 220)    # muted blue for bars

        bar_color = (
            C_ACTIVE_BAR if intensity >= 60 else
            C_LOW_BAR    if intensity >= 30 else
            C_IDLE_BAR
        )

        def track_color(motion_state: str) -> tuple:
            if motion_state == MS_MOVING:     return C_MOVING
            if motion_state == MS_STATIONARY: return C_STATIONARY
            return C_IDLE

        _VISUAL_GRACE = 5
        confirmed = [t for t in self._tracks.values()
                     if t.motion_state in (MS_MOVING, MS_STATIONARY, MS_IDLE)
                     and t.frames_lost <= _VISUAL_GRACE]

        # ── Fast-path: any moving worker → suppress IDLE banner immediately ──
        any_moving = any(t.motion_state == MS_MOVING for t in confirmed)

        FONT  = cv2.FONT_HERSHEY_SIMPLEX
        FONTB = cv2.FONT_HERSHEY_DUPLEX

        # ── 1. Motion trails (fading polyline, last 8 positions) ─────────────
        for track in confirmed:
            if len(track.last_positions) < 2:
                continue
            pts  = list(track.last_positions)[-8:]
            n    = len(pts)
            base_color = track_color(track.motion_state)
            trail_thick = max(1, int(2 * scale))
            for i in range(1, n):
                alpha = i / n
                c = tuple(int(v * alpha) for v in base_color)
                p1 = (int(pts[i-1][0]), int(pts[i-1][1]))
                p2 = (int(pts[i][0]),   int(pts[i][1]))
                ov = out.copy()
                cv2.line(ov, p1, p2, c, trail_thick)
                cv2.addWeighted(ov, alpha * 0.7, out, 1 - alpha * 0.7, 0, out)

        # ── 2. Per-worker bounding boxes + two-line workforce-style tags ──────
        # Font bases are halved vs workforce because our scale ref is 640 not 1280
        bbox_thick = max(2, int(2 * scale))
        fs1 = 0.38 * scale   # W-xx (DUPLEX)
        fs2 = 0.30 * scale   # state line (SIMPLEX)
        th1 = max(1, int(scale * 0.8))
        th2 = max(1, int(scale * 0.8))
        pad_x = int(7 * scale)
        pad_y = int(5 * scale)

        for track in confirmed:
            color = track_color(track.motion_state)
            x1, y1, x2, y2 = track.x1, track.y1, track.x2, track.y2

            # Rounded-corner bbox
            self._draw_rounded_rect(out, x1, y1, x2, y2, color, bbox_thick, radius=max(4, int(6 * scale)))
            # Thin accent bar at top of bbox
            bar_h_bbox = max(3, int(4 * scale))
            self._blend_rect(out, x1 + 2, y1 + 2, x2 - 2, y1 + bar_h_bbox + 2, color, alpha=0.50)

            # Build state line text
            dwell = int(time.time() - track.first_seen_at)
            mm, ss = divmod(dwell, 60)
            if track.motion_state == MS_MOVING:
                line2 = f"MOVING  {mm:02d}m {ss:02d}s" if mm > 0 else f"MOVING  {ss}s"
            elif track.motion_state == MS_STATIONARY:
                stat_s = int(time.time() - track.stationary_since) if track.stationary_since else 0
                sm, ss2 = divmod(stat_s, 60)
                line2 = f"STATIONARY  {sm}m {ss2}s" if sm > 0 else f"STATIONARY  {ss2}s"
            else:  # MS_IDLE
                idle_s = int(track.current_idle_seconds)
                im, is_ = divmod(idle_s, 60)
                line2 = f"IDLE  {im}m {is_}s" if im > 0 else f"IDLE  {is_}s"

            line1 = f"W-{track.logical_id:02d}"

            (tw1, th1_sz), _ = cv2.getTextSize(line1, FONTB, fs1, th1)
            (tw2, th2_sz), _ = cv2.getTextSize(line2, FONT,  fs2, th2)

            tag_w = max(tw1, tw2) + pad_x * 2
            tag_h = th1_sz + th2_sz + pad_y * 2 + int(4 * scale)
            tag_x = max(0, min(x1, W - tag_w - 2))
            tag_y = max(tag_h + 2, y1 - int(6 * scale))

            # Dark backing
            self._blend_rect(out, tag_x, tag_y - tag_h, tag_x + tag_w, tag_y,
                             (8, 12, 20), alpha=0.88)
            # Left accent bar
            self._blend_rect(out, tag_x, tag_y - tag_h,
                             tag_x + max(3, int(4 * scale)), tag_y, color, alpha=0.95)
            # Rounded border
            self._draw_rounded_rect(out, tag_x, tag_y - tag_h, tag_x + tag_w, tag_y,
                                    color, 1, radius=4)

            cv2.putText(out, line1,
                        (tag_x + pad_x, tag_y - pad_y - th2_sz - int(4 * scale)),
                        FONTB, fs1, (240, 245, 255), th1, cv2.LINE_AA)
            cv2.putText(out, line2,
                        (tag_x + pad_x, tag_y - pad_y),
                        FONT, fs2, color, th2, cv2.LINE_AA)

        # ── 3. Activity Intensity Bar (top-left) ──────────────────────────────
        bar_x  = int(14 * scale)
        bar_y  = int(14 * scale)
        bar_w  = int(160 * scale)
        bar_h  = int(22 * scale)
        fill   = int(bar_w * min(intensity / 100, 1.0))
        self._blend_rect(out, bar_x - 4, bar_y - 4, bar_x + bar_w + 4, bar_y + bar_h + 4,
                         (6, 10, 18), alpha=0.80)
        self._blend_rect(out, bar_x, bar_y, bar_x + bar_w, bar_y + bar_h,
                         (30, 35, 45), alpha=0.90)
        if fill > 0:
            self._blend_rect(out, bar_x, bar_y, bar_x + fill, bar_y + bar_h,
                             bar_color, alpha=0.90)
        self._draw_rounded_rect(out, bar_x, bar_y, bar_x + bar_w, bar_y + bar_h,
                                (80, 90, 110), 1, radius=3)
        cv2.putText(out, f"ACTIVITY  {int(intensity)}%",
                    (bar_x + int(5 * scale), bar_y + int(15 * scale)),
                    FONTB, 0.40 * scale, (220, 230, 255), max(1, int(scale)), cv2.LINE_AA)

        # ── 4. Idle Timer (center — only when truly idle AND no moving workers) ─
        show_idle_ui = (zone_state in (ZS_IDLE, ZS_ALERTED)
                        and idle_started_at is not None
                        and not any_moving)   # fast-path: hide immediately when motion starts

        if show_idle_ui:
            idle_secs = int(time.time() - idle_started_at)
            m_i, s_i = divmod(idle_secs, 60)
            h_i, m_i = divmod(m_i, 60)
            idle_str = (f"{h_i}h {m_i}m {s_i}s" if h_i > 0
                        else f"{m_i}m {s_i}s" if m_i > 0
                        else f"{s_i}s")

            # Pulsing border — orange for ALERTED, blue for IDLE
            border_color = C_ALERTED if zone_state == ZS_ALERTED else C_IDLE
            pulse_alpha  = 0.3 + 0.3 * math.sin(time.time() * 2)
            bov = out.copy()
            cv2.rectangle(bov, (4, 4), (W - 4, H - 4), border_color, 6)
            cv2.addWeighted(bov, pulse_alpha, out, 1 - pulse_alpha, 0, out)

            # Centered text
            cx_frame, cy_frame = W // 2, H // 2
            title_str = "ZONE ALERTED" if zone_state == ZS_ALERTED else "ZONE IDLE"
            for text, dy, fs, thick in [
                (title_str, int(-28 * scale), 0.8 * scale, 2),
                (idle_str,  int( 14 * scale), 1.0 * scale, 2),
            ]:
                (tw, th), _ = cv2.getTextSize(text, FONT, fs, thick)
                tx = cx_frame - tw // 2
                ty = cy_frame + dy
                cv2.rectangle(out, (tx - int(8 * scale), ty - th - int(4 * scale)),
                              (tx + tw + int(8 * scale), ty + int(6 * scale)), (0, 0, 0), -1)
                cv2.putText(out, text, (tx, ty), FONT, fs, border_color, thick, cv2.LINE_AA)

        # ── 5. Activity Timeline Strip (bottom) ───────────────────────────────
        strip_h = int(28 * scale)
        strip_y = H - strip_h
        ov = out.copy()
        cv2.rectangle(ov, (0, strip_y), (W, H), (15, 15, 15), -1)
        cv2.addWeighted(ov, 0.7, out, 0.3, 0, out)

        timeline = list(self._timeline)
        if timeline:
            # Each timeline entry is a zone state change; draw as a continuous segment
            # spanning from that change to the next. Most recent state fills to right edge.
            now_t = time.time()
            oldest_t = timeline[0][0]
            span = max(1.0, now_t - oldest_t)
            for idx, (ts, state) in enumerate(timeline):
                t_start = ts
                t_end   = timeline[idx + 1][0] if idx + 1 < len(timeline) else now_t
                bx1 = int((t_start - oldest_t) / span * W)
                bx2 = int((t_end   - oldest_t) / span * W)
                if bx2 <= bx1:
                    bx2 = bx1 + 2
                tl_color = (
                    C_ACTIVE_BAR if state == ZS_ACTIVE      else
                    C_LOW_BAR    if state == ZS_LOW_ACTIVITY else
                    C_IDLE_BAR   if state == ZS_IDLE         else
                    C_ALERTED
                )
                cv2.rectangle(out, (bx1, strip_y + int(4 * scale)),
                              (bx2, H - int(4 * scale)), tl_color, -1)

        cv2.putText(out, "Zone Activity History",
                    (int(6 * scale), H - int(8 * scale)),
                    FONT, 0.38 * scale, (160, 160, 160), 1, cv2.LINE_AA)

        # ── 6. Zone Status Panel (top-right) — matches Workforce panel proportions ─
        moving_n = len([t for t in confirmed if t.motion_state == MS_MOVING])
        stat_n   = len([t for t in confirmed if t.motion_state == MS_STATIONARY])
        idle_n   = len([t for t in confirmed if t.motion_state == MS_IDLE])
        total_n  = len(confirmed)

        state_color = (
            C_ACTIVE_BAR if zone_state == ZS_ACTIVE      else
            C_LOW_BAR    if zone_state == ZS_LOW_ACTIVITY else
            C_IDLE       if zone_state == ZS_IDLE         else
            C_ALERTED
        )

        panel_w  = int(230 * scale)
        panel_h  = int(195 * scale)
        margin   = int(14 * scale)
        px       = W - panel_w - margin
        py       = margin
        pad      = int(12 * scale)
        lh       = int(22 * scale)

        # Dark background + blue accent top strip + rounded border (matches workforce)
        self._blend_rect(out, px, py, px + panel_w, py + panel_h, (6, 10, 18), alpha=0.88)
        self._blend_rect(out, px, py, px + panel_w, py + int(3 * scale), (80, 140, 220), alpha=0.95)
        self._draw_rounded_rect(out, px, py, px + panel_w, py + panel_h,
                                (70, 100, 140), max(1, int(scale)), radius=6)

        cy = py + int(20 * scale)

        # Title row
        cv2.putText(out, "ACTIVITY STATUS",
                    (px + pad, cy), FONTB, 0.48 * scale, (120, 185, 255),
                    max(1, int(scale)), cv2.LINE_AA)
        cy += int(4 * scale)
        cv2.line(out,
                 (px + pad, cy + int(3 * scale)),
                 (px + panel_w - pad, cy + int(3 * scale)),
                 (50, 70, 100), 1)
        cy += int(10 * scale)

        # Zone state (large, like worker count in workforce)
        state_label = zone_state.replace("_", " ")
        cv2.putText(out, state_label,
                    (px + pad, cy + int(lh * 0.85)),
                    FONTB, 0.75 * scale, state_color,
                    max(1, int(scale + 0.5)), cv2.LINE_AA)
        cy += lh + int(4 * scale)

        # Worker count line
        live_txt = f"Workers: {total_n}"
        cv2.putText(out, live_txt,
                    (px + pad, cy + int(12 * scale)),
                    FONT, 0.40 * scale, (160, 175, 200),
                    max(1, int(scale)), cv2.LINE_AA)
        cy += int(18 * scale)

        # Moving / Stationary / Idle pills
        for lbl, val, col in [
            ("Moving",     moving_n, C_MOVING),
            ("Stationary", stat_n,   C_STATIONARY),
            ("Idle",       idle_n,   C_IDLE),
        ]:
            self._blend_rect(out, px + pad, cy,
                             px + pad + int(110 * scale), cy + int(18 * scale),
                             (int(col[0]*0.15), int(col[1]*0.15), int(col[2]*0.15)), alpha=0.80)
            cv2.putText(out, f"  {val}  {lbl}",
                        (px + pad + int(4 * scale), cy + int(13 * scale)),
                        FONT, 0.40 * scale, col, max(1, int(scale)), cv2.LINE_AA)
            cy += int(20 * scale)

        # Activity score bar at bottom
        cy += int(4 * scale)
        score_bar_w = int(panel_w - pad * 2)
        score_bar_h = int(10 * scale)
        score_fill  = int(score_bar_w * act_score / 100)
        self._blend_rect(out, px + pad, cy, px + pad + score_bar_w, cy + score_bar_h,
                         (30, 35, 45), alpha=0.90)
        if score_fill > 0:
            self._blend_rect(out, px + pad, cy, px + pad + score_fill, cy + score_bar_h,
                             bar_color, alpha=0.85)
        cv2.putText(out, f"Score {act_score}%",
                    (px + pad, cy + score_bar_h + int(12 * scale)),
                    FONT, 0.38 * scale, (160, 175, 200), 1, cv2.LINE_AA)

        # ── 7. Smart Alert Banner (ALERTED only) ──────────────────────────────
        if zone_state == ZS_ALERTED and idle_started_at is not None:
            idle_mins   = int((time.time() - idle_started_at) / 60)
            banner_text = f"ACTIVITY DROP DETECTED \u2014 Zone idle {idle_mins}m"
            fade_alpha  = min(1.0, 0.4 + 0.3 * abs(math.sin(time.time())))
            bh_banner   = int(32 * scale)
            ov = out.copy()
            cv2.rectangle(ov, (0, H // 2 - bh_banner), (W, H // 2), (0, 0, 80), -1)
            cv2.addWeighted(ov, fade_alpha * 0.85, out, 1 - fade_alpha * 0.85, 0, out)
            (tw, _), _ = cv2.getTextSize(banner_text, FONT, 0.52 * scale, 1)
            cv2.putText(out, f"\u26a0 {banner_text}",
                        ((W - tw) // 2, H // 2 - int(10 * scale)),
                        FONT, 0.52 * scale, C_ALERTED, 1, cv2.LINE_AA)

        # ── 8. Motion Field Arrow (aggregate direction, ≥2 MOVING tracks) ─────
        moving_tracks = [t for t in confirmed if t.motion_state == MS_MOVING
                         and len(t.last_positions) >= 2]
        if len(moving_tracks) >= 2:
            dx_sum, dy_sum = 0.0, 0.0
            for t in moving_tracks:
                pts = list(t.last_positions)
                dx_sum += pts[-1][0] - pts[-2][0]
                dy_sum += pts[-1][1] - pts[-2][1]
            dx_avg = dx_sum / len(moving_tracks)
            dy_avg = dy_sum / len(moving_tracks)
            mag = math.sqrt(dx_avg**2 + dy_avg**2)
            if mag > 0.5:
                arrow_scale = min(60.0, max(15.0, intensity * 0.6)) * scale
                cx_arr = W // 2
                cy_arr = H // 2 - int(60 * scale)
                ex = int(cx_arr + (dx_avg / mag) * arrow_scale)
                ey = int(cy_arr + (dy_avg / mag) * arrow_scale)
                cv2.arrowedLine(out, (cx_arr, cy_arr), (ex, ey),
                                C_MOVING, max(2, int(2 * scale)), tipLength=0.35)

        return out
