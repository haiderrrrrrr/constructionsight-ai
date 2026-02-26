"""
Equipment Analytics Engine — EquipmentTrack state machine + EquipmentProcessor.

Architecture:
  - EquipmentProcessor reads from _equipment_detection_inbox (posted by Grounding DINO
    inferencer running in a thread pool alongside the main detection loop).
  - Draws premium overlays onto a copy of the raw frame → _equipment_annotated[camera_id].
  - Computes per-camera metrics every 30 inbox reads.
  - Checks 5 fraud/misuse thresholds, enqueues snapshots/alerts via equipment_event_queue.
  - Pushes SSE stats to equipment_dashboard_broker.
"""

from __future__ import annotations

import logging
import math
import threading
import time
from collections import deque
from typing import Dict, List, Optional

import cv2
import numpy as np

logger = logging.getLogger(__name__)

# ── Equipment states ──────────────────────────────────────────────────────────
ES_ENTERING = "ENTERING"
ES_ACTIVE   = "ACTIVE"
ES_IDLE     = "IDLE"
ES_EXITED   = "EXITED"

# Per-class movement thresholds (px/frame avg displacement).
# Cranes move very slowly; excavators and trucks move more.
CLASS_MOVEMENT_THRESH: Dict[str, float] = {
    "crane":       1.5,
    "scaffolding": 0.8,   # almost never moves
    "excavator":   4.0,
    "bulldozer":   4.0,
    "compactor":   3.5,
    "forklift":    3.0,
    "concrete_truck": 3.5,
    "dump_truck":  3.5,
    "default":     3.0,
}

# ── Module-level processor registry ──────────────────────────────────────────
_processors: Dict[int, "EquipmentProcessor"] = {}
_processors_lock = threading.Lock()


def get_processor(camera_id: int) -> Optional["EquipmentProcessor"]:
    with _processors_lock:
        return _processors.get(camera_id)


def register_processor(camera_id: int, processor: "EquipmentProcessor") -> None:
    with _processors_lock:
        _processors[camera_id] = processor


def unregister_processor(camera_id: int) -> None:
    with _processors_lock:
        _processors.pop(camera_id, None)


def get_all_processors() -> Dict[int, "EquipmentProcessor"]:
    with _processors_lock:
        return dict(_processors)


# ─────────────────────────────────────────────────────────────────────────────
# EquipmentTrack — per-machine state machine
# ─────────────────────────────────────────────────────────────────────────────

class EquipmentTrack:
    """Tracks a single piece of equipment (one ByteTrack ID) with state machine."""

    __slots__ = (
        "track_id", "logical_id", "equip_type", "first_seen_at", "last_seen_at",
        "frames_seen", "frames_lost", "last_positions", "active_duration_secs",
        "idle_duration_secs", "movement_score", "equip_state", "idle_since",
        "active_since", "active_sessions", "x1", "y1", "x2", "y2",
    )

    def __init__(self, track_id: int, logical_id: int, equip_type: str = "unknown"):
        self.track_id              = track_id
        self.logical_id            = logical_id
        self.equip_type            = equip_type.lower().replace(" ", "_")
        self.first_seen_at         = time.time()
        self.last_seen_at          = time.time()
        self.frames_seen           = 0
        self.frames_lost           = 0
        self.last_positions: deque = deque(maxlen=20)
        self.active_duration_secs  = 0.0
        self.idle_duration_secs    = 0.0
        self.movement_score        = 0.0
        self.equip_state           = ES_ENTERING
        self.idle_since: Optional[float]   = None
        self.active_since: Optional[float] = None
        # Usage segmentation: list of {start, end, type: "ACTIVE"|"IDLE"}
        self.active_sessions: List[dict]   = []
        self.x1 = self.y1 = self.x2 = self.y2 = 0

    def update(self, x1: int, y1: int, x2: int, y2: int, cfg: dict) -> None:
        """Update position, durations, movement score and state machine."""
        now = time.time()
        cx  = (x1 + x2) / 2.0
        cy  = (y1 + y2) / 2.0

        self.x1 = x1; self.y1 = y1; self.x2 = x2; self.y2 = y2
        self.last_positions.append((cx, cy))
        self.last_seen_at  = now
        self.frames_seen  += 1
        self.frames_lost   = 0

        # Compute movement score (avg frame-to-frame displacement, last 20 positions)
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

        confirm_frames = cfg.get("equipment_confirm_frames", 8)
        idle_confirm   = cfg.get("equipment_idle_confirm_secs", 30)
        # Per-class threshold, fallback to config default
        global_thresh  = cfg.get("equipment_movement_thresh", 3.0)
        move_thresh    = CLASS_MOVEMENT_THRESH.get(self.equip_type, global_thresh)
        # Reactivation threshold — needs more movement to break IDLE (prevents jitter)
        reactivation_thresh = move_thresh * 2.0

        if self.frames_seen < confirm_frames:
            self.equip_state = ES_ENTERING
            return

        if self.equip_state == ES_ENTERING:
            new_state = ES_ACTIVE if self.movement_score > move_thresh else ES_IDLE
            self._on_state_transition(self.equip_state, new_state, now)
            self.equip_state = new_state
            return

        prev_state = self.equip_state
        if self.equip_state == ES_IDLE:
            if self.movement_score > reactivation_thresh:
                self._on_state_transition(ES_IDLE, ES_ACTIVE, now)
                self.equip_state = ES_ACTIVE
        elif self.movement_score > move_thresh:
            if self.equip_state != ES_ACTIVE:
                self._on_state_transition(prev_state, ES_ACTIVE, now)
                self.equip_state = ES_ACTIVE
        else:
            if self.equip_state == ES_ACTIVE:
                if self.idle_since is None:
                    self.idle_since = now
                if (now - self.idle_since) >= idle_confirm:
                    self._on_state_transition(ES_ACTIVE, ES_IDLE, now)
                    self.equip_state = ES_IDLE

        # Update running durations
        if self.equip_state == ES_ACTIVE and self.active_since:
            self.active_duration_secs = now - self.active_since
        if self.equip_state == ES_IDLE and self.idle_since:
            self.idle_duration_secs = now - self.idle_since

    def _on_state_transition(self, old: str, new: str, now: float) -> None:
        """Record usage session boundaries on state transitions."""
        if old == ES_ENTERING and new == ES_ACTIVE:
            self.active_since = now
            self.idle_since   = None
        elif old == ES_ENTERING and new == ES_IDLE:
            self.idle_since   = now
            self.active_since = None
        elif old == ES_ACTIVE and new == ES_IDLE:
            if self.active_since:
                self.active_sessions.append({
                    "start": self.active_since, "end": now, "type": "ACTIVE"
                })
                if len(self.active_sessions) > 50:
                    self.active_sessions = self.active_sessions[-50:]
            self.idle_since   = now
            self.active_since = None
        elif old == ES_IDLE and new == ES_ACTIVE:
            if self.idle_since:
                self.active_sessions.append({
                    "start": self.idle_since, "end": now, "type": "IDLE"
                })
                if len(self.active_sessions) > 50:
                    self.active_sessions = self.active_sessions[-50:]
            self.active_since = now
            self.idle_since   = None

    def mark_lost(self) -> None:
        self.frames_lost += 1


