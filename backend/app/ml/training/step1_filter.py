import yaml
import shutil
import collections
from pathlib import Path

# ── CONFIG ────────────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parents[4]
SRC_ROOT = BASE_DIR / "data/processed/construction-ppe"
DST_ROOT = BASE_DIR / "data/processed/construction-ppe-3class"
YAML_IN  = SRC_ROOT / "data.yaml"
# ──────────────────────────────────────────────────────────────────────────────

assert YAML_IN.exists(), f"❌ data.yaml not found: {YAML_IN}"

# Original indices from your data.yaml (screenshot confirmed):
#   0:helmet  1:gloves  2:vest  3:boots  4:goggles  5:none
#   6:Person  7:no_helmet  8:no_goggle  9:no_gloves  10:no_boots
#
# KEEP only helmet(0), vest(2), Person(6)
# DROP everything else including no_helmet(7) — presence-based approach
KEEP_INDICES = {
    0: "helmet",
    2: "vest",
    6: "Person",
}

remap     = {old: new for new, old in enumerate(sorted(KEEP_INDICES.keys()))}
new_names = [KEEP_INDICES[old] for old in sorted(KEEP_INDICES.keys())]

# After remapping:
#   old[0] helmet  -> new[0]
#   old[2] vest    -> new[1]
#   old[6] Person  -> new[2]

print("📋 Final class remapping:")
for old_idx in sorted(KEEP_INDICES.keys()):
    print(f"   [{old_idx:>2}] {KEEP_INDICES[old_idx]:<10}  ->  [{remap[old_idx]}]")
print(f"\n🗑️  Dropping ALL other classes including no_helmet")
print(f"✅ Training classes: {new_names}")
print(f"✅ Violations: derived at inference from absence\n")

# Verify source structure
for split in ["train", "val", "test"]:
    for kind in ["images", "labels"]:
        d = SRC_ROOT / kind / split
        assert d.exists(), f"❌ Missing: {d}"
print("✅ Source folder structure verified")

# Process splits
splits = ["train", "val", "test"]
grand_total_images  = 0
grand_total_kept    = 0
grand_total_dropped = 0
grand_total_skipped = 0

for split in splits:
    src_img_dir = SRC_ROOT / "images" / split
    src_lbl_dir = SRC_ROOT / "labels" / split
    dst_img_dir = DST_ROOT / "images" / split
    dst_lbl_dir = DST_ROOT / "labels" / split
    dst_img_dir.mkdir(parents=True, exist_ok=True)
    dst_lbl_dir.mkdir(parents=True, exist_ok=True)

    image_files = (
        list(src_img_dir.glob("*.jpg")) +
        list(src_img_dir.glob("*.jpeg")) +
        list(src_img_dir.glob("*.png"))
    )

    split_copied  = 0
    split_kept    = 0
    split_dropped = 0
    split_skipped = 0
    class_counts  = collections.Counter()

    for img_path in image_files:
        lbl_path = src_lbl_dir / (img_path.stem + ".txt")

        if not lbl_path.exists():
            split_skipped += 1
            continue

        lines = [l.strip() for l in lbl_path.read_text().splitlines() if l.strip()]
        new_lines = []

        for line in lines:
            parts  = line.split()
            cls_id = int(parts[0])
            if cls_id in KEEP_INDICES:
                new_id = remap[cls_id]
                new_lines.append(f"{new_id} " + " ".join(parts[1:]))
                class_counts[new_id] += 1
                split_kept += 1
            else:
                split_dropped += 1

        if not new_lines:
            split_skipped += 1
            continue

        shutil.copy(img_path, dst_img_dir / img_path.name)
        (dst_lbl_dir / (img_path.stem + ".txt")).write_text("\n".join(new_lines))
        split_copied += 1

    grand_total_images  += split_copied
    grand_total_kept    += split_kept
    grand_total_dropped += split_dropped
    grand_total_skipped += split_skipped

    print(f"  [{split:<5}]  images: {split_copied:>5}  |  kept: {split_kept:>5}  |  dropped: {split_dropped:>5}")
    if split == "train":
        print(f"           Train class distribution:")
        for cls_id, count in sorted(class_counts.items()):
            bar = "█" * (count // 50)
            print(f"             [{cls_id}] {new_names[cls_id]:<10}  {count:>5}  {bar}")

# Write new data.yaml
new_cfg = {
    "path"  : str(DST_ROOT),
    "train" : "images/train",
    "val"   : "images/val",
    "test"  : "images/test",
    "nc"    : 3,
    "names" : new_names,
}
dst_yaml = DST_ROOT / "data.yaml"
with open(dst_yaml, "w", encoding="utf-8") as f:
    yaml.dump(new_cfg, f, allow_unicode=True, default_flow_style=False)

print(f"""
{'='*58}
  Step 1 complete
{'='*58}
  Output   : {DST_ROOT}
  Classes  : {new_names}
  Images   : {grand_total_images}
  Kept ann : {grand_total_kept}
  YAML     : {dst_yaml}

""")
