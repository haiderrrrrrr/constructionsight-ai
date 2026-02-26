"""
ReID Gallery Persistence — save/load FAISS index + identity embeddings + compliance state.

Storage layout (per-project, relative to backend root):
  data/reid_gallery/
    project_{id}/
      faiss.index          — FAISS HNSW index
      gallery_meta.json    — {next_id, id_map, identity_embeddings (base64 float32), identity_last_seen}
      state_memory.json    — {global_id: {state, streaks, saved_at, ...}}

Design:
  - Per-project isolation: cameras from different projects never share identities
  - Atomic writes: write to .tmp then os.replace() — safe against crash mid-write
  - Graceful degradation: any load error → return (None, None), start fresh
  - Periodic save thread (60s interval) + triggered saves (pipeline stop, new IDs, shutdown)
  - State memory uses a longer TTL on restart (default 300s) vs in-session 90s
"""

from __future__ import annotations

import base64
import json
import logging
import os
import threading
import time
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)

# ── Gallery storage root ───────────────────────────────────────────────────────
_GALLERY_ROOT = Path(__file__).resolve().parents[2] / "data" / "reid_gallery"

_save_lock = threading.Lock()
_periodic_thread: threading.Thread | None = None


def _gallery_dir(project_id: int | None) -> Path:
    """Return the per-project gallery directory, creating it if needed."""
    if project_id is not None:
        p = _GALLERY_ROOT / f"project_{project_id}"
    else:
        p = _GALLERY_ROOT  # legacy fallback (shouldn't happen in production)
    p.mkdir(parents=True, exist_ok=True)
    return p


def _emb_to_b64(arr: np.ndarray) -> str:
    """Encode float32 numpy array as base64 string."""
    return base64.b64encode(arr.astype(np.float32).tobytes()).decode("ascii")


def _b64_to_emb(s: str, dim: int) -> np.ndarray:
    """Decode base64 string to float32 numpy array."""
    raw = base64.b64decode(s.encode("ascii"))
    return np.frombuffer(raw, dtype=np.float32).copy()


def save_gallery(manager, state_memory, project_id: int | None = None) -> None:
    """
    Persist FAISS index + identity embeddings + compliance state to disk.
    Thread-safe. Atomic write (tmp + rename). Per-project storage.
    manager: GlobalIDManager instance (or None — no-op)
    state_memory: GlobalStateMemory instance (or None — skipped)
    project_id: isolates gallery to this project's directory
    """
    if manager is None:
        return

    with _save_lock:
        try:
            gallery_dir = _gallery_dir(project_id)
            index_file = gallery_dir / "faiss.index"
            meta_file  = gallery_dir / "gallery_meta.json"
            state_file = gallery_dir / "state_memory.json"

            # ── 1. Save FAISS index ────────────────────────────────────────
            if manager.index is not None and manager.index.ntotal > 0:
                try:
                    import faiss
                    tmp_index = str(index_file) + ".tmp"
                    faiss.write_index(manager.index, tmp_index)
                    os.replace(tmp_index, str(index_file))
                except Exception as e:
                    logger.warning(f"[reid_persist] FAISS index write failed: {e}")

            # ── 2. Save gallery metadata ───────────────────────────────────
            identity_serial = {}
            for gid, bucket in manager._identity_embeddings.items():
                identity_serial[str(gid)] = [
                    [float(q), _emb_to_b64(e)] for q, e in bucket
                ]

            # Persist identity_last_seen for age-based eviction across restarts
            last_seen_serial = {
                str(gid): float(ts)
                for gid, ts in getattr(manager, "_identity_last_seen", {}).items()
            }

            meta = {
                "next_id":            manager.next_id,
                "id_map":             manager.id_map,
                "identity_embeddings": identity_serial,
                "identity_last_seen": last_seen_serial,
                "dim":                manager.dim,
                "assign_thresh":      manager.assign_thresh,
                "match_thresh":       manager.match_thresh,
            }
            tmp_meta = str(meta_file) + ".tmp"
            with open(tmp_meta, "w", encoding="utf-8") as f:
                json.dump(meta, f)
            os.replace(tmp_meta, str(meta_file))

            # ── 3. Save state memory ───────────────────────────────────────
            if state_memory is not None:
                state_serial = {
                    str(gid): snap for gid, snap in state_memory._memory.items()
                }
                tmp_state = str(state_file) + ".tmp"
                with open(tmp_state, "w", encoding="utf-8") as f:
                    json.dump(state_serial, f)
                os.replace(tmp_state, str(state_file))

            logger.debug(
                f"[reid_persist] Saved gallery (project={project_id}): "
                f"{manager.next_id} identities, "
                f"{manager.index.ntotal if manager.index else 0} embeddings"
            )

        except Exception as e:
            logger.warning(f"[reid_persist] save_gallery failed: {e}")