# ─────────────────────────────────────────────────────────────────────────────
# EquipmentProcessor — consumer thread + overlays + metrics + alerts
# ─────────────────────────────────────────────────────────────────────────────

class EquipmentProcessor:
    """
    Per-camera equipment analytics processor.
    Reads from _equipment_detection_inbox, applies EquipmentTrack state machines,
    computes metrics, draws overlays, pushes SSE stats, checks 5 fraud/misuse rules.
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
        self._tracks: Dict[int, EquipmentTrack] = {}
        self._next_logical_id = 1

        # Reconciliation buffer
        self._recently_exited: Dict[int, dict] = {}

        # Metrics
        self._metrics: dict = {}
        self._metrics_lock = threading.Lock()
        self._metrics_frame_count = 0

        # Session peaks
        self._peak_active_count = 0
        self._peak_total_count  = 0

        # Sparkline (last 20 active counts)
        self._sparkline: deque = deque(maxlen=20)

        # Alert tracking
        self._last_alert_times: Dict[str, float] = {}
        self._idle_since_per_track: Dict[int, float] = {}
        self._overuse_alerted: set = set()

        # Snapshot tracking
        self._last_snapshot_time = 0.0
        self._prev_zone_status   = "BALANCED"

        # Count smoothing — rolling window of last 5 raw counts for median filter
        self._count_history: deque = deque(maxlen=5)

        # Recommendation chip
        self._last_recommendation_chip: str = "v Zone Normal"

        # Heatmap / motion trail (same as workforce)
        self._heatmap: Optional[np.ndarray] = None
        self._heatmap_H = 0
        self._heatmap_W = 0
        self._heatmap_scale       = 4
        self._heatmap_frame_skip  = 0
        self._heatmap_render_skip = 0
        self._cached_heatmap_blend: Optional[np.ndarray] = None

        # Density pulse
        self._pulse_center: Optional[tuple] = None
        self._pulse_radius  = 0
        self._pulse_alpha   = 0.0
        self._pulse_frame_counter = 0

        # Misuse alert banner flag (active for 60s after alert fires)
        self._misuse_banner_until = 0.0

    # ── Public API ────────────────────────────────────────────────────────────

    def start(self, cfg: dict) -> None:
        self._cfg = cfg
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._consumer_loop,
            daemon=True,
            name=f"eq-consumer-{self.camera_id}",
        )
        self._thread.start()
        logger.info(f"[EquipmentProcessor] Camera {self.camera_id} started")

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2.0)
        logger.info(f"[EquipmentProcessor] Camera {self.camera_id} stopped")

    def is_running(self) -> bool:
        return not self._stop.is_set()

    def update_config(self, cfg: dict) -> None:
        self._cfg = cfg

    def get_latest_metrics(self) -> dict:
        with self._metrics_lock:
            return dict(self._metrics)

    @property
    def last_active_count(self) -> int:
        with self._metrics_lock:
            return self._metrics.get("active_count", 0)

    # ── Consumer loop ─────────────────────────────────────────────────────────

    def _consumer_loop(self) -> None:
        from ..api.routes.ml_stream_enterprise import (
            _equipment_detection_inbox,
            _equipment_inbox_locks,
            _equipment_annotated,
        )
        last_seq = -1

        while not self._stop.is_set():
            lock_key = self.camera_id
            if lock_key not in _equipment_inbox_locks:
                time.sleep(0.02)
                continue

            inbox_lock = _equipment_inbox_locks[lock_key]
            with inbox_lock:
                inbox = _equipment_detection_inbox.get(self.camera_id)

            if inbox is None or inbox["seq"] == last_seq:
                time.sleep(0.005)
                continue

            last_seq   = inbox["seq"]
            detections = inbox["detections"]
            frame      = inbox.get("frame")
            if frame is None:
                continue

            frame = frame.copy()
            H, W  = frame.shape[:2]

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
                    equip_type = det.get("label", "unknown")
                    cx         = det.get("cx", (det.get("x1", 0) + det.get("x2", 0)) / 2)
                    cy         = det.get("cy", (det.get("y1", 0) + det.get("y2", 0)) / 2)
                    logical_id = self._reconcile_or_new(cx, cy, equip_type, cfg)
                    self._tracks[tid] = EquipmentTrack(tid, logical_id, equip_type)
                self._tracks[tid].update(det["x1"], det["y1"], det["x2"], det["y2"], cfg)

            # Mark lost tracks
            lost_frames_thresh = cfg.get("equipment_lost_frames", 25)
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
                            "last_cx":    lx,
                            "last_cy":    ly,
                            "exited_at":  time.time(),
                            "logical_id": track.logical_id,
                            "equip_type": track.equip_type,
                        }
                        to_remove.append(tid)

            for tid in to_remove:
                del self._tracks[tid]

            # Expire old reconciliation entries
            rec_window = cfg.get("equipment_reconcile_window_secs", 4)
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
                self._sparkline.append(_metrics_this_frame["active_count"])
                self._push_sse(_metrics_this_frame)
                self._maybe_enqueue_snapshot(_metrics_this_frame, cfg, trigger="interval")
                _fire_alerts_this_frame = True

            self._update_heatmap(cfg)
            annotated_frame = self._draw_overlays(frame, cfg)

            if _fire_alerts_this_frame:
                self._check_and_fire_alerts(_metrics_this_frame, cfg, annotated_frame)

            # Write to annotated dict
            if self.camera_id not in _equipment_annotated:
                _equipment_annotated[self.camera_id] = {
                    "frame": None, "seq": 0, "lock": threading.Lock()
                }
            ann = _equipment_annotated[self.camera_id]
            with ann["lock"]:
                ann["frame"] = annotated_frame
                ann["seq"]   = last_seq

    # ── Reconciliation ────────────────────────────────────────────────────────

    def _reconcile_or_new(self, cx: float, cy: float, equip_type: str, cfg: dict) -> int:
        """Return existing logical_id if a recent exit matches (same type + position), else new."""
        dist_thresh = cfg.get("equipment_reconcile_distance_px", 150)
        window      = cfg.get("equipment_reconcile_window_secs", 4)
        now         = time.time()
        best_key    = None
        best_score  = float("inf")

        for k, rec in self._recently_exited.items():
            if now - rec["exited_at"] > window:
                continue
            if rec.get("equip_type") != equip_type.lower().replace(" ", "_"):
                continue  # different class — definitely different machine
            pos_dist = math.sqrt((cx - rec["last_cx"])**2 + (cy - rec["last_cy"])**2)
            if pos_dist < dist_thresh and pos_dist < best_score:
                best_score = pos_dist
                best_key   = k

        if best_key is not None:
            rec        = self._recently_exited.pop(best_key)
            logical_id = rec["logical_id"]
            logger.debug(
                f"[EQ reconcile] Camera {self.camera_id} → logical {logical_id} "
                f"type={equip_type} (dist={best_score:.1f})"
            )
            return logical_id

        lid = self._next_logical_id
        self._next_logical_id += 1
        return lid

    # ── Metrics ───────────────────────────────────────────────────────────────

    def _compute_metrics(self, cfg: dict) -> dict:
        min_stable = cfg.get("equipment_lost_frames", 20)
        confirmed  = [t for t in self._tracks.values()
                      if t.equip_state in (ES_ACTIVE, ES_IDLE)
                      and t.frames_seen >= min_stable]
        entering   = [t for t in self._tracks.values() if t.equip_state == ES_ENTERING]
        raw_total  = len(confirmed)

        # Median smoothing over last 5 readings (same as workforce)
        self._count_history.append(raw_total)
        counts = sorted(self._count_history)
        total  = counts[len(counts) // 2]

        active_count = len([t for t in confirmed if t.equip_state == ES_ACTIVE])
        idle_count   = len([t for t in confirmed if t.equip_state == ES_IDLE])
        active_ratio = active_count / total if total > 0 else 0.0
        idle_ratio   = idle_count   / total if total > 0 else 0.0

        # Average active duration across active machines
        avg_active_duration = (
            sum(t.active_duration_secs for t in confirmed if t.equip_state == ES_ACTIVE)
            / max(active_count, 1)
        ) if active_count > 0 else 0.0

        # Utilization score (same formula as workforce, same weights)
        expected = cfg.get("expected_equipment_count", 2)
        max_equip = cfg.get("max_equipment_count", 10)
        presence_score  = min(total / max(expected, 1), 1.0) * 40
        active_score    = active_ratio * 40
        idle_penalty    = idle_ratio   * 15
        overloaded_pen  = 5 if total > max_equip else 0
        utilization_score = int(max(0, min(100, round(
            presence_score + active_score - idle_penalty - overloaded_pen
        ))))

        zone_status = (
            "UNDERUTILIZED" if total < expected else
            "OVERLOADED"    if total > max_equip else
            "BALANCED"
        )

        # Cross-zone conflict: same equip_type in >=2 zones simultaneously
        # (within this camera's track list — cross-camera handled by alert check)
        type_zones: Dict[str, set] = {}
        for t in confirmed:
            type_zones.setdefault(t.equip_type, set()).add(self.zone_name)
        cross_zone_conflicts = sum(1 for zones in type_zones.values() if len(zones) > 1)

        # Misuse flags snapshot (informational, not alert fire)
        misuse_flags = []
        idle_alert_thresh = cfg.get("equipment_idle_alert_threshold_minutes", 30) * 60
        for t in confirmed:
            if t.equip_state == ES_IDLE and t.idle_duration_secs > idle_alert_thresh:
                misuse_flags.append({
                    "type":       "idle_waste",
                    "track_id":   t.track_id,
                    "equip_type": t.equip_type,
                    "idle_secs":  int(t.idle_duration_secs),
                })

        if total > self._peak_total_count:
            self._peak_total_count = total
        if active_count > self._peak_active_count:
            self._peak_active_count = active_count

        return {
            "camera_id":          self.camera_id,
            "project_id":         self.project_id,
            "zone_id":            self.zone_id,
            "zone_name":          self.zone_name,
            "active_count":       active_count,
            "idle_count":         idle_count,
            "total_count":        total,
            "entering_count":     len(entering),
            "active_ratio":       round(active_ratio, 3),
            "idle_ratio":         round(idle_ratio, 3),
            "avg_active_duration":round(avg_active_duration, 1),
            "utilization_score":  utilization_score,
            "zone_status":        zone_status,
            "cross_zone_conflicts": cross_zone_conflicts,
            "misuse_flags":       misuse_flags,
            "peak_active_count":  self._peak_active_count,
            "peak_total_count":   self._peak_total_count,
            "sparkline":          list(self._sparkline),
            "timestamp":          time.time(),
        }

    # ── SSE push ──────────────────────────────────────────────────────────────

    def _push_sse(self, metrics: dict) -> None:
        try:
            from . import equipment_dashboard_broker as broker
            from datetime import datetime, timezone
            import json
            payload = {
                "type":                 "equipment_stats_update",
                "camera_id":            metrics["camera_id"],
                "zone_name":            metrics["zone_name"],
                "active_count":         metrics["active_count"],
                "idle_count":           metrics["idle_count"],
                "total_count":          metrics["total_count"],
                "entering_count":       metrics["entering_count"],
                "active_ratio":         metrics["active_ratio"],
                "idle_ratio":           metrics["idle_ratio"],
                "avg_active_duration":  metrics["avg_active_duration"],
                "utilization_score":    metrics["utilization_score"],
                "zone_status":          metrics["zone_status"],
                "cross_zone_conflicts": metrics["cross_zone_conflicts"],
                "misuse_flags":         metrics["misuse_flags"],
                "sparkline":            metrics["sparkline"],
                "timestamp":            datetime.now(timezone.utc).isoformat(),
            }
            broker.push(self.project_id, payload)
        except Exception as e:
            logger.debug(f"[EquipmentProcessor] SSE push error: {e}")

    # ── Alerts ────────────────────────────────────────────────────────────────

    def _check_and_fire_alerts(self, metrics: dict, cfg: dict, frame=None) -> None:
        now = time.time()
        _SENSITIVITY_COOLDOWN = {"low": 1200, "medium": 600, "high": 300, "ultra_high": 0}
        sensitivity   = cfg.get("alert_sensitivity", "medium")
        cooldown      = _SENSITIVITY_COOLDOWN.get(sensitivity, cfg.get("equipment_alert_cooldown_secs", 600))
        idle_thresh   = cfg.get("equipment_idle_alert_threshold_minutes", 30) * 60
        overuse_thresh= cfg.get("equipment_overuse_threshold_hours", 8.0) * 3600
        min_workers   = cfg.get("equipment_min_workers_alongside", 2)

        confirmed = [t for t in self._tracks.values() if t.equip_state in (ES_ACTIVE, ES_IDLE)]

        # ── Rule 1: Idle Waste ─────────────────────────────────────────────────
        for track in confirmed:
            if track.equip_state == ES_IDLE and track.idle_duration_secs > idle_thresh:
                alert_key = f"idle_waste_{track.track_id}"
                last = self._last_alert_times.get(alert_key, 0)
                if now - last >= cooldown:
                    idle_min = int(track.idle_duration_secs / 60)
                    self._fire_alert(
                        "idle_waste", metrics,
                        f"{track.equip_type.upper()}-{track.logical_id:02d} in '{self.zone_name}' "
                        f"idle for {idle_min} min — equipment waste",
                        "medium", alert_key, now, frame,
                        equip_type=track.equip_type, track_id=track.track_id,
                    )

        # ── Rule 2: Active Without Workers ────────────────────────────────────
        # Cross-feature: check workforce processor for this camera
        active_tracks = [t for t in confirmed if t.equip_state == ES_ACTIVE]
        if active_tracks:
            try:
                from . import workforce_analytics as wa
                wf_proc = wa.get_processor(self.camera_id)
                worker_count = wf_proc.get_latest_metrics().get("current_worker_count", min_workers + 1) if wf_proc else (min_workers + 1)
            except Exception:
                worker_count = min_workers + 1  # assume workers present if we can't check

            if worker_count < min_workers:
                alert_key = f"active_no_workers_{self.camera_id}"
                last = self._last_alert_times.get(alert_key, 0)
                if now - last >= cooldown:
                    self._fire_alert(
                        "active_no_workers", metrics,
                        f"{len(active_tracks)} equipment active in '{self.zone_name}' but only "
                        f"{worker_count} workers detected (minimum: {min_workers})",
                        "high", alert_key, now, frame,
                    )

        # ── Rule 3: Ghost Equipment ────────────────────────────────────────────
        # Present > 10 frames, movement < 0.5px, near-zero workers
        for track in confirmed:
            if (track.frames_seen > 10
                    and track.movement_score < 0.5
                    and track.equip_state != ES_EXITED):
                alert_key = f"ghost_{track.track_id}"
                last = self._last_alert_times.get(alert_key, 0)
                if now - last >= cooldown * 2:  # longer cooldown for ghost (noisy rule)
                    self._fire_alert(
                        "ghost_equipment", metrics,
                        f"Possible ghost detection: {track.equip_type} track {track.logical_id:02d} "
                        f"in '{self.zone_name}' — no motion detected",
                        "low", alert_key, now, frame,
                        equip_type=track.equip_type, track_id=track.track_id,
                    )

        # ── Rule 4: Overuse ───────────────────────────────────────────────────
        for track in confirmed:
            if track.active_duration_secs > overuse_thresh:
                alert_key = f"overuse_{track.track_id}"
                last = self._last_alert_times.get(alert_key, 0)
                if now - last >= cooldown:
                    hrs = track.active_duration_secs / 3600
                    self._fire_alert(
                        "overuse", metrics,
                        f"{track.equip_type.upper()}-{track.logical_id:02d} active for "
                        f"{hrs:.1f}h — maintenance risk",
                        "medium", alert_key, now, frame,
                        equip_type=track.equip_type, track_id=track.track_id,
                    )

        # ── Rule 5: Cross-Zone Conflict ────────────────────────────────────────
        # Same equip_type in >=2 processor zones simultaneously
        if metrics.get("cross_zone_conflicts", 0) > 0:
            alert_key = f"cross_zone_{self.camera_id}"
            last = self._last_alert_times.get(alert_key, 0)
            if now - last >= cooldown:
                self._fire_alert(
                    "cross_zone_conflict", metrics,
                    f"Same equipment type detected in multiple zones simultaneously "
                    f"— possible mis-tracking in '{self.zone_name}'",
                    "high", alert_key, now, frame,
                )

        # ── Update recommendation chip ─────────────────────────────────────────
        z_status   = metrics["zone_status"]
        idle_ratio = metrics["idle_ratio"]
        if z_status == "UNDERUTILIZED":
            self._last_recommendation_chip = "- Equipment Underutilized"
        elif z_status == "OVERLOADED":
            self._last_recommendation_chip = "! Equipment Overloaded"
        elif idle_ratio > 0.60:
            self._last_recommendation_chip = "~ High Idle Ratio"
        else:
            self._last_recommendation_chip = "v Zone Normal"

    def _fire_alert(self, alert_type: str, metrics: dict, message: str,
                    severity: str, cooldown_key: str, now: float, frame=None,
                    equip_type: str = None, track_id: int = None) -> None:
        self._last_alert_times[cooldown_key] = now
        logger.info(f"[EquipmentProcessor] Alert {alert_type}: {message}")
        self._misuse_banner_until = now + 60.0

        try:
            from . import equipment_event_queue as eq
            eq.try_enqueue({
                "kind":           "alert",
                "project_id":     self.project_id,
                "camera_id":      self.camera_id,
                "zone_id":        self.zone_id,
                "zone_name":      self.zone_name,
                "alert_type":     alert_type,
                "severity":       severity,
                "message":        message,
                "equipment_type": equip_type,
                "track_id":       track_id,
                "snapshot_frame": frame.copy() if frame is not None else None,
            })
        except Exception as e:
            logger.debug(f"[EquipmentProcessor] alert enqueue error: {e}")

    # ── Snapshot persistence ──────────────────────────────────────────────────

    def _maybe_enqueue_snapshot(self, metrics: dict, cfg: dict, trigger: str = "interval") -> None:
        now             = time.time()
        interval        = cfg.get("equipment_snapshot_interval_secs", 60)
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
        import json
        try:
            from . import equipment_event_queue as eq
            eq.try_enqueue({
                "kind":               "snapshot",
                "project_id":         self.project_id,
                "camera_id":          self.camera_id,
                "zone_id":            self.zone_id,
                "zone_name":          self.zone_name,
                "active_count":       metrics["active_count"],
                "idle_count":         metrics["idle_count"],
                "total_count":        metrics["total_count"],
                "utilization_score":  metrics["utilization_score"],
                "idle_ratio":         metrics["idle_ratio"],
                "avg_active_duration":metrics["avg_active_duration"],
                "zone_status":        metrics["zone_status"],
                "cross_zone_conflicts": metrics["cross_zone_conflicts"],
                "misuse_flags_json":  json.dumps(metrics.get("misuse_flags", [])),
                "sparkline_json":     json.dumps(metrics["sparkline"]),
                "trigger":            trigger,
            })
        except Exception as e:
            logger.debug(f"[EquipmentProcessor] snapshot enqueue error: {e}")

    # ── Heatmap update (1/4 resolution for performance) ───────────────────────

    def _update_heatmap(self, cfg: dict) -> None:
        if self._heatmap is None:
            return
        self._heatmap_frame_skip += 1
        if self._heatmap_frame_skip % 4 != 0:
            return
        sc   = self._heatmap_scale
        hm_H = self._heatmap.shape[0]
        hm_W = self._heatmap.shape[1]
        self._heatmap *= 0.97
        for track in self._tracks.values():
            if track.equip_state not in (ES_ACTIVE, ES_IDLE):
                continue
            if not track.last_positions:
                continue
            cx, cy = track.last_positions[-1]
            cx_hm = int(cx / sc)
            cy_hm = int(cy / sc)
            if 0 <= cx_hm < hm_W and 0 <= cy_hm < hm_H:
                # Equipment is large — bigger radius than workers
                cv2.circle(self._heatmap, (cx_hm, cy_hm), 20, 0.5, -1)
        mx = self._heatmap.max()
        if mx > 0:
            self._heatmap /= mx

    # ── Drawing helpers (identical to WorkforceProcessor) ─────────────────────

    @staticmethod
    def _blend_rect(frame: np.ndarray, x1: int, y1: int, x2: int, y2: int,
                    color_bgr: tuple, alpha: float) -> None:
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

        # ── 1. Heatmap ────────────────────────────────────────────────────────
        self._heatmap_render_skip += 1
        if self._heatmap is not None and self._heatmap.max() > 0.01:
            if self._heatmap_render_skip >= 3 or self._cached_heatmap_blend is None:
                try:
                    hm_u8  = (self._heatmap * 255).astype(np.uint8)
                    hm_u8  = cv2.resize(hm_u8, (W, H), interpolation=cv2.INTER_LINEAR)
                    hm_col = cv2.applyColorMap(hm_u8, cv2.COLORMAP_JET)
                    hm_col[hm_u8 <= 15] = 0
                    self._cached_heatmap_blend = hm_col
                    self._heatmap_render_skip  = 0
                except Exception:
                    self._cached_heatmap_blend = None
            if self._cached_heatmap_blend is not None:
                try:
                    cv2.addWeighted(frame, 1.0, self._cached_heatmap_blend, 0.28, 0, frame)
                except Exception:
                    pass
        else:
            self._cached_heatmap_blend = None

        # ── 2. Equipment glow blobs ───────────────────────────────────────────
        confirmed_tracks = [
            t for t in self._tracks.values()
            if t.equip_state in (ES_ACTIVE, ES_IDLE) and t.last_positions
        ]
        if confirmed_tracks:
            glow_ov = frame.copy()
            blob_r  = max(30, int(45 * scale))   # equipment is larger than workers
            aura_r  = max(40, int(55 * scale))
            for track in confirmed_tracks:
                cx     = int((track.x1 + track.x2) / 2)
                cy     = int((track.y1 + track.y2) / 2)
                foot_y = min(track.y2 + 6, H - 1)
                if track.equip_state == ES_ACTIVE:
                    blob_color = (40, 180, 70)    # green
                    aura_color = (50, 210, 80)
                else:
                    blob_color = (10, 120, 200)   # orange-blue for IDLE
                    aura_color = (15, 140, 220)
                cv2.circle(glow_ov, (cx, cy), blob_r, blob_color, -1)
                cv2.circle(glow_ov, (cx, foot_y), aura_r + 14, aura_color, -1)
                cv2.circle(glow_ov, (cx, foot_y), aura_r,      aura_color, -1)
            cv2.addWeighted(glow_ov, 0.14, frame, 0.86, 0, frame)

        # ── 3. Motion trails (last 5 centroids per track) ─────────────────────
        for track in confirmed_tracks:
            positions = list(track.last_positions)
            trail_pts = positions[-5:]
            if len(trail_pts) >= 2:
                for i in range(1, len(trail_pts)):
                    alpha_f = i / len(trail_pts)
                    c = (int(80 * alpha_f), int(200 * alpha_f), int(255 * alpha_f))
                    pt1 = (int(trail_pts[i-1][0]), int(trail_pts[i-1][1]))
                    pt2 = (int(trail_pts[i][0]),   int(trail_pts[i][1]))
                    cv2.line(frame, pt1, pt2, c, max(1, int(2 * scale)))

        # ── 4. Density pulse ──────────────────────────────────────────────────
        confirmed_pos = [list(t.last_positions)[-1] for t in confirmed_tracks]
        self._pulse_frame_counter += 1
        if self._pulse_frame_counter >= 90 and confirmed_pos:
            cx_mean = sum(p[0] for p in confirmed_pos) / len(confirmed_pos)
            cy_mean = sum(p[1] for p in confirmed_pos) / len(confirmed_pos)
            self._pulse_center        = (int(cx_mean), int(cy_mean))
            self._pulse_radius        = 18
            self._pulse_alpha         = 0.85
            self._pulse_frame_counter = 0

        if self._pulse_center and self._pulse_alpha > 0:
            pulse_ov      = frame.copy()
            alpha_clamped = max(0.0, self._pulse_alpha)
            cv2.circle(pulse_ov, self._pulse_center, self._pulse_radius, (255, 200, 40), 2)
            cv2.addWeighted(pulse_ov, alpha_clamped, frame, 1 - alpha_clamped, 0, frame)
            self._pulse_radius += int(8 * scale)
            self._pulse_alpha  -= 0.055
            if self._pulse_alpha <= 0:
                self._pulse_center = None

        # ── 5. Per-equipment bounding boxes + state tags ──────────────────────
        FONT  = cv2.FONT_HERSHEY_SIMPLEX
        FONTB = cv2.FONT_HERSHEY_DUPLEX

        for track in self._tracks.values():
            if not track.last_positions:
                continue
            x1, y1, x2, y2 = track.x1, track.y1, track.x2, track.y2
            state = track.equip_state

            if state == ES_ENTERING:
                continue
            if track.frames_lost > 0:
                continue

            if state == ES_ACTIVE:
                color = (50, 210, 80)     # green
            elif state == ES_IDLE:
                color = (20, 130, 255)    # orange (BGR: blue=20, green=130, red=255 → orange in RGB)
            else:
                color = (100, 100, 100)

            bbox_thick = max(2, int(3 * scale))
            self._draw_rounded_rect(frame, x1, y1, x2, y2, color, bbox_thick, radius=6)
            bar_h = max(4, int(5 * scale))
            self._blend_rect(frame, x1 + 2, y1 + 2, x2 - 2, y1 + bar_h + 2, color, alpha=0.55)

            # IDLE glow effect — orange pulsing border
            if state == ES_IDLE:
                idle_ov = frame.copy()
                cv2.rectangle(idle_ov, (x1 - 3, y1 - 3), (x2 + 3, y2 + 3), (0, 100, 255), 3)
                cv2.addWeighted(idle_ov, 0.4, frame, 0.6, 0, frame)

            # Equipment label: "CRANE-02 | ACTIVE • 04:12"  or  "EXCAVATOR-01 | IDLE • 18m ⚠"
            lid        = track.logical_id
            equip_label= track.equip_type.upper().replace("_", " ")[:12]  # cap length
            line1      = f"{equip_label}-{lid:02d}"

            if state == ES_ACTIVE:
                dur_secs = int(track.active_duration_secs)
                mm = dur_secs // 60; ss = dur_secs % 60
                line2 = f"ACTIVE  {mm:02d}:{ss:02d}" if mm > 0 else f"ACTIVE  {ss}s"
            elif state == ES_IDLE:
                dur_secs = int(track.idle_duration_secs)
                mm = dur_secs // 60; ss = dur_secs % 60
                line2 = f"IDLE  {mm:02d}:{ss:02d} ⚠" if mm > 0 else f"IDLE  {ss}s ⚠"
            else:
                line2 = state

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

        # ── 6. Utilization ring gauge (top-left corner) ───────────────────────
        with self._metrics_lock:
            m = dict(self._metrics)

        if m:
            util      = m.get("utilization_score", 0)
            ring_cx   = int(65 * scale)
            ring_cy   = int(65 * scale)
            ring_r    = int(45 * scale)
            ring_thick= max(5, int(8 * scale))

            self._blend_rect(frame,
                             ring_cx - ring_r - ring_thick - 2,
                             ring_cy - ring_r - ring_thick - 2,
                             ring_cx + ring_r + ring_thick + 2,
                             ring_cy + ring_r + ring_thick + 2,
                             (6, 10, 18), alpha=0.75)
            cv2.ellipse(frame, (ring_cx, ring_cy), (ring_r, ring_r),
                        -90, 0, 360, (40, 50, 65), ring_thick, cv2.LINE_AA)
            fill_angle = int(util / 100 * 360)
            if fill_angle > 0:
                ring_fill_color = (
                    (50, 210, 80)  if util >= 70 else
                    (20, 180, 255) if util >= 40 else
                    (40, 80, 220)
                )
                cv2.ellipse(frame, (ring_cx, ring_cy), (ring_r, ring_r),
                            -90, 0, fill_angle, ring_fill_color, ring_thick, cv2.LINE_AA)

            util_txt = f"{util}%"
            (utw, uth), _ = cv2.getTextSize(util_txt, FONTB, 0.55 * scale, max(1, int(scale)))
            cv2.putText(frame, util_txt,
                        (ring_cx - utw // 2, ring_cy + uth // 2),
                        FONTB, 0.55 * scale, (230, 240, 255), max(1, int(scale)), cv2.LINE_AA)
            sub_txt = "Utilized"
            (stw, _), _ = cv2.getTextSize(sub_txt, FONT, 0.32 * scale, 1)
            cv2.putText(frame, sub_txt,
                        (ring_cx - stw // 2, ring_cy + uth // 2 + int(14 * scale)),
                        FONT, 0.32 * scale, (140, 155, 180), 1, cv2.LINE_AA)

        # ── 7. Summary panel (top-right) ──────────────────────────────────────
        if m:
            self._draw_summary_panel(frame, m, H, W, FONT, FONTB, scale, cfg)

        # ── 8. Status banner (bottom of frame) ────────────────────────────────
        if m:
            self._draw_status_banner(frame, m, H, W, FONT, FONTB, scale)

        # ── 9. Recommendation chip ────────────────────────────────────────────
        if m:
            self._draw_recommendation_chip(frame, H, W, FONT, scale)

        return frame

    # ── Summary panel (top-right) ─────────────────────────────────────────────

    def _draw_summary_panel(self, frame: np.ndarray, m: dict, H: int, W: int,
                            FONT, FONTB, scale: float, cfg: dict = None) -> None:
        active   = m.get("active_count", 0)
        idle_cnt = m.get("idle_count", 0)
        total    = m.get("total_count", 0)
        entering = m.get("entering_count", 0)
        util     = m.get("utilization_score", 0)
        z_status = m.get("zone_status", "BALANCED")
        sparkline= m.get("sparkline", [])
        expected = (cfg or {}).get("expected_equipment_count", 2)

        panel_w = int(265 * scale)
        panel_h = int(248 * scale)
        margin  = int(14 * scale)
        px      = W - panel_w - margin
        py      = margin

        self._blend_rect(frame, px, py, px + panel_w, py + panel_h, (6, 10, 18), alpha=0.88)
        self._blend_rect(frame, px, py, px + panel_w, py + int(3 * scale), (80, 140, 220), alpha=0.95)
        self._draw_rounded_rect(frame, px, py, px + panel_w, py + panel_h,
                                (70, 100, 140), max(1, int(scale)), radius=6)

        lh  = int(22 * scale)
        pad = int(12 * scale)
        cy  = py + int(20 * scale)

        cv2.putText(frame, "EQUIPMENT STATUS",
                    (px + pad, cy), FONTB, 0.48 * scale, (120, 185, 255),
                    max(1, int(scale)), cv2.LINE_AA)
        cy += int(4 * scale)
        cv2.line(frame,
                 (px + pad, cy + int(3 * scale)),
                 (px + panel_w - pad, cy + int(3 * scale)),
                 (50, 70, 100), 1)
        cy += int(10 * scale)

        count_str = str(total)
        cv2.putText(frame, count_str,
                    (px + pad, cy + int(lh * 0.9)), FONTB, 1.1 * scale,
                    (230, 240, 255), max(1, int(scale + 0.5)), cv2.LINE_AA)
        cv2.putText(frame, "Machines",
                    (px + pad + int(30 * scale) + int(len(count_str) * 16 * scale), cy + int(lh * 0.9)),
                    FONT, 0.45 * scale, (160, 175, 200), max(1, int(scale)), cv2.LINE_AA)
        cy += lh + int(2 * scale)

        live_color = (50, 210, 80) if total >= expected else (40, 80, 220)
        req_txt    = f"Expected: {expected}"
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
            (50, 210, 80)  if z_status == "BALANCED"      else
            (20, 190, 255) if z_status == "UNDERUTILIZED" else
            (40,  60, 230)
        )
        status_bg = (
            (15, 55, 20)  if z_status == "BALANCED"      else
            (10, 60, 80)  if z_status == "UNDERUTILIZED" else
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

        # Trend sparkline
        if len(sparkline) >= 6:
            half       = len(sparkline) // 2
            first_avg  = sum(sparkline[:half]) / half
            second_avg = sum(sparkline[half:]) / max(len(sparkline) - half, 1)
            slope      = second_avg - first_avg
            if slope > 0.5:
                trend_txt   = "^ Trend: More Active"
                trend_color = (50, 210, 80)
            elif slope < -0.5:
                trend_txt   = "v Trend: Less Active"
                trend_color = (40, 80, 220)
            else:
                trend_txt   = "- Trend: Stable"
                trend_color = (120, 150, 190)
            cv2.putText(frame, trend_txt,
                        (px + pad, cy + int(12 * scale)),
                        FONT, 0.38 * scale, trend_color, max(1, int(scale)), cv2.LINE_AA)
            cy += int(16 * scale)

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

    # ── Status banner (bottom of frame) ──────────────────────────────────────

    def _draw_status_banner(self, frame: np.ndarray, m: dict, H: int, W: int,
                            FONT, FONTB, scale: float) -> None:
        active   = m.get("active_count", 0)
        z_status = m.get("zone_status", "BALANCED")
        now      = time.time()

        if now < self._misuse_banner_until:
            banner_txt   = "! Equipment Misuse Detected"
            banner_bg    = (20, 30, 130)
            accent_color = (80, 100, 255)
        elif active == 0:
            banner_txt   = "No Equipment Detected"
            banner_bg    = (30, 35, 45)
            accent_color = (100, 110, 130)
        elif z_status == "UNDERUTILIZED":
            banner_txt   = "Equipment Underutilized"
            banner_bg    = (10, 70, 140)
            accent_color = (20, 150, 255)
        elif z_status == "OVERLOADED":
            banner_txt   = "Equipment Overloaded"
            banner_bg    = (20, 25, 120)
            accent_color = (60, 80, 240)
        else:
            banner_txt   = "Equipment Operational"
            banner_bg    = (15, 50, 22)
            accent_color = (50, 210, 80)

        banner_h = int(32 * scale)
        by1      = H - banner_h

        self._blend_rect(frame, 0, by1, W, H, banner_bg, alpha=0.82)
        self._blend_rect(frame, 0, by1, max(4, int(5 * scale)), H, accent_color, alpha=0.95)

        (tw, th), _ = cv2.getTextSize(banner_txt, FONTB, 0.50 * scale, max(1, int(scale)))
        tx = (W - tw) // 2
        ty = by1 + (banner_h + th) // 2
        cv2.putText(frame, banner_txt, (tx, ty),
                    FONTB, 0.50 * scale, accent_color, max(1, int(scale)), cv2.LINE_AA)

    # ── Recommendation chip ───────────────────────────────────────────────────

    def _draw_recommendation_chip(self, frame: np.ndarray, H: int, W: int,
                                  FONT, scale: float) -> None:
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

        if "Normal" in chip_txt:
            chip_bg    = (15, 55, 25)
            chip_color = (50, 210, 80)
        elif "Underutilized" in chip_txt:
            chip_bg    = (10, 55, 120)
            chip_color = (20, 170, 255)
        elif "Overloaded" in chip_txt:
            chip_bg    = (15, 20, 85)
            chip_color = (80, 100, 240)
        else:
            chip_bg    = (10, 60, 80)
            chip_color = (20, 190, 220)

        self._blend_rect(frame, cx1, cy1, cx2, cy2, chip_bg, alpha=0.88)
        self._draw_rounded_rect(frame, cx1, cy1, cx2, cy2, chip_color, 1, radius=5)
        cv2.putText(frame, chip_txt,
                    (cx1 + chip_pad, cy2 - chip_pad + int(2 * scale)),
                    FONT, 0.42 * scale, chip_color, max(1, int(scale)), cv2.LINE_AA)
