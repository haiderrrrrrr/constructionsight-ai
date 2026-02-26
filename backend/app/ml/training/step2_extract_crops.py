import cv2
import yaml
import collections
from pathlib import Path

BASE_DIR  = Path(__file__).resolve().parents[4]
SRC_ROOT  = BASE_DIR / "data/processed/construction-ppe-3class"
DST_ROOT  = BASE_DIR / "data/processed/construction-ppe-crops"

# Source class indices (from step1 output)
SRC_HELMET = 0
SRC_VEST   = 1
SRC_PERSON = 2

# Crop config
PADDING      = 0.30   # expand person box 30% for head/shoulder context
MIN_CROP_PX  = 64     # skip crops smaller than this — too tiny
IOU_THRESH   = 0.10   # PPE box must overlap person box by this fraction

assert SRC_ROOT.exists(), (
    f"❌ {SRC_ROOT} not found.\n"
    f"   Run step1_filter.py first."
)

# ── GEOMETRY HELPERS ─────────────────────────────────────────────────────────

def yolo_to_abs(box, W, H):
    cx, cy, bw, bh = box
    x1 = (cx - bw / 2) * W
    y1 = (cy - bh / 2) * H
    x2 = (cx + bw / 2) * W
    y2 = (cy + bh / 2) * H
    return x1, y1, x2, y2

def abs_to_yolo(x1, y1, x2, y2, W, H):
    cx = ((x1 + x2) / 2) / W
    cy = ((y1 + y2) / 2) / H
    bw = (x2 - x1) / W
    bh = (y2 - y1) / H
    return cx, cy, bw, bh

def overlap_ratio(inner, outer):
    """Fraction of inner box that is inside outer box."""
    ix1 = max(inner[0], outer[0])
    iy1 = max(inner[1], outer[1])
    ix2 = min(inner[2], outer[2])
    iy2 = min(inner[3], outer[3])
    inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
    area  = (inner[2]-inner[0]) * (inner[3]-inner[1])
    return inter / area if area > 0 else 0.0

def clamp(v, lo=0.001, hi=0.999):
    return max(lo, min(hi, v))

# ── PROCESS SPLITS ────────────────────────────────────────────────────────────

splits     = ["train", "val", "test"]
all_stats  = collections.defaultdict(collections.Counter)

