"""
STEP 3 — Train Stage 2 PPE detector on person crops.
=====================================================
Architecture: Two-stage cascade pipeline

  Stage 1: yolo11x.pt  COCO pretrained  →  finds ALL people in 2K frame
           (zero training required — COCO has 330K person examples)

  Stage 2: yolo11s.pt  trained here     →  checks PPE on each person crop
           3 classes: helmet / vest / Person
           Violations derived from absence in inference script

Hardware: RTX 5080, 16GB VRAM, Windows
  imgsz=224 (crop size), batch=64, AMP=True  ->  ~4GB VRAM
  Training time: ~2-3 hours for full 200 epochs

Why YOLOv11s for Stage 2 (not 11x):
  - Input is 224px crop, not 1280px full scene
  - Simpler task = smaller model sufficient
  - 10 people in frame = 10 crops = ~20ms on RTX 5080 = real-time at 25fps
  - YOLOv11x on crops would be overkill and slower

Expected results with 3 clean balanced classes:
  helmet AP@50 : 93-96%
  vest   AP@50 : 92-95%
  Person AP@50 : 97-99%
  Overall mAP  : 94-97%
"""

import os
import sys
import json
import shutil
import yaml
import collections
from pathlib import Path

import torch
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from ultralytics import YOLO

# ─────────────────────────────────────────────
# 0. PATH BOOTSTRAP
# ─────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parents[4]
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from backend.app.ml.utils.run_manager import (
    create_run_dirs, save_config_snapshot,
    register_run, move_yolo_outputs,
)
from backend.app.ml.utils.reporting import generate_pdf_report

# ─────────────────────────────────────────────
# 1. HARDWARE
# ─────────────────────────────────────────────
assert torch.cuda.is_available(), "❌ No CUDA GPU detected."
gpu_name = torch.cuda.get_device_name(0)
vram_gb  = torch.cuda.get_device_properties(0).total_memory / 1e9
print(f"✅ GPU  : {gpu_name}")
print(f"✅ VRAM : {vram_gb:.1f} GB")

IMGSZ   = 224    # crop size — don't change this
BATCH   = 32    # RTX 4060 Laptop 8GB     # 224px crops are tiny, RTX 5080 handles 64 easily
WORKERS = 0      # Windows = must be 0

PHASE1_EPOCHS = 50
PHASE2_EPOCHS = 150

print(f"✅ imgsz={IMGSZ}  batch={BATCH}  workers={WORKERS}")

# ─────────────────────────────────────────────
# 2. PATHS & PRE-FLIGHT
# ─────────────────────────────────────────────
DATA_ROOT  = BASE_DIR / "data/processed/construction-ppe-crops"
YAML_PATH  = DATA_ROOT / "data.yaml"
MODEL_ROOT = BASE_DIR / "backend/app/ml/models/yolo_ppe"
MODEL_PATH = str(MODEL_ROOT / "yolo11s.pt")
RUN_NAME   = "ppe_stage2"

assert YAML_PATH.exists(), (
    f"❌ Crop dataset not found: {YAML_PATH}\n"
    f"   Run in order:\n"
    f"     1. python step1_filter.py\n"
    f"     2. python step2_extract_crops.py\n"
    f"     3. python step3_train.py  (this file)"
)
assert Path(MODEL_PATH).exists(), (
    f"❌ yolo11s.pt not found at {MODEL_PATH}\n"
    f"   Download it:\n"
    f"     python -c \"from ultralytics import YOLO; YOLO('yolo11s.pt')\"\n"
    f"   Then move yolo11s.pt to {MODEL_ROOT}"
)

with open(YAML_PATH) as f:
    data_cfg = yaml.safe_load(f)

names = data_cfg["names"]  # ['helmet', 'vest', 'Person']
assert data_cfg["nc"] == 3, f"❌ Expected 3 classes, got {data_cfg['nc']}: {names}"
print(f"✅ Classes: {names}")

# Crop distribution check
train_lbl_dir = DATA_ROOT / "labels" / "train"
crop_counts   = collections.Counter()
for lf in train_lbl_dir.glob("*.txt"):
    for line in lf.read_text().splitlines():
        if line.strip():
            crop_counts[int(line.split()[0])] += 1

