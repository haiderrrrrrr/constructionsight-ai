from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from pathlib import Path
import json, datetime, os

def _draw_image_full_width(c, img_path: Path, margin_inch: float = 0.75):
    try:
        img = ImageReader(str(img_path))
        page_w, page_h = A4
        usable_w = page_w - 2 * margin_inch * inch
        iw, ih = img.getSize()
        scale = usable_w / iw
        draw_w = usable_w
        draw_h = ih * scale
        x = margin_inch * inch
        y = page_h - margin_inch * inch - draw_h
        c.drawImage(img, x, y, width=draw_w, height=draw_h, preserveAspectRatio=True)
        c.setFont("Helvetica", 11)
        c.drawString(x, y - 0.25 * inch, img_path.name)
        c.showPage()
    except Exception:
        pass

def generate_pdf_report(metrics_file, plots_dir, output_pdf):
    data = json.load(open(metrics_file))
    c = canvas.Canvas(str(output_pdf), pagesize=A4)

    # Cover page with metrics
    c.setFont("Helvetica-Bold", 16)
    c.drawString(1*inch, 10.5*inch, "ConstructionSight AI — PPE Training Report")

    c.setFont("Helvetica", 11)
    y = 9.8 * inch
    for k, v in data.items():
        c.drawString(1*inch, y, f"{k}: {v}")
        y -= 0.3*inch

    c.drawString(1*inch, y-0.3*inch, f"Generated: {datetime.datetime.now()}")
    c.showPage()

    plots_dir = Path(plots_dir)
    candidates = []
    exts = {".png", ".jpg", ".jpeg"}
    preferred = [
        "map_curve.png",
        "loss_curve.png",
        "precision_recall_curve.png",
        "lr_curve.png",
        "metrics_overview.png",
        "results.png",
        "confusion_matrix.png",
        "confusion_matrix_normalized.png",
        "BoxPR_curve.png",
        "BoxP_curve.png",
        "BoxR_curve.png",
        "labels.jpg",
        "train_batch0.jpg",
        "train_batch1.jpg",
        "train_batch2.jpg",
    ]

    for name in preferred:
        p = plots_dir / name
        if p.exists():
            candidates.append(p)

    # Add any other images not already included
    for root, _, files in os.walk(plots_dir):
        for f in files:
            p = Path(root) / f
            if p.suffix.lower() in exts and p not in candidates:
                candidates.append(p)

    for img_path in candidates:
        _draw_image_full_width(c, img_path)

    c.save()
