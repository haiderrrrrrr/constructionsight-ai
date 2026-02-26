"""
Workforce Analytics Engine — WorkerTrack state machine + WorkforceProcessor.

Architecture:
  - WorkforceProcessor reads from _workforce_detection_inbox (posted by PPE inferencer
    after ByteTrack, or by standalone wf detector when PPE is off).
  - Zero extra YOLO/ByteTrack when PPE is co-running on the same camera.
  - Draws premium overlays onto a copy of the raw frame → _workforce_annotated[camera_id].
  - Computes per-camera metrics every 30 inbox reads.
  - Checks alert thresholds, enqueues snapshots/alerts via workforce_event_queue.
  - Pushes SSE stats to workforce_dashboard_broker.
"""

from __future__ import annotations

import logging
import math
import threading
import time
from collections import deque
from typing import Dict, Optional

import cv2
import numpy as np

logger = logging.getLogger(__name__)

# ── Worker states ─────────────────────────────────────────────────────────────
WS_ENTERING   = "ENTERING"
WS_ACTIVE     = "ACTIVE"
WS_IDLE       = "IDLE"
WS_EXITED     = "EXITED"

# ── Module-level processor registry ──────────────────────────────────────────
_processors: Dict[int, "WorkforceProcessor"] = {}
_processors_lock = threading.Lock()


def get_processor(camera_id: int) -> Optional["WorkforceProcessor"]:
    with _processors_lock:
        return _processors.get(camera_id)


def register_processor(camera_id: int, processor: "WorkforceProcessor") -> None:
    with _processors_lock:
        _processors[camera_id] = processor


def unregister_processor(camera_id: int) -> None:
    with _processors_lock:
        _processors.pop(camera_id, None)


def get_all_processors() -> Dict[int, "WorkforceProcessor"]:
    with _processors_lock:
        return dict(_processors)


# ─────────────────────────────────────────────────────────────────────────────
# WorkerTrack — per-worker state machine
# ─────────────────────────────────────────────────────────────────────────────

class WorkerTrack:
    """Tracks a single worker (one ByteTrack ID) with workforce state machine."""

    __slots__ = (
        "track_id", "logical_id", "first_seen_at", "last_seen_at",
        "frames_seen", "frames_lost", "last_positions", "dwell_time_seconds",
        "movement_score", "worker_state", "idle_since",
        "x1", "y1", "x2", "y2",
    )

    def __init__(self, track_id: int, logical_id: int):
        self.track_id           = track_id
        self.logical_id         = logical_id   # may differ if reconciled with prior track
        self.first_seen_at      = time.time()
        self.last_seen_at       = time.time()
        self.frames_seen        = 0
        self.frames_lost        = 0
        self.last_positions: deque = deque(maxlen=20)
        self.dwell_time_seconds = 0.0
        self.movement_score     = 0.0
        self.worker_state       = WS_ENTERING
        self.idle_since: Optional[float] = None
        self.x1 = self.y1 = self.x2 = self.y2 = 0

    def update(self, x1: int, y1: int, x2: int, y2: int, cfg: dict) -> None:
        """Update position, dwell time, movement score and state machine."""
        now = time.time()
        cx  = (x1 + x2) / 2.0
        cy  = (y1 + y2) / 2.0

        self.x1 = x1; self.y1 = y1; self.x2 = x2; self.y2 = y2
        self.last_positions.append((cx, cy))
        self.last_seen_at       = now
        self.frames_seen       += 1
        self.frames_lost        = 0
        self.dwell_time_seconds = now - self.first_seen_at

        # Compute movement score (avg frame-to-frame distance over last 20 positions)
        if len(self.last_positions) >= 2:
            positions = list(self.last_positions)
            dists = [
                math.sqrt((positions[i][0] - positions[i-1][0])**2 +
                          (positions[i][1] - positions[i-1][1])**2)
                for i in range(1, len(positions))
            ]
            self.movement_score = sum(dists) / len(dists) if dists else 0.0
        else:
            self.movement_score = 0.0

        confirm_frames      = cfg.get("workforce_confirm_frames", 8)
        move_thresh         = cfg.get("workforce_movement_thresh", 8.0)
        idle_time_secs      = cfg.get("workforce_idle_time_seconds", 30)
        # Hysteresis: higher threshold to break out of IDLE — prevents bbox jitter flicker
        reactivation_thresh = cfg.get("workforce_idle_reactivation_thresh", 15.0)

        if self.frames_seen < confirm_frames:
            self.worker_state = WS_ENTERING
            return

        if self.worker_state == WS_ENTERING:
            self.worker_state = WS_ACTIVE if self.movement_score > move_thresh else WS_IDLE
            self.idle_since   = now if self.worker_state == WS_IDLE else None
            return

        if self.worker_state == WS_IDLE:
            # Dead-zone: need significantly more movement to re-activate from IDLE
            if self.movement_score > reactivation_thresh:
                self.worker_state = WS_ACTIVE
                self.idle_since   = None
        elif self.movement_score > move_thresh:
            self.worker_state = WS_ACTIVE
            self.idle_since   = None
        else:
            if self.worker_state == WS_ACTIVE:
                if self.idle_since is None:
                    self.idle_since = now
                if (now - self.idle_since) >= idle_time_secs:
                    self.worker_state = WS_IDLE

    def mark_lost(self) -> None:
        self.frames_lost += 1


# ─────────────────────────────────────────────────────────────────────────────
# WorkforceProcessor — consumer thread + overlays + metrics + alerts
# ─────────────────────────────────────────────────────────────────────────────