for split in splits:
    src_img_dir = SRC_ROOT / "images" / split
    src_lbl_dir = SRC_ROOT / "labels" / split
    dst_img_dir = DST_ROOT / "images" / split
    dst_lbl_dir = DST_ROOT / "labels" / split
    dst_img_dir.mkdir(parents=True, exist_ok=True)
    dst_lbl_dir.mkdir(parents=True, exist_ok=True)

    img_files  = (list(src_img_dir.glob("*.jpg")) +
                  list(src_img_dir.glob("*.jpeg")) +
                  list(src_img_dir.glob("*.png")))

    crops_saved = 0
    crops_skipped = 0

    for img_path in img_files:
        lbl_path = src_lbl_dir / (img_path.stem + ".txt")
        if not lbl_path.exists():
            continue

        img = cv2.imread(str(img_path))
        if img is None:
            continue
        H, W = img.shape[:2]

        # Parse annotations
        anns = []
        for line in lbl_path.read_text().splitlines():
            line = line.strip()
            if not line:
                continue
            parts = line.split()
            cls   = int(parts[0])
            box   = list(map(float, parts[1:5]))
            anns.append((cls, box))

        persons = [(c, b) for c, b in anns if c == SRC_PERSON]
        ppe     = [(c, b) for c, b in anns if c != SRC_PERSON]

        if not persons:
            continue

        for p_idx, (_, p_box) in enumerate(persons):
            px1, py1, px2, py2 = yolo_to_abs(p_box, W, H)
            pw = px2 - px1
            ph = py2 - py1

            # Expand with padding
            ex1 = max(0,  px1 - pw * PADDING)
            ey1 = max(0,  py1 - ph * PADDING * 0.6)  # less padding above (head room)
            ex2 = min(W,  px2 + pw * PADDING)
            ey2 = min(H,  py2 + ph * PADDING * 0.2)  # minimal below feet

            cw = ex2 - ex1
            ch = ey2 - ey1

            if cw < MIN_CROP_PX or ch < MIN_CROP_PX:
                crops_skipped += 1
                continue

            crop = img[int(ey1):int(ey2), int(ex1):int(ex2)]
            if crop.size == 0:
                crops_skipped += 1
                continue

            ch_px, cw_px = crop.shape[:2]

            # Find PPE belonging to this person
            crop_labels = []
            has_helmet  = False
            has_vest    = False

            for ppe_cls, ppe_box in ppe:
                ax1, ay1, ax2, ay2 = yolo_to_abs(ppe_box, W, H)

                # Check overlap with original (non-expanded) person box
                if overlap_ratio((ax1,ay1,ax2,ay2), (px1,py1,px2,py2)) < IOU_THRESH:
                    continue

                # Remap coords relative to crop
                rx1 = max(0,    ax1 - ex1)
                ry1 = max(0,    ay1 - ey1)
                rx2 = min(cw_px, ax2 - ex1)
                ry2 = min(ch_px, ay2 - ey1)

                if rx2 <= rx1 or ry2 <= ry1:
                    continue

                rcx, rcy, rbw, rbh = abs_to_yolo(rx1, ry1, rx2, ry2, cw_px, ch_px)
                rcx  = clamp(rcx)
                rcy  = clamp(rcy)
                rbw  = clamp(rbw, 0.02)
                rbh  = clamp(rbh, 0.02)

                crop_labels.append(
                    f"{ppe_cls} {rcx:.6f} {rcy:.6f} {rbw:.6f} {rbh:.6f}"
                )

                if ppe_cls == SRC_HELMET:
                    has_helmet = True
                    all_stats[split]["helmet"] += 1
                elif ppe_cls == SRC_VEST:
                    has_vest = True
                    all_stats[split]["vest"] += 1

            # Always add Person label covering full crop
            crop_labels.append(f"{SRC_PERSON} 0.500000 0.500000 0.980000 0.980000")
            all_stats[split]["Person"] += 1

            if not has_helmet:
                all_stats[split]["no_helmet_derived"] += 1
            if not has_vest:
                all_stats[split]["no_vest_derived"] += 1

            # Save crop
            stem      = f"{img_path.stem}_p{p_idx}"
            save_path = dst_img_dir / f"{stem}.jpg"
            cv2.imwrite(str(save_path), crop, [cv2.IMWRITE_JPEG_QUALITY, 95])
            (dst_lbl_dir / f"{stem}.txt").write_text("\n".join(crop_labels))
            crops_saved += 1

    print(f"  [{split:<5}]  crops saved: {crops_saved:>5}  |  skipped (too small): {crops_skipped}")

# Write crop dataset YAML (same 3 classes — helmet, vest, Person)
new_cfg = {
    "path"  : str(DST_ROOT),
    "train" : "images/train",
    "val"   : "images/val",
    "test"  : "images/test",
    "nc"    : 3,
    "names" : ["helmet", "vest", "Person"],
}
(DST_ROOT / "data.yaml").write_text(
    yaml.dump(new_cfg, allow_unicode=True, default_flow_style=False)
)

# Summary
print(f"""
{'='*58}
  Step 2 complete — crop dataset ready
{'='*58}
  Output   : {DST_ROOT}
  Classes  : helmet / vest / Person

  Train crops:
    Person total     : {all_stats['train']['Person']}
    with helmet      : {all_stats['train']['helmet']}
    with vest        : {all_stats['train']['vest']}
    without helmet   : {all_stats['train']['no_helmet_derived']}  <- violation at inference
    without vest     : {all_stats['train']['no_vest_derived']}  <- violation at inference

""")
