from datetime import datetime
from pathlib import Path
import yaml, json, shutil

def create_run_dirs(model_root: Path, tag: str = "PPE"):
    run_id = datetime.now().strftime("%Y-%m-%d_%H-%M-%S") + f"_{tag}"
    run_dir = model_root / "runs" / run_id
    (run_dir / "artifacts").mkdir(parents=True, exist_ok=True)
    return run_dir, run_id

def save_config_snapshot(run_dir: Path, config: dict):
    with open(run_dir / "config_snapshot.yaml", "w") as f:
        yaml.safe_dump(config, f)

def register_run(model_root: Path, summary: dict):
    reg_file = model_root / "registry.json"
    registry = []
    if reg_file.exists():
        registry = json.load(open(reg_file))
    registry.append(summary)
    with open(reg_file, "w") as f:
        json.dump(registry, f, indent=2)

def move_yolo_outputs(src: Path, dest: Path):
    if src.exists():
        shutil.move(str(src), dest / "artifacts")