class WorkforceProcessor:
    """
    Per-camera workforce analytics processor.
    Reads from _workforce_detection_inbox, applies WorkerTrack state machines,
    computes metrics, draws overlays, pushes SSE stats, checks alerts.
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
        self._tracks: Dict[int, WorkerTrack] = {}
        self._next_logical_id = 1

        # Reconciliation buffer: recently exited tracks
        self._recently_exited: Dict[int, dict] = {}

        # Metrics (updated every N reads)
        self._metrics: dict = {}
        self._metrics_lock = threading.Lock()
        self._metrics_frame_count = 0

        # Session peaks
        self._peak_worker_count = 0
        self._peak_active_count = 0

        # Sparkline (last 20 worker counts)
        self._sparkline: deque = deque(maxlen=20)

        # Alert tracking
        self._last_alert_times: Dict[str, float] = {}
        self._understaffed_since: Optional[float] = None
        # Rolling average sample buffer for understaffed — maxlen set dynamically per config
        self._understaffed_sample_counts: deque = deque()
        self._idle_ratio_high_since: Optional[float] = None
        self._overload_since: Optional[float] = None
        self._prev_worker_count = 0
        self._prev_worker_count_time = time.time()

        # Snapshot tracking
        self._last_snapshot_time = 0.0
        self._prev_zone_status   = "BALANCED"

        # Heatmap accumulator — stored at 1/4 resolution for performance
        self._heatmap: Optional[np.ndarray] = None
        self._heatmap_H = 0
        self._heatmap_W = 0
        self._heatmap_scale   = 4   # store at 1/4 res: 16× cheaper numpy ops
        self._heatmap_frame_skip = 0  # used by _update_heatmap (every 4th frame)
        self._heatmap_render_skip = 0  # used by _draw_overlays cache (every 3rd frame)
        self._cached_heatmap_blend: Optional[np.ndarray] = None  # cached full-res blend

        # Density pulse animation state
        self._pulse_center: Optional[tuple] = None
        self._pulse_radius  = 0
        self._pulse_alpha   = 0.0
        self._pulse_frame_counter = 0

        # Sudden-drop banner flag (active for 60s after a sudden_drop alert fires)
        self._sudden_drop_active_until = 0.0

        # Recommendation chip text (updated each metrics cycle via alert check)
        self._last_recommendation_chip: str = "v Zone Healthy"

        # Flow arrow state — aggregate displacement vector, EMA-smoothed
        self._flow_dx: float = 0.0
        self._flow_dy: float = 0.0
        self._flow_magnitude: float = 0.0
        self._flow_frame_counter = 0

        # Count smoothing — rolling window of last 5 raw counts for median filter
        self._count_history: deque = deque(maxlen=5)

    # ── Public API ────────────────────────────────────────────────────────────

    def start(self, cfg: dict) -> None:
        self._cfg = cfg
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._consumer_loop,
            daemon=True,
            name=f"wf-consumer-{self.camera_id}",
        )
        self._thread.start()
        logger.info(f"[WorkforceProcessor] Camera {self.camera_id} started")

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2.0)
        logger.info(f"[WorkforceProcessor] Camera {self.camera_id} stopped")

    def is_running(self) -> bool:
        return not self._stop.is_set()

    def update_config(self, cfg: dict) -> None:
        """Hot-reload config while the processor is running. Takes effect on next frame."""
        self._cfg = cfg

    def get_latest_metrics(self) -> dict:
        with self._metrics_lock:
            return dict(self._metrics)

    # ── Consumer loop ─────────────────────────────────────────────────────────

    def _consumer_loop(self) -> None:
        from ..api.routes.ml_stream_enterprise import (
            _workforce_detection_inbox,
            _workforce_inbox_locks,
            _workforce_annotated,
        )
        last_seq = -1

        while not self._stop.is_set():
            lock_key = self.camera_id
            if lock_key not in _workforce_inbox_locks:
                time.sleep(0.02)
                continue

            inbox_lock = _workforce_inbox_locks[lock_key]
            with inbox_lock:
                inbox = _workforce_detection_inbox.get(self.camera_id)

            if inbox is None or inbox["seq"] == last_seq:
                time.sleep(0.005)
                continue

            last_seq    = inbox["seq"]
            detections  = inbox["detections"]
            frame       = inbox.get("frame")
            if frame is None:
                continue

            frame = frame.copy()
            H, W  = frame.shape[:2]

            # Init heatmap at 1/4 resolution — 16× cheaper than full res
            hm_H = H // self._heatmap_scale
            hm_W = W // self._heatmap_scale
            if self._heatmap is None or self._heatmap_H != H or self._heatmap_W != W:
                self._heatmap   = np.zeros((hm_H, hm_W), dtype=np.float32)
                self._heatmap_H = H
                self._heatmap_W = W

            cfg = self._cfg
            self._metrics_frame_count += 1

            # Update tracks
            seen_ids = set()
            for det in detections:
                tid = det["track_id"]
                seen_ids.add(tid)
                if tid not in self._tracks:
                    height_px  = det["y2"] - det["y1"]
                    logical_id = self._reconcile_or_new(det["cx"], det["cy"], height_px, cfg)
                    self._tracks[tid] = WorkerTrack(tid, logical_id)
                self._tracks[tid].update(det["x1"], det["y1"], det["x2"], det["y2"], cfg)

            # Mark lost tracks
            lost_frames_thresh = cfg.get("workforce_lost_frames", 45)
            to_remove = []
            for tid, track in list(self._tracks.items()):
                if tid not in seen_ids:
                    track.mark_lost()
                    if track.frames_lost >= lost_frames_thresh:
                        if track.last_positions:
                            lx, ly = track.last_positions[-1]
                        else:
                            lx, ly = 0.0, 0.0
                        self._recently_exited[tid] = {
                            "last_cx":      lx,
                            "last_cy":      ly,
                            "exited_at":    time.time(),
                            "logical_id":   track.logical_id,
                            "dwell_so_far": track.dwell_time_seconds,
                            "height_px":    track.y2 - track.y1,  # for height-hint reconciliation
                        }
                        to_remove.append(tid)

            for tid in to_remove:
                del self._tracks[tid]

            # Expire old reconciliation entries
            rec_window = cfg.get("workforce_reconcile_window_secs", 4)
            now = time.time()
            expired = [k for k, v in self._recently_exited.items()
                       if now - v["exited_at"] > rec_window]
            for k in expired:
                del self._recently_exited[k]

            # Compute metrics every 30 frames
            _fire_alerts_this_frame = False
            _metrics_this_frame     = None
            if self._metrics_frame_count % 30 == 0:
                _metrics_this_frame = self._compute_metrics(cfg)
                with self._metrics_lock:
                    self._metrics = _metrics_this_frame
                self._sparkline.append(_metrics_this_frame["current_worker_count"])
                self._push_sse(_metrics_this_frame)
                self._maybe_enqueue_snapshot(_metrics_this_frame, cfg, trigger="interval")
                _fire_alerts_this_frame = True

            # Draw overlays BEFORE firing alerts so the snapshot frame includes tracking boxes/zones
            self._update_heatmap(cfg)
            annotated_frame = self._draw_overlays(frame, cfg)

            if _fire_alerts_this_frame:
                self._check_and_fire_alerts(_metrics_this_frame, cfg, annotated_frame)

            # Write to annotated dict
            if self.camera_id not in _workforce_annotated:
                _workforce_annotated[self.camera_id] = {
                    "frame": None, "seq": 0, "lock": threading.Lock()
                }
            ann = _workforce_annotated[self.camera_id]
            with ann["lock"]:
                ann["frame"] = annotated_frame
                ann["seq"]   = last_seq

    # ── Reconciliation ────────────────────────────────────────────────────────

    def _reconcile_or_new(self, cx: float, cy: float, height_px: float, cfg: dict) -> int:
        """
        Return an existing logical_id if a recent exit matches, else allocate new.

        Scoring combines position distance + height similarity so that after two
        workers cross (positions swap, heights stay the same) the correct logical
        ID is restored to the correct person.

        score = position_dist + height_penalty
        height_penalty = abs(new_height - exited_height) * 0.5
        Lower score = better match.
        """
        dist_thresh = cfg.get("workforce_reconcile_distance_px", 120)
        window      = cfg.get("workforce_reconcile_window_secs", 6)
        now         = time.time()
        best_key    = None
        best_score  = float("inf")

        for k, rec in self._recently_exited.items():
            if now - rec["exited_at"] > window:
                continue
            pos_dist       = math.sqrt((cx - rec["last_cx"])**2 + (cy - rec["last_cy"])**2)
            if pos_dist >= dist_thresh:
                continue
            # Height hint: penalise mismatched heights so tall/short workers
            # don't steal each other's IDs after crossing
            exited_h       = rec.get("height_px", height_px)  # fallback: no penalty
            height_penalty = abs(height_px - exited_h) * 0.5
            score          = pos_dist + height_penalty
            if score < best_score:
                best_score = score
                best_key   = k

        if best_key is not None:
            rec        = self._recently_exited.pop(best_key)
            logical_id = rec["logical_id"]
            logger.debug(
                f"[WF reconcile] Camera {self.camera_id} → logical {logical_id} "
                f"(score={best_score:.1f})"
            )
            return logical_id

        lid = self._next_logical_id
        self._next_logical_id += 1
        return lid

    # ── Metrics ───────────────────────────────────────────────────────────────

    def _compute_metrics(self, cfg: dict) -> dict:
        # ── Level 1: Minimum stable frames before counting ───────────────────
        # A new track from an occlusion ID-split must exist for min_stable frames
        # before it enters the count. Matched to lost_frames_thresh so the old
        # track expires before the new one starts counting → zero double-counting.
        min_stable     = cfg.get("workforce_lost_frames", 20)
        confirmed      = [t for t in self._tracks.values()
                         if t.worker_state in (WS_ACTIVE, WS_IDLE)
                         and t.frames_seen >= min_stable
                         and t.frames_lost <= 5]
        entering       = [t for t in self._tracks.values() if t.worker_state == WS_ENTERING]
        raw_total      = len(confirmed)

        # ── Level 2: Median smoothing over last 5 readings ───────────────────
        # Absorbs any 1-2 frame spikes that slip through the stable-frames gate.
        self._count_history.append(raw_total)
        counts         = sorted(self._count_history)
        total          = counts[len(counts) // 2]  # median

        active_count   = len([t for t in confirmed if t.worker_state == WS_ACTIVE])
        idle_count     = len([t for t in confirmed if t.worker_state == WS_IDLE])
        entering_count = len(entering)
        active_ratio   = active_count / total if total > 0 else 0.0
        idle_ratio     = idle_count   / total if total > 0 else 0.0
        avg_dwell      = (sum(t.dwell_time_seconds for t in confirmed) / total
                          if total > 0 else 0.0)

        under_thresh    = cfg.get("workforce_understaffed_threshold", 2)
        over_thresh     = cfg.get("workforce_overloaded_threshold",   15)
        presence_score  = min(total / max(under_thresh, 1), 1.0) * 40
        active_score    = active_ratio * 40
        idle_penalty    = idle_ratio   * 15
        congestion_pen  = 5 if total > over_thresh else 0
        utilization_score = int(max(0, min(100, round(
            presence_score + active_score - idle_penalty - congestion_pen
        ))))

        zone_status     = (
            "UNDERSTAFFED" if total < under_thresh else
            "OVERLOADED"   if total > over_thresh  else
            "BALANCED"
        )
        congestion_flag = total > over_thresh

        if total > self._peak_worker_count:
            self._peak_worker_count = total
        if active_count > self._peak_active_count:
            self._peak_active_count = active_count

        return {
            "camera_id":            self.camera_id,
            "project_id":           self.project_id,
            "zone_id":              self.zone_id,
            "zone_name":            self.zone_name,
            "current_worker_count": total,
            "active_count":         active_count,
            "idle_count":           idle_count,
            "entering_count":       entering_count,
            "active_ratio":         round(active_ratio, 3),
            "idle_ratio":           round(idle_ratio, 3),
            "avg_dwell_seconds":    round(avg_dwell, 1),
            "utilization_score":    utilization_score,
            "zone_status":          zone_status,
            "congestion_flag":      congestion_flag,
            "peak_worker_count":    self._peak_worker_count,
            "peak_active_count":    self._peak_active_count,
            "sparkline":            list(self._sparkline),
            "timestamp":            time.time(),
        }

    # ── SSE push ──────────────────────────────────────────────────────────────

    def _push_sse(self, metrics: dict) -> None:
        try:
            from . import workforce_dashboard_broker as broker
            from datetime import datetime, timezone
            payload = {
                "type":                 "workforce_stats_update",
                "camera_id":            metrics["camera_id"],
                "zone_name":            metrics["zone_name"],
                "current_worker_count": metrics["current_worker_count"],
                "active_count":         metrics["active_count"],
                "idle_count":           metrics["idle_count"],
                "entering_count":       metrics["entering_count"],
                "active_ratio":         metrics["active_ratio"],
                "idle_ratio":           metrics["idle_ratio"],
                "utilization_score":    metrics["utilization_score"],
                "zone_status":          metrics["zone_status"],
                "congestion_flag":      metrics["congestion_flag"],
                "avg_dwell_seconds":    metrics["avg_dwell_seconds"],
                "sparkline":            metrics["sparkline"],
                "timestamp":            datetime.now(timezone.utc).isoformat(),
            }
            broker.push(self.project_id, payload)
        except Exception as e:
            logger.debug(f"[WorkforceProcessor] SSE push error: {e}")

    # ── Alerts ────────────────────────────────────────────────────────────────

    def _check_and_fire_alerts(self, metrics: dict, cfg: dict, frame=None) -> None:
        now            = time.time()
        _SENSITIVITY_COOLDOWN = {"low": 1200, "medium": 600, "high": 60, "ultra_high": 10}
        sensitivity    = cfg.get("alert_sensitivity", "medium")
        cooldown       = _SENSITIVITY_COOLDOWN.get(sensitivity, cfg.get("workforce_alert_cooldown_secs", 600))
        total          = metrics["current_worker_count"]
        idle_ratio     = metrics["idle_ratio"]
        congestion     = metrics["congestion_flag"]
        under_thresh   = cfg.get("workforce_understaffed_threshold", 2)
        # Configurable idle alert percentage (default 60%)
        idle_alert_pct = cfg.get("workforce_idle_alert_threshold", 60) / 100.0

        # ── Rolling average understaffed (prevents passers-through resetting timer) ──
        confirm_samples = cfg.get("workforce_understaffed_confirm_samples", 30)
        self._understaffed_sample_counts.append(total)
        # Trim to current confirm_samples so config changes take effect immediately
        while len(self._understaffed_sample_counts) > confirm_samples:
            self._understaffed_sample_counts.popleft()
        if len(self._understaffed_sample_counts) >= confirm_samples:
            avg_total = sum(self._understaffed_sample_counts) / len(self._understaffed_sample_counts)
            if avg_total < under_thresh:
                self._fire_alert(
                    "understaffed", metrics,
                    f"Zone '{metrics['zone_name']}' avg occupancy below minimum "
                    f"({avg_total:.1f} avg, required {under_thresh})",
                    "medium", cooldown, now, frame,
                )
                self._understaffed_sample_counts.clear()

        # ── Idle ratio high ────────────────────────────────────────────────────
        if idle_ratio > idle_alert_pct:
            if self._idle_ratio_high_since is None:
                self._idle_ratio_high_since = now
            elif now - self._idle_ratio_high_since >= 300:
                # Find most-idle worker (longest dwell among IDLE state tracks)
                idle_tracks = [t for t in self._tracks.values() if t.worker_state == WS_IDLE]
                idle_wid = max(idle_tracks, key=lambda t: t.dwell_time_seconds).logical_id if idle_tracks else None
                self._fire_alert(
                    "idle_ratio_high", metrics,
                    f"High idle concentration in '{metrics['zone_name']}' ({round(idle_ratio*100)}% idle)",
                    "medium", cooldown, now, frame, worker_id=idle_wid,
                )
        else:
            self._idle_ratio_high_since = None

        # ── Sudden drop (>50% in 60s) ──────────────────────────────────────────
        elapsed = now - self._prev_worker_count_time
        if elapsed >= 60:
            if self._prev_worker_count > 1 and total < self._prev_worker_count * 0.5:
                # Find most-senior worker still present (longest dwell — most likely to have witnessed the drop)
                confirmed = [t for t in self._tracks.values() if t.worker_state in (WS_ACTIVE, WS_IDLE)]
                drop_wid = max(confirmed, key=lambda t: t.dwell_time_seconds).logical_id if confirmed else None
                self._fire_alert(
                    "sudden_drop", metrics,
                    f"Sudden worker drop in '{metrics['zone_name']}': {self._prev_worker_count} → {total}",
                    "high", cooldown, now, frame, worker_id=drop_wid,
                )
                self._sudden_drop_active_until = now + 60.0  # banner shows for 60s
            self._prev_worker_count      = total
            self._prev_worker_count_time = now

        # ── Overload / congestion ──────────────────────────────────────────────
        overload_confirm = cfg.get("workforce_overload_confirm_seconds", 180)
        if congestion:
            if self._overload_since is None:
                self._overload_since = now
            elif now - self._overload_since >= overload_confirm:
                self._fire_alert(
                    "overload", metrics,
                    f"Congestion risk in '{metrics['zone_name']}' ({total} workers)",
                    "high", cooldown, now, frame,
                )
        else:
            self._overload_since = None

        # ── Update recommendation chip text ───────────────────────────────────
        z_status = metrics["zone_status"]
        if z_status == "UNDERSTAFFED":
            self._last_recommendation_chip = "+ Add Workers"
        elif z_status == "OVERLOADED":
            self._last_recommendation_chip = "Rebalance Manpower"
        elif idle_ratio > idle_alert_pct:
            self._last_recommendation_chip = "~ Monitor Idle Cluster"
        else:
            self._last_recommendation_chip = "v Zone Healthy"

    def _fire_alert(self, alert_type: str, metrics: dict, message: str,
                    severity: str, cooldown: float, now: float, frame=None,
                    worker_id: Optional[int] = None) -> None:
        last = self._last_alert_times.get(alert_type, 0)
        if now - last < cooldown:
            return
        self._last_alert_times[alert_type] = now
        logger.info(f"[WorkforceProcessor] Alert {alert_type}: {message}")

        # Enqueue to event queue — DB write + authoritative SSE broadcast happens there.
        # No direct broker.push() here to avoid duplicate toasts before DB write.
        try:
            from . import workforce_event_queue as wq
            wq.try_enqueue({
                "kind":           "alert",
                "project_id":     self.project_id,
                "camera_id":      self.camera_id,
                "zone_id":        self.zone_id,
                "zone_name":      self.zone_name,
                "alert_type":     alert_type,
                "severity":       severity,
                "message":        message,
                "worker_id":      worker_id,
                "snapshot_frame": frame.copy() if frame is not None else None,
            })
        except Exception as e:
            logger.debug(f"[WorkforceProcessor] alert enqueue error: {e}")

    # ── Snapshot persistence ──────────────────────────────────────────────────

    def _maybe_enqueue_snapshot(self, metrics: dict, cfg: dict, trigger: str = "interval") -> None:
        now             = time.time()
        interval        = cfg.get("workforce_snapshot_interval_secs", 60)
        cur_zone_status = metrics["zone_status"]

        if cur_zone_status != self._prev_zone_status:
            self._enqueue_snapshot(metrics, trigger="transition")
            self._prev_zone_status   = cur_zone_status
            self._last_snapshot_time = now
            return

        if trigger == "interval" and now - self._last_snapshot_time >= interval:
            self._enqueue_snapshot(metrics, trigger="interval")
            self._last_snapshot_time = now
            self._prev_zone_status   = cur_zone_status

    def _enqueue_snapshot(self, metrics: dict, trigger: str = "interval") -> None:
        try:
            from . import workforce_event_queue as wq
            wq.try_enqueue({
                "kind":              "snapshot",
                "project_id":        self.project_id,
                "camera_id":         self.camera_id,
                "zone_id":           self.zone_id,
                "zone_name":         self.zone_name,
                "worker_count":      metrics["current_worker_count"],
                "active_count":      metrics["active_count"],
                "idle_count":        metrics["idle_count"],
                "utilization_score": metrics["utilization_score"],
                "zone_status":       metrics["zone_status"],
                "congestion_flag":   metrics["congestion_flag"],
                "avg_dwell_seconds": metrics["avg_dwell_seconds"],
                "sparkline_json":    str(metrics["sparkline"]),
                "trigger":           trigger,
            })
        except Exception as e:
            logger.debug(f"[WorkforceProcessor] snapshot enqueue error: {e}")

    # ── Heatmap update (1/4 resolution for performance) ───────────────────────

    def _update_heatmap(self, cfg: dict) -> None:
        if self._heatmap is None:
            return

        # Only recalculate every 4th frame — perceptually identical, 4× faster
        self._heatmap_frame_skip += 1
        if self._heatmap_frame_skip % 4 != 0:
            return

        sc     = self._heatmap_scale
        hm_H   = self._heatmap.shape[0]
        hm_W   = self._heatmap.shape[1]
        decay  = 0.97
        self._heatmap *= decay

        for track in self._tracks.values():
            if track.worker_state not in (WS_ACTIVE, WS_IDLE):
                continue
            if not track.last_positions:
                continue
            cx, cy = track.last_positions[-1]
            # Scale down to heatmap coords
            cx_hm = int(cx / sc)
            cy_hm = int(cy / sc)
            if 0 <= cx_hm < hm_W and 0 <= cy_hm < hm_H:
                cv2.circle(self._heatmap, (cx_hm, cy_hm), 10, 0.5, -1)

        mx = self._heatmap.max()
        if mx > 0:
            self._heatmap /= mx

    # ── Drawing helpers ────────────────────────────────────────────────────────

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

    # ── Main overlay compositor ───────────────────────────────────────────────

    def _draw_overlays(self, frame: np.ndarray, cfg: dict) -> np.ndarray:
        H, W  = frame.shape[:2]
        scale = max(0.5, min(2.0, W / 1280.0))

        # ── 1. Heatmap (upscale from 1/4 resolution before blending) ─────────
        # Recompute the colormap+mask layer every 3rd frame and cache it.
        # The upscale + applyColorMap is expensive (~10-20ms); the heatmap
        # changes slowly so a 3-frame cache is visually indistinguishable.
        # The cached layer (hm_col + mask) is frame-independent and applied
        # fresh to each new frame.
        self._heatmap_render_skip += 1
        if self._heatmap is not None and self._heatmap.max() > 0.01:
            if self._heatmap_render_skip >= 3 or self._cached_heatmap_blend is None:
                try:
                    hm_u8  = (self._heatmap * 255).astype(np.uint8)
                    hm_u8  = cv2.resize(hm_u8, (W, H), interpolation=cv2.INTER_LINEAR)
                    hm_col = cv2.applyColorMap(hm_u8, cv2.COLORMAP_JET)
                    # Zero-out non-heat pixels so addWeighted adds nothing there.
                    # Pre-baked overlay: hot pixels = JET color, cold pixels = 0.
                    # cv2.addWeighted(frame, 1.0, overlay, 0.32, 0) is SIMD-
                    # accelerated (~4× faster than numpy float64 broadcasting).
                    hm_col[hm_u8 <= 15] = 0
                    self._cached_heatmap_blend = hm_col
                    self._heatmap_render_skip = 0
                except Exception:
                    self._cached_heatmap_blend = None
            if self._cached_heatmap_blend is not None:
                try:
                    cv2.addWeighted(frame, 1.0, self._cached_heatmap_blend, 0.32, 0, frame)
                except Exception:
                    pass
        else:
            self._cached_heatmap_blend = None

        # ── 2+4. Pressure blobs + aura glows — merged into single overlay copy ──
        # Drawing both effects onto one overlay and blending once saves two
        # full-frame copy() + addWeighted() calls per frame.
        confirmed_tracks = [
            t for t in self._tracks.values()
            if t.worker_state in (WS_ACTIVE, WS_IDLE) and t.last_positions
        ]
        if confirmed_tracks:
            glow_ov = frame.copy()
            blob_r  = max(20, int(30 * scale))
            aura_r  = max(28, int(38 * scale))
            for track in confirmed_tracks:
                cx     = int((track.x1 + track.x2) / 2)
                cy     = int((track.y1 + track.y2) / 2)
                foot_y = min(track.y2 + 4, H - 1)
                if track.worker_state == WS_ACTIVE:
                    blob_color = (40, 180, 70)
                    aura_color = (50, 210, 80)
                else:
                    blob_color = (15, 130, 210)
                    aura_color = (20, 160, 255)
                # Blob (pressure glow)
                cv2.circle(glow_ov, (cx, cy), blob_r, blob_color, -1)
                # Aura rings at foot
                cv2.circle(glow_ov, (cx, foot_y), aura_r + 10, aura_color, -1)
                cv2.circle(glow_ov, (cx, foot_y), aura_r,      aura_color, -1)
            # Single blend for both blob + aura layers
            cv2.addWeighted(glow_ov, 0.16, frame, 0.84, 0, frame)

        # ── 3. Density pulse ──────────────────────────────────────────────────
        confirmed_pos = [list(t.last_positions)[-1] for t in confirmed_tracks]
        self._pulse_frame_counter += 1
        if self._pulse_frame_counter >= 90 and confirmed_pos:
            cx_mean = sum(p[0] for p in confirmed_pos) / len(confirmed_pos)
            cy_mean = sum(p[1] for p in confirmed_pos) / len(confirmed_pos)
            self._pulse_center        = (int(cx_mean), int(cy_mean))
            self._pulse_radius        = 14
            self._pulse_alpha         = 0.85
            self._pulse_frame_counter = 0

        if self._pulse_center and self._pulse_alpha > 0:
            pulse_ov      = frame.copy()
            alpha_clamped = max(0.0, self._pulse_alpha)
            cv2.circle(pulse_ov, self._pulse_center, self._pulse_radius, (255, 210, 60), 2)
            cv2.addWeighted(pulse_ov, alpha_clamped, frame, 1 - alpha_clamped, 0, frame)
            self._pulse_radius += int(6 * scale)
            self._pulse_alpha  -= 0.055
            if self._pulse_alpha <= 0:
                self._pulse_center = None


        # ── 5. Per-worker bounding boxes + aging tags ─────────────────────────
        FONT  = cv2.FONT_HERSHEY_SIMPLEX
        FONTB = cv2.FONT_HERSHEY_DUPLEX

        for track in self._tracks.values():
            if not track.last_positions:
                continue
            x1, y1, x2, y2 = track.x1, track.y1, track.x2, track.y2
            state = track.worker_state

            # Don't draw boxes/tags for unconfirmed tracks — only the aura glow
            # rendered above gives a subtle hint of detection-in-progress.
            if state == WS_ENTERING:
                continue

            # Visual grace period: hold box at last known position for up to 2 missed
            # frames, then hide. ByteTrack's internal Kalman buffer (~30 frames) means
            # frames_lost > 0 only fires on rare 1-2 frame detection dropouts. This
            # eliminates flicker without leaving ghost boxes for workers who truly exit.
            _VISUAL_GRACE = 5
            if track.frames_lost > _VISUAL_GRACE:
                continue

            if state == WS_ACTIVE:
                color = (50, 210, 80)
            elif state == WS_IDLE:
                color = (20, 160, 255)
            else:
                color = (100, 100, 100)

            # Rounded-corner bbox
            bbox_thick = max(2, int(3 * scale))
            self._draw_rounded_rect(frame, x1, y1, x2, y2, color, bbox_thick, radius=6)
            bar_h = max(4, int(5 * scale))
            self._blend_rect(frame, x1 + 2, y1 + 2, x2 - 2, y1 + bar_h + 2, color, alpha=0.55)

            # Worker aging tag: "W-03 • 08m 12s / Idle 45s"
            lid   = track.logical_id
            dwell = int(track.dwell_time_seconds)
            mm    = dwell // 60
            ss    = dwell % 60

            if state == WS_ACTIVE:
                line2 = f"ACTIVE  {mm:02d}m {ss:02d}s" if mm > 0 else f"ACTIVE  {ss}s"
            elif state == WS_IDLE:
                idle_secs = int(time.time() - track.idle_since) if track.idle_since else 0
                idle_mm   = idle_secs // 60
                line2     = (f"Idle  {idle_mm}m {idle_secs % 60}s"
                             if idle_mm > 0 else f"Idle  {idle_secs}s")
            elif state == WS_ENTERING:
                line2 = "Entering..."
            else:
                line2 = "Exited"

            line1 = f"W-{lid:02d}"
            fs1 = 0.62 * scale
            fs2 = 0.52 * scale
            th1 = max(1, int(scale))
            th2 = max(1, int(scale))

            (tw1, th1_sz), _ = cv2.getTextSize(line1, FONTB, fs1, th1)
            (tw2, th2_sz), _ = cv2.getTextSize(line2, FONT,  fs2, th2)

            pad_x, pad_y = int(10 * scale), int(7 * scale)
            tag_w = max(tw1, tw2) + pad_x * 2
            tag_h = th1_sz + th2_sz + pad_y * 2 + int(4 * scale)
            tag_x = max(0, min(x1, W - tag_w - 2))
            tag_y = max(tag_h + 2, y1 - int(6 * scale))

            self._blend_rect(frame, tag_x, tag_y - tag_h, tag_x + tag_w, tag_y,
                             (8, 12, 20), alpha=0.88)
            self._blend_rect(frame, tag_x, tag_y - tag_h,
                             tag_x + max(3, int(4 * scale)), tag_y, color, alpha=0.95)
            self._draw_rounded_rect(frame, tag_x, tag_y - tag_h, tag_x + tag_w, tag_y,
                                    color, 1, radius=4)
            cv2.putText(frame, line1,
                        (tag_x + pad_x, tag_y - pad_y - th2_sz - int(4 * scale)),
                        FONTB, fs1, (240, 245, 255), th1, cv2.LINE_AA)
            cv2.putText(frame, line2,
                        (tag_x + pad_x, tag_y - pad_y),
                        FONT, fs2, color, th2, cv2.LINE_AA)

        # Flow arrow removed — movement direction belongs in analytics reports,
        # not painted on the live stream.

        # ── 7. Utilization ring gauge (top-left corner) ───────────────────────
        with self._metrics_lock:
            m = dict(self._metrics)

        if m:
            util      = m.get("utilization_score", 0)
            ring_cx   = int(65 * scale)
            ring_cy   = int(65 * scale)
            ring_r    = int(45 * scale)
            ring_thick = max(5, int(8 * scale))

            # Dark background circle
            self._blend_rect(frame,
                             ring_cx - ring_r - ring_thick - 2,
                             ring_cy - ring_r - ring_thick - 2,
                             ring_cx + ring_r + ring_thick + 2,
                             ring_cy + ring_r + ring_thick + 2,
                             (6, 10, 18), alpha=0.75)

            # Background ring (full 360°, dark grey)
            cv2.ellipse(frame, (ring_cx, ring_cy), (ring_r, ring_r),
                        -90, 0, 360, (40, 50, 65), ring_thick, cv2.LINE_AA)

            # Colored fill arc proportional to utilization
            fill_angle = int(util / 100 * 360)
            if fill_angle > 0:
                ring_fill_color = (
                    (50, 210, 80)  if util >= 70 else
                    (20, 180, 255) if util >= 40 else
                    (40, 80, 220)
                )
                cv2.ellipse(frame, (ring_cx, ring_cy), (ring_r, ring_r),
                            -90, 0, fill_angle, ring_fill_color, ring_thick, cv2.LINE_AA)

            # Center: utilization %
            util_txt = f"{util}%"
            (utw, uth), _ = cv2.getTextSize(util_txt, FONTB, 0.55 * scale, max(1, int(scale)))
            cv2.putText(frame, util_txt,
                        (ring_cx - utw // 2, ring_cy + uth // 2),
                        FONTB, 0.55 * scale, (230, 240, 255), max(1, int(scale)), cv2.LINE_AA)
            # Sub-label
            sub_txt = "Utilized"
            (stw, _), _ = cv2.getTextSize(sub_txt, FONT, 0.32 * scale, 1)
            cv2.putText(frame, sub_txt,
                        (ring_cx - stw // 2, ring_cy + uth // 2 + int(14 * scale)),
                        FONT, 0.32 * scale, (140, 155, 180), 1, cv2.LINE_AA)

        # ── 8. Summary panel (top-right) ──────────────────────────────────────
        if m:
            self._draw_summary_panel(frame, m, H, W, FONT, FONTB, scale, cfg)

        # ── 9. Zone stability banner (bottom of frame) ────────────────────────
        if m:
            self._draw_stability_banner(frame, m, H, W, FONT, FONTB, scale)

        # ── 10. Recommendation chip (bottom-left, above banner) ───────────────
        if m:
            self._draw_recommendation_chip(frame, H, W, FONT, scale)

        return frame

    # ── Summary panel (top-right) ─────────────────────────────────────────────

    def _draw_summary_panel(self, frame: np.ndarray, m: dict, H: int, W: int,
                            FONT, FONTB, scale: float, cfg: dict = None) -> None:
        """Draw the enterprise workforce summary panel (top-right corner)."""
        total        = m.get("current_worker_count", 0)
        active       = m.get("active_count", 0)
        idle_cnt     = m.get("idle_count", 0)
        entering     = m.get("entering_count", 0)
        util         = m.get("utilization_score", 0)
        z_status     = m.get("zone_status", "BALANCED")
        sparkline    = m.get("sparkline", [])
        under_thresh = (cfg or {}).get("workforce_understaffed_threshold", 2)

        panel_w = int(265 * scale)
        panel_h = int(248 * scale)   # taller to fit benchmark + trend lines
        margin  = int(14 * scale)
        px      = W - panel_w - margin
        py      = margin

        # Background
        self._blend_rect(frame, px, py, px + panel_w, py + panel_h, (6, 10, 18), alpha=0.88)
        self._blend_rect(frame, px, py, px + panel_w, py + int(3 * scale), (80, 140, 220), alpha=0.95)
        self._draw_rounded_rect(frame, px, py, px + panel_w, py + panel_h,
                                (70, 100, 140), max(1, int(scale)), radius=6)

        lh  = int(22 * scale)
        pad = int(12 * scale)
        cy  = py + int(20 * scale)

        # Title
        cv2.putText(frame, "WORKFORCE STATUS",
                    (px + pad, cy), FONTB, 0.48 * scale, (120, 185, 255),
                    max(1, int(scale)), cv2.LINE_AA)
        cy += int(4 * scale)
        cv2.line(frame,
                 (px + pad, cy + int(3 * scale)),
                 (px + panel_w - pad, cy + int(3 * scale)),
                 (50, 70, 100), 1)
        cy += int(10 * scale)

        # Worker count (large)
        count_str = str(total)
        cv2.putText(frame, count_str,
                    (px + pad, cy + int(lh * 0.9)), FONTB, 1.1 * scale,
                    (230, 240, 255), max(1, int(scale + 0.5)), cv2.LINE_AA)
        cv2.putText(frame, "Workers",
                    (px + pad + int(30 * scale) + int(len(count_str) * 16 * scale), cy + int(lh * 0.9)),
                    FONT, 0.45 * scale, (160, 175, 200), max(1, int(scale)), cv2.LINE_AA)
        cy += lh + int(2 * scale)

        # ── Benchmark line: Required X  Live Y ────────────────────────────────
        live_color = (50, 210, 80) if total >= under_thresh else (40, 80, 220)
        req_txt    = f"Required: {under_thresh}"
        live_txt   = f"   Live: {total}"
        (rw, _), _ = cv2.getTextSize(req_txt, FONT, 0.40 * scale, 1)
        cv2.putText(frame, req_txt,
                    (px + pad, cy + int(12 * scale)),
                    FONT, 0.40 * scale, (160, 175, 200), max(1, int(scale)), cv2.LINE_AA)
        cv2.putText(frame, live_txt,
                    (px + pad + rw, cy + int(12 * scale)),
                    FONT, 0.40 * scale, live_color, max(1, int(scale)), cv2.LINE_AA)
        cy += int(18 * scale)

        # Active / Idle pills
        self._blend_rect(frame, px + pad, cy, px + pad + int(100 * scale), cy + int(18 * scale),
                         (20, 65, 30), alpha=0.80)
        cv2.putText(frame, f"  {active}  ACTIVE",
                    (px + pad + int(4 * scale), cy + int(13 * scale)),
                    FONT, 0.42 * scale, (60, 220, 90), max(1, int(scale)), cv2.LINE_AA)
        idle_px = px + pad + int(108 * scale)
        self._blend_rect(frame, idle_px, cy, idle_px + int(80 * scale), cy + int(18 * scale),
                         (10, 55, 90), alpha=0.80)
        cv2.putText(frame, f"  {idle_cnt}  IDLE",
                    (idle_px + int(4 * scale), cy + int(13 * scale)),
                    FONT, 0.42 * scale, (30, 170, 255), max(1, int(scale)), cv2.LINE_AA)
        cy += int(26 * scale)

        if entering > 0:
            cv2.putText(frame, f"  {entering} entering",
                        (px + pad, cy + int(12 * scale)),
                        FONT, 0.40 * scale, (160, 120, 60), max(1, int(scale)), cv2.LINE_AA)
            cy += int(18 * scale)

        # Utilization bar
        cv2.putText(frame, "UTILIZATION",
                    (px + pad, cy + int(12 * scale)),
                    FONT, 0.40 * scale, (140, 155, 175), max(1, int(scale)), cv2.LINE_AA)
        util_str = f"{util}%"
        (utw, _), _ = cv2.getTextSize(util_str, FONTB, 0.50 * scale, 1)
        cv2.putText(frame, util_str,
                    (px + panel_w - pad - utw, cy + int(12 * scale)),
                    FONTB, 0.50 * scale, (220, 230, 245), max(1, int(scale)), cv2.LINE_AA)
        cy += int(16 * scale)

        bar_x1 = px + pad
        bar_x2 = px + panel_w - pad
        bar_y1 = cy
        bar_y2 = cy + int(8 * scale)
        self._blend_rect(frame, bar_x1, bar_y1, bar_x2, bar_y2, (35, 45, 60), alpha=0.95)
        fill_w = int((bar_x2 - bar_x1) * max(0, min(util, 100)) / 100)
        if fill_w > 1:
            bar_color = (
                (50, 210, 80)  if util >= 70 else
                (20, 180, 255) if util >= 40 else
                (40, 80,  220)
            )
            self._blend_rect(frame, bar_x1, bar_y1, bar_x1 + fill_w, bar_y2,
                             bar_color, alpha=0.95)
        cy += int(16 * scale)

        # Zone status badge
        status_color = (
            (50, 210, 80)  if z_status == "BALANCED"     else
            (20, 190, 255) if z_status == "UNDERSTAFFED" else
            (40,  60, 230)
        )
        status_bg = (
            (15, 55, 20)  if z_status == "BALANCED"     else
            (10, 60, 80)  if z_status == "UNDERSTAFFED" else
            (15, 20, 85)
        )
        (bw, bh), _ = cv2.getTextSize(z_status, FONT, 0.44 * scale, 1)
        bpad = int(8 * scale)
        self._blend_rect(frame, px + pad, cy, px + pad + bw + bpad * 2,
                         cy + bh + bpad, status_bg, alpha=0.85)
        self._draw_rounded_rect(frame, px + pad, cy,
                                px + pad + bw + bpad * 2, cy + bh + bpad,
                                status_color, 1, radius=4)
        cv2.putText(frame, z_status,
                    (px + pad + bpad, cy + bh + int(2 * scale)),
                    FONT, 0.44 * scale, status_color, max(1, int(scale)), cv2.LINE_AA)
        cy += bh + bpad + int(6 * scale)

        # ── Micro trend forecast (sparkline slope) ────────────────────────────
        if len(sparkline) >= 6:
            half       = len(sparkline) // 2
            first_avg  = sum(sparkline[:half]) / half
            second_avg = sum(sparkline[half:]) / max(len(sparkline) - half, 1)
            slope      = second_avg - first_avg
            if slope > 1.0:
                trend_txt   = "^ Trend: Rising"
                trend_color = (50, 210, 80)
            elif slope < -1.0:
                trend_txt   = "v Trend: Declining"
                trend_color = (40, 80, 220)
            else:
                trend_txt   = "- Trend: Stable"
                trend_color = (120, 150, 190)
            cv2.putText(frame, trend_txt,
                        (px + pad, cy + int(12 * scale)),
                        FONT, 0.38 * scale, trend_color, max(1, int(scale)), cv2.LINE_AA)
            cy += int(16 * scale)

        # Sparkline
        if len(sparkline) >= 2 and cy + int(22 * scale) < py + panel_h - int(6 * scale):
            sp_x1 = px + pad
            sp_x2 = px + panel_w - pad
            sp_y2 = py + panel_h - int(8 * scale)
            sp_y1 = sp_y2 - int(18 * scale)
            sp_h  = sp_y2 - sp_y1
            sp_w  = sp_x2 - sp_x1
            max_v = max(max(sparkline), 1)
            pts   = []
            for i, v in enumerate(sparkline):
                sx = sp_x1 + int(i / max(len(sparkline) - 1, 1) * sp_w)
                sy = sp_y2 - int(v / max_v * sp_h)
                pts.append((sx, sy))
            if len(pts) >= 2:
                fill_pts = [pts[0]] + pts + [(pts[-1][0], sp_y2), (pts[0][0], sp_y2)]
                cv2.fillPoly(frame, [np.array(fill_pts, dtype=np.int32)], (30, 60, 100))
            for i in range(1, len(pts)):
                cv2.line(frame, pts[i - 1], pts[i], (80, 160, 255), max(1, int(scale)))

    # ── Zone stability banner (bottom of frame) ───────────────────────────────

    def _draw_stability_banner(self, frame: np.ndarray, m: dict, H: int, W: int,
                               FONT, FONTB, scale: float) -> None:
        """Draw one smart executive banner at the bottom of the stream."""
        total      = m.get("current_worker_count", 0)
        z_status   = m.get("zone_status", "BALANCED")
        idle_ratio = m.get("idle_ratio", 0.0)
        now        = time.time()

        if now < self._sudden_drop_active_until:
            banner_txt   = "! Worker Drop Detected"
            banner_bg    = (20, 30, 130)
            accent_color = (80, 100, 255)
        elif total == 0:
            banner_txt   = "No Workers Detected"
            banner_bg    = (30, 35, 45)
            accent_color = (100, 110, 130)
        elif z_status == "UNDERSTAFFED":
            banner_txt   = "Zone Understaffed"
            banner_bg    = (10, 70, 140)
            accent_color = (20, 150, 255)
        elif idle_ratio > 0.60:
            banner_txt   = "Idle Concentration High"
            banner_bg    = (10, 65, 110)
            accent_color = (30, 160, 230)
        elif z_status == "OVERLOADED":
            banner_txt   = "Zone Congestion Risk"
            banner_bg    = (20, 25, 120)
            accent_color = (60, 80, 240)
        else:
            banner_txt   = "Stable Workforce"
            banner_bg    = (15, 50, 22)
            accent_color = (50, 210, 80)

        banner_h = int(32 * scale)
        by1      = H - banner_h

        self._blend_rect(frame, 0, by1, W, H, banner_bg, alpha=0.82)
        # Left accent stripe
        self._blend_rect(frame, 0, by1, max(4, int(5 * scale)), H, accent_color, alpha=0.95)

        (tw, th), _ = cv2.getTextSize(banner_txt, FONTB, 0.50 * scale, max(1, int(scale)))
        tx = (W - tw) // 2
        ty = by1 + (banner_h + th) // 2
        cv2.putText(frame, banner_txt, (tx, ty),
                    FONTB, 0.50 * scale, accent_color, max(1, int(scale)), cv2.LINE_AA)

    # ── Recommendation chip (bottom-left, above stability banner) ─────────────

    def _draw_recommendation_chip(self, frame: np.ndarray, H: int, W: int,
                                  FONT, scale: float) -> None:
        """Draw a small enterprise recommendation chip above the stability banner."""
        chip_txt  = self._last_recommendation_chip
        banner_h  = int(32 * scale)
        chip_pad  = int(8 * scale)
        margin    = int(10 * scale)

        (cw, ch), _ = cv2.getTextSize(chip_txt, FONT, 0.42 * scale, 1)
        chip_w = cw + chip_pad * 2
        chip_h = ch + chip_pad + int(4 * scale)
        cx1    = margin
        cx2    = margin + chip_w
        cy1    = H - banner_h - chip_h - int(8 * scale)
        cy2    = H - banner_h - int(8 * scale)

        if "Healthy" in chip_txt:
            chip_bg    = (15, 55, 25)
            chip_color = (50, 210, 80)
        elif "Add" in chip_txt:
            chip_bg    = (10, 55, 120)
            chip_color = (20, 170, 255)
        elif "Rebalance" in chip_txt:
            chip_bg    = (15, 20, 85)
            chip_color = (80, 100, 240)
        else:   # Monitor idle
            chip_bg    = (10, 60, 80)
            chip_color = (20, 190, 220)

        self._blend_rect(frame, cx1, cy1, cx2, cy2, chip_bg, alpha=0.88)
        self._draw_rounded_rect(frame, cx1, cy1, cx2, cy2, chip_color, 1, radius=5)
        cv2.putText(frame, chip_txt,
                    (cx1 + chip_pad, cy2 - chip_pad + int(2 * scale)),
                    FONT, 0.42 * scale, chip_color, max(1, int(scale)), cv2.LINE_AA)