print(f"\n📊 Crop training distribution:")
for k, v in sorted(crop_counts.items()):
    bar = "█" * (v // 40)
    print(f"   [{k}] {names[k]:<10}  {v:>5}  {bar}")

total_crops = len(list((DATA_ROOT / "images" / "train").glob("*")))
print(f"\n✅ Total training crops: {total_crops}")

# ─────────────────────────────────────────────
# 3. RUN INIT
# ─────────────────────────────────────────────
run_dir, run_id = create_run_dirs(MODEL_ROOT, "PPE_STAGE2")
PROJECT = str(run_dir)
print(f"\n🗂️  Run: {run_id}  ->  {run_dir}")

# MLflow (non-blocking)
try:
    import mlflow
    mlflow_dir = MODEL_ROOT / "mlflow"
    mlflow_dir.mkdir(parents=True, exist_ok=True)
    uri = f"file:///{mlflow_dir.as_posix()}"
    mlflow.set_tracking_uri(uri)
    mlflow.set_registry_uri(uri)
    os.environ["MLFLOW_TRACKING_URI"] = uri
    os.environ["MLFLOW_REGISTRY_URI"] = uri
except Exception:
    try:
        from ultralytics import settings as _ys
        _ys.update({"mlflow": False})
    except Exception:
        pass

# Absolute path YAML (prevents Windows path issues)
data_cfg["path"] = str(DATA_ROOT)
fixed_yaml = run_dir / "data_fixed.yaml"
with open(fixed_yaml, "w", encoding="utf-8") as f:
    yaml.safe_dump(data_cfg, f, allow_unicode=True)

save_config_snapshot(run_dir, {
    "stage"         : "Stage 2 crop PPE detector",
    "model"         : "yolo11s",
    "gpu"           : gpu_name,
    "vram_gb"       : round(vram_gb, 1),
    "imgsz"         : IMGSZ,
    "batch"         : BATCH,
    "classes"       : names,
    "crop_counts"   : dict(crop_counts),
    "total_crops"   : total_crops,
    "epochs_phase1" : PHASE1_EPOCHS,
    "epochs_phase2" : PHASE2_EPOCHS,
    "violation_logic": "derived at inference: no helmet/vest in crop = violation",
})

# ─────────────────────────────────────────────
# 4. PHASE 1 — FROZEN BACKBONE (50 EPOCHS)
# ─────────────────────────────────────────────
# Backbone (layers 0-9) frozen — only detection head trains.
# Initialises head weights stably before full fine-tuning.
#
# Augmentation notes for 224px person crops:
#   degrees=15     workers tilt/bend — helmet stays on head, just rotates
#   scale=0.4      mild — crop is already person-normalised
#   erasing=0.3    scaffolding/hard-hats partially occluded even in crops
#   flipud=0.0     people are always upright — never flip vertically
#   mosaic=0.5     lighter than full-scene — crops are already focused
#   hsv_s=0.9      Pakistani site: harsh sun, strong shadows on helmets
#   hsv_v=0.5      CCTV footage: blown-out or dark depending on time of day
#   cls=2.0        boost classification loss — model must distinguish
#                  helmet-present vs helmet-absent in crop confidently

print("\n" + "="*60)
print("  PHASE 1 — Frozen backbone (50 epochs)")
print("="*60)

model = YOLO(MODEL_PATH)

results_p1 = model.train(
    data             = str(fixed_yaml),
    epochs           = PHASE1_EPOCHS,
    imgsz            = IMGSZ,
    batch            = BATCH,
    workers          = WORKERS,
    optimizer        = "AdamW",
    lr0              = 0.001,
    lrf              = 0.01,        # final LR = 0.001 * 0.01 = 0.00001
    momentum         = 0.937,
    weight_decay     = 0.0005,
    warmup_epochs    = 5,
    warmup_momentum  = 0.8,
    warmup_bias_lr   = 0.1,
    cos_lr           = True,
    box              = 7.5,
    cls              = 2.0,         # boosted — PPE presence is a classification task
    dfl              = 1.5,
    freeze           = 10,
    amp              = True,
    cache            = "ram",       # 224px crops fit easily in RAM
    patience         = 0,           # DISABLED — always run all 50 epochs
    # Augmentation
    mosaic           = 0.5,
    mixup            = 0.0,         # OFF in phase 1
    copy_paste       = 0.0,
    erasing          = 0.3,
    translate        = 0.1,
    scale            = 0.4,
    degrees          = 15.0,
    shear            = 2.0,
    perspective      = 0.001,
    fliplr           = 0.5,
    flipud           = 0.0,
    hsv_h            = 0.015,
    hsv_s            = 0.9,
    hsv_v            = 0.5,
    project          = PROJECT,
    name             = f"{RUN_NAME}_PHASE1",
    plots            = True,
    verbose          = True,
    exist_ok         = True,
)

phase1_best = Path(f"{PROJECT}/{RUN_NAME}_PHASE1/weights/best.pt")
assert phase1_best.exists(), f"❌ Phase 1 best.pt missing: {phase1_best}"
print(f"\n✅ Phase 1 done -> {phase1_best}")

# ─────────────────────────────────────────────
# 5. PHASE 2 — FULL FINE-TUNING (150 EPOCHS)
# ─────────────────────────────────────────────
# All layers trainable. Lower LR to preserve backbone features.
# close_mosaic=20: disable mosaic for final 20 epochs so model
# converges on clean crops — this consistently gives +2-3% mAP.
# cls=2.5: push even harder on classification in phase 2.

print("\n" + "="*60)
print("  PHASE 2 — Full fine-tuning (150 epochs)")
print("="*60)

model = YOLO(str(phase1_best))

results_p2 = model.train(
    data             = str(fixed_yaml),
    epochs           = PHASE2_EPOCHS,
    imgsz            = IMGSZ,
    batch            = BATCH,
    workers          = WORKERS,
    optimizer        = "AdamW",
    lr0              = 0.0005,      # lower — backbone features are delicate
    lrf              = 0.01,
    momentum         = 0.937,
    weight_decay     = 0.0005,
    warmup_epochs    = 3,
    warmup_momentum  = 0.8,
    warmup_bias_lr   = 0.05,
    cos_lr           = True,
    box              = 7.5,
    cls              = 2.5,         # even higher — really push PPE classification
    dfl              = 1.5,
    freeze           = 0,           # ALL layers trainable
    amp              = True,
    cache            = "ram",
    patience         = 0,           # DISABLED — let it run all 150 epochs
    close_mosaic     = 20,          # disable mosaic last 20 epochs — key for mAP
    mosaic           = 0.4,
    mixup            = 0.1,         # light mixup ON — model stable enough
    copy_paste       = 0.0,
    erasing          = 0.3,
    translate        = 0.1,
    scale            = 0.35,
    degrees          = 12.0,
    shear            = 2.0,
    perspective      = 0.0005,
    fliplr           = 0.5,
    flipud           = 0.0,
    hsv_h            = 0.015,
    hsv_s            = 0.9,
    hsv_v            = 0.5,
    project          = PROJECT,
    name             = f"{RUN_NAME}_FINAL",
    plots            = True,
    verbose          = True,
    exist_ok         = True,
)

phase2_best = Path(f"{PROJECT}/{RUN_NAME}_FINAL/weights/best.pt")
assert phase2_best.exists(), f"❌ Phase 2 best.pt missing: {phase2_best}"
print(f"\n✅ Phase 2 done -> {phase2_best}")

# ─────────────────────────────────────────────
# 6. VALIDATION
# ─────────────────────────────────────────────
print("\n" + "="*60)
print("  VALIDATION")
print("="*60)

final_model  = YOLO(str(phase2_best))
metrics_test = final_model.val(data=str(fixed_yaml), split="test",
                               imgsz=IMGSZ, workers=WORKERS, verbose=True)
metrics_val  = final_model.val(data=str(fixed_yaml), split="val",
                               imgsz=IMGSZ, workers=WORKERS, verbose=True)

print("\n📊 Per-class AP@50 (test split):")
per_class = {}
if hasattr(metrics_test.box, "ap50"):
    for i, ap in enumerate(metrics_test.box.ap50):
        cls_name = names[i] if i < len(names) else str(i)
        bar      = "█" * int(ap * 40)
        flag     = "  ✅" if ap >= 0.92 else "  ⚠️ LOW"
        print(f"  [{i}] {cls_name:<10}  {ap:.3f}  {bar}{flag}")
        per_class[cls_name] = round(float(ap), 4)

summary = {
    "run_id"          : run_id,
    "stage"           : "Stage 2 crop PPE detector",
    "model"           : "yolo11s",
    "imgsz"           : IMGSZ,
    "classes"         : names,
    "per_class_ap50"  : per_class,
    "test_mAP50"      : round(float(metrics_test.box.map50), 4),
    "test_mAP5095"    : round(float(metrics_test.box.map),   4),
    "test_precision"  : round(float(metrics_test.box.mp),    4),
    "test_recall"     : round(float(metrics_test.box.mr),    4),
    "val_mAP50"       : round(float(metrics_val.box.map50),  4),
    "val_mAP5095"     : round(float(metrics_val.box.map),    4),
    "violation_logic" : "no helmet in crop = NO HELMET | no vest in crop = NO VEST",
}

with open(run_dir / "metrics.json", "w") as f:
    json.dump(summary, f, indent=2)

print(f"\n📈 Test  mAP@50    : {summary['test_mAP50']}")
print(f"📈 Test  mAP@50-95 : {summary['test_mAP5095']}")
print(f"📈 Val   mAP@50    : {summary['val_mAP50']}")

# ─────────────────────────────────────────────
# 7. PLOTS
# ─────────────────────────────────────────────
move_yolo_outputs(Path(f"{PROJECT}/{RUN_NAME}_FINAL"), run_dir)
artifacts_dir = run_dir / "artifacts" / f"{RUN_NAME}_FINAL"
results_csv   = artifacts_dir / "results.csv"

if results_csv.exists():
    df = pd.read_csv(results_csv)
    df.columns = df.columns.str.strip()
    plt.style.use("seaborn-v0_8-whitegrid")

    def vline(ax):
        ax.axvline(x=PHASE1_EPOCHS, color="#888", ls=":", lw=1.5,
                   label=f"Phase 2 start (ep {PHASE1_EPOCHS})")

    # mAP
    fig, ax = plt.subplots(figsize=(9, 5))
    for col, lbl, color, ls in [
        ("metrics/mAP50(B)",    "mAP@50",    "#007070", "-"),
        ("metrics/mAP50-95(B)", "mAP@50-95", "#005050", "--"),
    ]:
        if col in df.columns:
            ax.plot(df["epoch"], df[col], color=color, lw=2.5, ls=ls, label=lbl)
    ax.axhline(y=0.94, color="red", lw=1.2, ls="--", alpha=0.7, label="94% target")
    vline(ax)
    ax.set_xlabel("Epoch"); ax.set_ylabel("mAP")
    ax.set_title("Stage 2 PPE Crop Detector — mAP (YOLOv11s)")
    ax.legend(); fig.tight_layout()
    fig.savefig(run_dir / "artifacts" / "map_curve.png", dpi=200)
    plt.close(fig)

    # Loss
    fig, ax = plt.subplots(figsize=(9, 5))
    for col, lbl, color in [
        ("train/box_loss", "Box", "#e07040"),
        ("train/cls_loss", "Cls", "#4070e0"),
        ("train/dfl_loss", "DFL", "#40a040"),
    ]:
        if col in df.columns:
            ax.plot(df["epoch"], df[col], lw=2, label=lbl, color=color)
    vline(ax)
    ax.set_xlabel("Epoch"); ax.set_ylabel("Loss")
    ax.set_title("Training Loss Curves")
    ax.legend(); fig.tight_layout()
    fig.savefig(run_dir / "artifacts" / "loss_curve.png", dpi=200)
    plt.close(fig)

    # Per-class AP bar
    if per_class:
        fig, ax = plt.subplots(figsize=(8, 3))
        cls_list = list(per_class.keys())
        ap_list  = list(per_class.values())
        colors   = ["#27ae60"] * len(cls_list)
        bars     = ax.barh(cls_list, ap_list, color=colors, height=0.4, edgecolor="white")
        ax.axvline(x=0.94, color="red", lw=1.5, ls="--", label="94% target")
        for bar, val in zip(bars, ap_list):
            ax.text(bar.get_width() + 0.005,
                    bar.get_y() + bar.get_height() / 2,
                    f"{val:.3f}", va="center", fontsize=11)
        ax.set_xlim(0, 1.1)
        ax.set_xlabel("AP@50")
        ax.set_title("Per-class AP@50 — test split")
        ax.legend(); fig.tight_layout()
        fig.savefig(run_dir / "artifacts" / "per_class_ap.png", dpi=200)
        plt.close(fig)

    print("✅ Plots saved.")

# ─────────────────────────────────────────────
# 8. SAVE BEST MODEL
# ─────────────────────────────────────────────
try:
    generate_pdf_report(run_dir / "metrics.json",
                        run_dir / "artifacts",
                        run_dir / "report.pdf")
    print(f"📄 Report: {run_dir / 'report.pdf'}")
except Exception as e:
    print(f"⚠️  PDF failed: {e}")

register_run(MODEL_ROOT, summary)

best_src = artifacts_dir / "weights" / "best.pt"
if not best_src.exists():
    best_src = phase2_best

dst = MODEL_ROOT / "ppe_stage2_best.pt"
if best_src.exists():
    shutil.copy(best_src, dst)
    print(f"⭐ Stage 2 model saved -> {dst}")

# ─────────────────────────────────────────────
# 9. FINAL SUMMARY
# ─────────────────────────────────────────────
target_met = summary["test_mAP50"] >= 0.92
print("\n" + "="*60)
print("  TRAINING COMPLETE")
print("="*60)
print(f"  Model          : YOLOv11s on {IMGSZ}px crops")
print(f"  Classes        : {names}")
print(f"  Test  mAP@50   : {summary['test_mAP50']:.4f}")
print(f"  Test  mAP@50-95: {summary['test_mAP5095']:.4f}")
print(f"  Val   mAP@50   : {summary['val_mAP50']:.4f}")
print(f"  Stage 2 model  : {dst}")
print("="*60)

# if not target_met:
#     print("\n🔍 If below 92%, check in this order:")
#     print("   1. Are crop counts balanced? Check printed distribution above")
#     print("   2. Is val_mAP >> test_mAP? Normal gap is <5%. Larger = distribution shift")
#     print("   3. Collect 100-200 images from YOUR cameras and fine-tune on top of this model")

# print(f"""
# {'='*60}
#   HOW TO USE IN YOUR BACKEND
# {'='*60}
#   You need TWO model files:
#     Stage 1: yolo11x.pt           (COCO, no training, already have it)
#     Stage 2: ppe_stage2_best.pt   (trained here)
#
#   Stage 2 class IDs:
#     0 = helmet    (present = compliant)
#     1 = vest      (present = compliant)
#     2 = Person    (always present in crop)
#
#   Per-person inference logic:
#   stage1 = YOLO('yolo11x.pt')
#   stage2 = YOLO('ppe_stage2_best.pt')
#   results1 = stage1(frame, classes=[0])
#   violations = []
#   for person in results1.boxes:
#       x1, y1, x2, y2 = person.xyxy[0]
#       pw, ph = x2-x1, y2-y1
#       cx1 = max(0,  x1 - pw*0.3)
#       cy1 = max(0,  y1 - ph*0.3)
#       cx2 = min(W,  x2 + pw*0.3)
#       cy2 = min(H,  y2 + ph*0.1)
#       crop = frame[int(cy1):int(cy2), int(cx1):int(cx2)]
#       results2 = stage2(crop)
#       detected = set(int(d.cls) for d in results2.boxes)
#       has_helmet = 0 in detected
#       has_vest   = 1 in detected
#       person_violations = []
#       if not has_helmet: person_violations.append("NO HELMET")
#       if not has_vest:   person_violations.append("NO VEST")
#       violations.append({"person_box": [x1,y1,x2,y2], "violations": person_violations, "compliant": len(person_violations)==0})
# """)