def load_gallery(persist_state_max_age_s: int = 300, project_id: int | None = None):
    """
    Load FAISS index + identity embeddings + compliance state from disk.
    Returns (GlobalIDManager, GlobalStateMemory) or (None, None) on any error.
    project_id: load from per-project directory.
    persist_state_max_age_s: max age for restored compliance snapshots (default 300s = 5 min).
    """
    try:
        from ..api.routes.ml_stream_enterprise import GlobalIDManager, GlobalStateMemory
    except Exception as e:
        logger.warning(f"[reid_persist] Cannot import GlobalIDManager: {e}")
        return None, None

    gallery_dir = _gallery_dir(project_id)
    meta_file   = gallery_dir / "gallery_meta.json"
    index_file  = gallery_dir / "faiss.index"
    state_file  = gallery_dir / "state_memory.json"

    if not meta_file.exists():
        logger.info(f"[reid_persist] No gallery file found for project={project_id} — starting fresh")
        return None, None

    try:
        # ── 1. Load metadata ───────────────────────────────────────────────
        with open(meta_file, "r", encoding="utf-8") as f:
            meta = json.load(f)

        dim            = meta.get("dim", 512)
        assign_thresh  = meta.get("assign_thresh", 0.72)
        match_thresh   = meta.get("match_thresh", 0.58)
        next_id        = meta["next_id"]
        id_map         = meta["id_map"]
        identity_serial = meta.get("identity_embeddings", {})
        last_seen_serial = meta.get("identity_last_seen", {})

        # Reconstruct identity_embeddings: {gid: [(quality, np.ndarray), ...]}
        identity_embeddings = {}
        for gid_str, bucket in identity_serial.items():
            gid = int(gid_str)
            identity_embeddings[gid] = [
                (float(q), _b64_to_emb(b64, dim)) for q, b64 in bucket
            ]

        # Reconstruct identity_last_seen
        identity_last_seen = {int(k): float(v) for k, v in last_seen_serial.items()}

        # ── 2. Build GlobalIDManager ───────────────────────────────────────
        manager = GlobalIDManager(
            dim=dim,
            assign_thresh=assign_thresh,
            match_thresh=match_thresh,
        )
        manager.next_id = next_id
        manager.id_map = id_map
        manager._identity_embeddings = identity_embeddings
        manager._identity_last_seen  = identity_last_seen

        # Always rebuild from metadata so index metric/settings stay in sync
        # with the current ReID code. Older saved FAISS indexes may have been
        # created with L2 distance, while matching thresholds expect cosine/IP.
        from ..api.routes.ml_stream_enterprise import _make_faiss_index
        all_embs = []
        new_id_map = []
        for gid, bucket in identity_embeddings.items():
            for _, emb in bucket:
                all_embs.append(emb)
                new_id_map.append(gid)
        manager.index = _make_faiss_index(dim)
        if all_embs:
            arr = np.array(all_embs, dtype=np.float32)
            manager.index.add(arr)
        manager.id_map = new_id_map
        logger.info(f"[reid_persist] FAISS rebuilt from metadata (project={project_id}): {len(all_embs)} embeddings")

        # ── 3. Load state memory ───────────────────────────────────────────
        state_memory = GlobalStateMemory()
        if state_file.exists():
            try:
                with open(state_file, "r", encoding="utf-8") as f:
                    state_serial = json.load(f)
                now = time.time()
                restored = 0
                for gid_str, snap in state_serial.items():
                    age = now - snap.get("saved_at", 0)
                    if age <= persist_state_max_age_s:
                        state_memory._memory[int(gid_str)] = snap
                        restored += 1
                logger.info(f"[reid_persist] State memory restored (project={project_id}): {restored} snapshots")
            except Exception as e:
                logger.warning(f"[reid_persist] State memory load failed: {e}")

        logger.info(
            f"[reid_persist] Gallery loaded (project={project_id}): "
            f"{next_id} identities, "
            f"{manager.index.ntotal if manager.index else 0} embeddings in index"
        )
        return manager, state_memory

    except Exception as e:
        logger.warning(f"[reid_persist] load_gallery failed (project={project_id}): {e} — starting fresh")
        return None, None


def start_periodic_save(interval_s: int = 60) -> None:
    """
    Start a daemon thread that saves the gallery for all active projects every interval_s seconds.
    Safe to call multiple times — only starts one thread.
    """
    global _periodic_thread
    if _periodic_thread is not None and _periodic_thread.is_alive():
        return

    def _loop():
        while True:
            time.sleep(interval_s)
            try:
                import app.api.routes.ml_stream_enterprise as _mse
                # Save each project's gallery independently
                for pid, mgr in list(_mse._project_faiss_managers.items()):
                    sm = _mse._project_state_memories.get(pid)
                    lock = _mse._project_reid_locks.get(pid)
                    if lock is None:
                        continue
                    with lock:
                        save_gallery(mgr, sm, project_id=pid)
            except Exception as e:
                logger.debug(f"[reid_persist] periodic save error: {e}")

    _periodic_thread = threading.Thread(target=_loop, name="reid-periodic-save", daemon=True)
    _periodic_thread.start()
    logger.info(f"[reid_persist] Periodic save thread started (interval={interval_s}s)")
