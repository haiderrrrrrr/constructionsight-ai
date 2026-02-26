"""
PPE Safety Compliance Report Generator
Enterprise-grade PDF reports for organizational distribution.

Cover page: cover.png (drawn as-is, no text overlaid)
Content pages: page_template.png as background (logo header already in template)
"""

from __future__ import annotations

import io
import logging
import os
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from typing import Optional

from reportlab.lib.colors import HexColor, white, black
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT, TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm, cm
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame,
    Paragraph, Table, TableStyle,
    Spacer, PageBreak, Image as RLImage, HRFlowable,
    KeepTogether, NextPageTemplate,
)
from reportlab.pdfgen import canvas as rl_canvas
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

_PK_TZ = timezone(timedelta(hours=5), name="PKT")


def _as_pk(dt: Optional[datetime]) -> Optional[datetime]:
    if not dt:
        return dt
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(_PK_TZ)


def _fmt_pk(dt: Optional[datetime], fmt: str = "%d %B %Y, %H:%M") -> str:
    if not dt:
        return "—"
    try:
        return f"{_as_pk(dt).strftime(fmt)} PKT"
    except Exception:
        return str(dt)

# ── Paths ──────────────────────────────────────────────────────────────────────
_TEMPLATES_DIR = os.path.join(os.path.dirname(__file__), "..", "report_templates")
COVER_IMG    = os.path.normpath(os.path.join(_TEMPLATES_DIR, "cover.png"))
CONTENT_IMG  = os.path.normpath(os.path.join(_TEMPLATES_DIR, "page_template.png"))

# ── Page geometry ──────────────────────────────────────────────────────────────
PAGE_W, PAGE_H = A4                # 595.27 x 841.89 pt
MARGIN_LEFT    = 1.8 * cm
MARGIN_RIGHT   = 1.8 * cm
MARGIN_TOP     = 3.2 * cm         # below the header logo in page_template
MARGIN_BOTTOM  = 1.5 * cm
CONTENT_W      = PAGE_W - MARGIN_LEFT - MARGIN_RIGHT

# ── Colours (matching brand: blue #3b5bdb, dark text) ─────────────────────────
C_WHITE      = HexColor("#ffffff")
C_LIGHT      = HexColor("#f1f5f9")
C_BORDER     = HexColor("#d1d5db")
C_TEXT       = HexColor("#111827")
C_MUTED      = HexColor("#6b7280")
C_NAVY       = HexColor("#1e3a5f")
C_BLUE       = HexColor("#3b5bdb")
C_GREEN      = HexColor("#15803d")
C_GREEN_BG   = HexColor("#dcfce7")
C_AMBER      = HexColor("#b45309")
C_AMBER_BG   = HexColor("#fef3c7")
C_RED        = HexColor("#b91c1c")
C_RED_BG     = HexColor("#fee2e2")
C_HEADER_ROW = HexColor("#1e3a5f")
C_ALT_ROW    = HexColor("#f8fafc")


class ReportGenerationError(Exception):
    pass


# ── Terminology helpers ────────────────────────────────────────────────────────

def _fmt_violation(t: str) -> str:
    return {
        "no_helmet":    "Safety Helmet Non-Compliance",
        "no_vest":      "Safety Vest Non-Compliance",
        "both_missing": "Helmet and Vest Non-Compliance",
    }.get(t, t.replace("_", " ").title())

def _fmt_severity(s: str) -> str:
    return {"high": "Critical", "medium": "Moderate", "low": "Minor"}.get(s, s.capitalize() if s else "—")

def _fmt_status(s: str) -> str:
    return {"open": "Pending Review", "acknowledged": "Under Review", "resolved": "Closed"}.get(s, s.capitalize() if s else "—")

def _sev_color(s: str): return {"high": C_RED, "medium": C_AMBER, "low": C_GREEN}.get(s, C_MUTED)
def _sev_bg(s: str):    return {"high": C_RED_BG, "medium": C_AMBER_BG, "low": C_GREEN_BG}.get(s, C_LIGHT)


# ── Image download ─────────────────────────────────────────────────────────────

def _cloudinary_thumbnail_url(url: str) -> str:
    """
    Rewrite a Cloudinary upload URL to request a 500px-wide JPEG at 70% quality.
    Cloudinary performs the resize server-side, so we download ~50-100 KB instead
    of the full-resolution image (often 3-5 MB), avoiding download timeouts.
    Only rewrites cloudinary.com URLs; local /media/ paths are returned unchanged.
    """
    if "res.cloudinary.com" not in url:
        return url
    # Insert transformation after /upload/
    # e.g. .../upload/v123/file.jpg → .../upload/w_500,q_70,f_jpg/v123/file.jpg
    marker = "/upload/"
    idx = url.find(marker)
    if idx == -1:
        return url
    insert_at = idx + len(marker)
    # Skip if transformations already present (don't double-insert)
    rest = url[insert_at:]
    if rest.startswith("w_") or rest.startswith("q_") or rest.startswith("f_"):
        return url
    return url[:insert_at] + "w_500,q_70,f_jpg/" + rest


def _download_image(url: str, max_w: float, max_h: float) -> Optional[RLImage]:
    try:
        if url.startswith("/media/"):
            # Locally-stored file — read from disk instead of HTTP
            from ..core.config import settings
            # Strip leading /media/ and resolve against the appropriate base dir
            rel = url[len("/media/"):]  # e.g. "snapshots/ppe_incidents/5/snapshot.jpg"
            # Determine base dir from first path component
            parts = rel.split("/", 1)
            if parts[0] == "snapshots":
                base = settings.media_snapshots_dir
                rel_path = parts[1] if len(parts) > 1 else ""
            elif parts[0] == "clips":
                base = settings.media_clips_dir
                rel_path = parts[1] if len(parts) > 1 else ""
            else:
                base = "media"
                rel_path = rel
            file_path = os.path.join(base, rel_path)
            with open(file_path, "rb") as f:
                data = f.read()
        else:
            req = urllib.request.Request(url, headers={"User-Agent": "ConstructionSight-Report/1.0"})
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = resp.read()
        img = RLImage(io.BytesIO(data))
        w, h = img.imageWidth, img.imageHeight
        if w and h:
            scale = min(max_w / w, max_h / h)
            img.drawWidth  = w * scale
            img.drawHeight = h * scale
        return img
    except Exception as exc:
        logger.warning("Could not load snapshot %s: %s", url, exc)
        return None


_MAX_IMG_PX = 800  # max dimension for embedded images — keeps PDF small without visible quality loss


def _resize_image_bytes(raw: bytes) -> bytes:
    """Resize image to _MAX_IMG_PX on longest side using Pillow. Returns JPEG bytes. Thread-safe."""
    try:
        from PIL import Image as PilImage
        with PilImage.open(io.BytesIO(raw)) as pil:
            pil = pil.convert("RGB")
            w, h = pil.size
            if max(w, h) > _MAX_IMG_PX:
                scale = _MAX_IMG_PX / max(w, h)
                pil = pil.resize((int(w * scale), int(h * scale)), PilImage.LANCZOS)
            out = io.BytesIO()
            pil.save(out, format="JPEG", quality=82, optimize=True)
            return out.getvalue()
    except Exception as exc:
        logger.warning("Image resize failed, using original: %s", exc)
        return raw


def _fetch_image_bytes(url: str) -> Optional[bytes]:
    """Fetch image bytes, resize to display resolution. Thread-safe.
    For Cloudinary URLs, requests a pre-resized thumbnail to avoid downloading
    large originals (which cause read timeouts). Retries once on failure."""
    try:
        if url.startswith("/media/"):
            from ..core.config import settings
            rel = url[len("/media/"):]
            parts = rel.split("/", 1)
            if parts[0] == "snapshots":
                base, rel_path = settings.media_snapshots_dir, (parts[1] if len(parts) > 1 else "")
            elif parts[0] == "clips":
                base, rel_path = settings.media_clips_dir, (parts[1] if len(parts) > 1 else "")
            else:
                base, rel_path = "media", rel
            with open(os.path.join(base, rel_path), "rb") as f:
                raw = f.read()
            return _resize_image_bytes(raw)

        # Request a server-side resized thumbnail from Cloudinary (much faster)
        fetch_url = _cloudinary_thumbnail_url(url)
        req = urllib.request.Request(fetch_url, headers={"User-Agent": "ConstructionSight-Report/1.0"})
        for attempt in range(2):
            try:
                with urllib.request.urlopen(req, timeout=15) as resp:
                    raw = resp.read()
                return _resize_image_bytes(raw)
            except Exception as exc:
                if attempt == 0:
                    continue  # retry once
                logger.warning("Could not fetch image bytes %s: %s", url, exc)
                return None
    except Exception as exc:
        logger.warning("Could not fetch image bytes %s: %s", url, exc)
        return None


def _make_rl_image(data: Optional[bytes], max_w: float, max_h: float) -> Optional[RLImage]:
    """Create a scaled RLImage from pre-fetched bytes. Not thread-safe — call from main thread."""
    if not data:
        return None
    try:
        img = RLImage(io.BytesIO(data))
        w, h = img.imageWidth, img.imageHeight
        if w and h:
            scale = min(max_w / w, max_h / h)
            img.drawWidth  = w * scale
            img.drawHeight = h * scale
        return img
    except Exception as exc:
        logger.warning("Could not create RLImage from bytes: %s", exc)
        return None


def _prefetch_image_bytes(urls: list, max_workers: int = 8) -> dict:
    """Fetch all unique image URLs in parallel. Returns {url: bytes | None}.
    Capped at 8 workers to avoid Cloudinary rate limiting."""
    unique = list({u for u in urls if u and u.strip()})
    if not unique:
        return {}
    results: dict = {}
    with ThreadPoolExecutor(max_workers=min(max_workers, len(unique))) as pool:
        future_map = {pool.submit(_fetch_image_bytes, u): u for u in unique}
        for future in as_completed(future_map):
            url = future_map[future]
            try:
                results[url] = future.result()
            except Exception:
                results[url] = None
    return results


# ── Page background callbacks ──────────────────────────────────────────────────

def _cover_background(canv, doc):
    """Draw cover.png full-page, no text."""
    if os.path.exists(COVER_IMG):
        canv.drawImage(COVER_IMG, 0, 0, width=PAGE_W, height=PAGE_H,
                       preserveAspectRatio=False)

def _content_background(canv, doc):
    """Draw page_template.png full-page on every content page."""
    if os.path.exists(CONTENT_IMG):
        canv.drawImage(CONTENT_IMG, 0, 0, width=PAGE_W, height=PAGE_H,
                       preserveAspectRatio=False)


# ── Styles ─────────────────────────────────────────────────────────────────────

def _S() -> dict:
    return {
        "section_heading": ParagraphStyle(
            "sh", fontName="Helvetica-Bold", fontSize=14,
            textColor=C_NAVY, leading=18, spaceBefore=14, spaceAfter=6,
        ),
        "sub_heading": ParagraphStyle(
            "subh", fontName="Helvetica-Bold", fontSize=11,
            textColor=C_TEXT, leading=15, spaceBefore=8, spaceAfter=4,
        ),
        "body": ParagraphStyle(
            "body", fontName="Helvetica", fontSize=10,
            textColor=C_TEXT, leading=15, spaceAfter=6, alignment=TA_JUSTIFY,
        ),
        "note": ParagraphStyle(
            "note", fontName="Helvetica-Oblique", fontSize=9,
            textColor=C_MUTED, leading=13, spaceAfter=4,
        ),
        "th": ParagraphStyle(
            "th", fontName="Helvetica-Bold", fontSize=8.5, textColor=C_WHITE, leading=12,
        ),
        "td": ParagraphStyle(
            "td", fontName="Helvetica", fontSize=8.5, textColor=C_TEXT, leading=12,
        ),
        "td_sm": ParagraphStyle(
            "td_sm", fontName="Helvetica", fontSize=7.5, textColor=C_TEXT, leading=11,
        ),
        "caption": ParagraphStyle(
            "caption", fontName="Helvetica-Oblique", fontSize=8,
            textColor=C_MUTED, leading=11, alignment=TA_CENTER, spaceAfter=6,
        ),
        "closing": ParagraphStyle(
            "closing", fontName="Helvetica-Oblique", fontSize=8.5,
            textColor=C_MUTED, leading=13, spaceAfter=4, alignment=TA_CENTER,
        ),
    }


def _tbl_style(extra=None):
    base = [
        ("BACKGROUND",     (0, 0), (-1, 0),  C_HEADER_ROW),
        ("TEXTCOLOR",      (0, 0), (-1, 0),  C_WHITE),
        ("FONTNAME",       (0, 0), (-1, 0),  "Helvetica-Bold"),
        ("FONTSIZE",       (0, 0), (-1, 0),  8.5),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [C_WHITE, C_ALT_ROW]),
        ("GRID",           (0, 0), (-1, -1), 0.4, C_BORDER),
        ("TOPPADDING",     (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING",  (0, 0), (-1, -1), 5),
        ("LEFTPADDING",    (0, 0), (-1, -1), 6),
        ("RIGHTPADDING",   (0, 0), (-1, -1), 6),
        ("FONTSIZE",       (0, 1), (-1, -1), 8),
        ("VALIGN",         (0, 0), (-1, -1), "MIDDLE"),
    ]
    if extra:
        base.extend(extra)
    return TableStyle(base)


# ── Main ───────────────────────────────────────────────────────────────────────

def generate_ppe_pdf_report(
    db: Session,
    project_id: int,
    period_start: datetime,
    period_end: datetime,
    triggered_by: str = "scheduled",
) -> bytes:
    from app.models.project import Project
    from app.models.ppe_incident import PpeIncident
    from app.models.camera import Camera

    try:
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise ReportGenerationError(f"Project {project_id} not found.")

        incidents = (
            db.query(PpeIncident)
            .filter(
                PpeIncident.project_id == project_id,
                PpeIncident.started_at >= period_start,
                PpeIncident.started_at <= period_end,
            )
            .order_by(PpeIncident.started_at.desc())
            .all()
        )

        cam_ids = {i.camera_id for i in incidents if i.camera_id}
        cam_map: dict[int, str] = {}
        if cam_ids:
            cams = db.query(Camera).filter(Camera.id.in_(cam_ids)).all()
            cam_map = {c.id: c.name for c in cams}

        total        = len(incidents)
        resolved     = sum(1 for i in incidents if i.status == "resolved")
        acknowledged = sum(1 for i in incidents if i.status == "acknowledged")
        open_count   = sum(1 for i in incidents if i.status == "open")
        critical_count = sum(1 for i in incidents if i.severity == "high")
        moderate_count = sum(1 for i in incidents if i.severity == "medium")
        minor_count    = sum(1 for i in incidents if i.severity == "low")
        helmet_v = sum(1 for i in incidents if i.incident_type in ("no_helmet", "both_missing"))
        vest_v   = sum(1 for i in incidents if i.incident_type in ("no_vest",   "both_missing"))

        zone_stats: dict[str, dict] = defaultdict(lambda: {"total": 0, "open": 0, "critical": 0})
        for inc in incidents:
            z = inc.zone_name or "Unspecified Area"
            zone_stats[z]["total"] += 1
            if inc.status == "open":      zone_stats[z]["open"]     += 1
            if inc.severity == "high":    zone_stats[z]["critical"] += 1

        worker_incidents: dict[str, list] = defaultdict(list)
        for inc in incidents:
            pid = str(inc.global_person_id or inc.track_id or "Unidentified")
            worker_incidents[pid].append(inc)

        workers_count  = len(worker_incidents)
        compliance_pct = round(resolved / total * 100) if total else 100
        gen_dt         = datetime.now(timezone.utc)
        period_str     = f"{_as_pk(period_start).strftime('%d %B %Y')} to {_as_pk(period_end).strftime('%d %B %Y')}"

        # ── Document setup with two page templates ─────────────────────────────
        buf = io.BytesIO()

        # Cover frame (unused — cover page has no flowable content)
        cover_frame = Frame(0, 0, PAGE_W, PAGE_H, leftPadding=0, rightPadding=0,
                            topPadding=0, bottomPadding=0, id="cover_frame")

        # Content frame — sits below the header logo in page_template.png
        content_frame = Frame(
            MARGIN_LEFT,
            MARGIN_BOTTOM,
            CONTENT_W,
            PAGE_H - MARGIN_TOP - MARGIN_BOTTOM,
            leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0,
            id="content_frame",
        )

        cover_tpl   = PageTemplate(id="Cover",   frames=[cover_frame],   onPage=_cover_background)
        content_tpl = PageTemplate(id="Content", frames=[content_frame], onPage=_content_background)

        doc = BaseDocTemplate(
            buf,
            pagesize=A4,
            pageTemplates=[cover_tpl, content_tpl],
            title=f"PPE Safety Compliance Report — {project.name}",
            author="ConstructionSight-AI",
        )

        S = _S()
        story = []

        # ── PAGE 1: Cover (blank flowable — background drawn by callback) ──────
        story.append(NextPageTemplate("Content"))
        story.append(PageBreak())

        # ══════════════════════════════════════════════════════════════════════
        # SECTION 1 — REPORT HEADER INFO (project details)
        # ══════════════════════════════════════════════════════════════════════
        story.append(Paragraph("PPE Safety Compliance Report", ParagraphStyle(
            "rpt_title", fontName="Helvetica-Bold", fontSize=16,
            textColor=C_NAVY, leading=20, spaceAfter=4,
        )))
        story.append(HRFlowable(width=CONTENT_W, thickness=2, color=C_BLUE, spaceAfter=8))

        m_lbl = ParagraphStyle("ml", fontName="Helvetica-Bold", fontSize=9.5, textColor=C_TEXT)
        m_val = ParagraphStyle("mv", fontName="Helvetica",      fontSize=9.5, textColor=C_TEXT)
        status_text = ("COMPLIANT" if compliance_pct >= 90
                       else "PARTIALLY COMPLIANT" if compliance_pct >= 70
                       else "NON-COMPLIANT — IMMEDIATE ACTION REQUIRED")
        meta_rows = [
            [Paragraph("Project",   m_lbl), Paragraph(project.name, m_val)],
            [Paragraph("Period",    m_lbl), Paragraph(period_str, m_val)],
            [Paragraph("Generated", m_lbl), Paragraph(_fmt_pk(gen_dt), m_val)],
            [Paragraph("Status",    m_lbl), Paragraph(status_text, m_val)],
        ]
        if hasattr(project, "client_name") and project.client_name:
            meta_rows.insert(1, [Paragraph("Client",   m_lbl), Paragraph(project.client_name, m_val)])
        if hasattr(project, "location") and project.location:
            meta_rows.insert(1, [Paragraph("Location", m_lbl), Paragraph(project.location, m_val)])

        # status row colour
        if compliance_pct >= 90:
            status_color, status_bg = C_GREEN, C_GREEN_BG
        elif compliance_pct >= 70:
            status_color, status_bg = C_AMBER, C_AMBER_BG
        else:
            status_color, status_bg = C_RED, C_RED_BG

        status_row_idx = len(meta_rows) - 1  # Status is always the last row

        meta_tbl = Table(meta_rows, colWidths=[CONTENT_W * 0.25, CONTENT_W * 0.75])
        # Re-render status cell with correct colour
        m_stat = ParagraphStyle("ms", fontName="Helvetica-Bold", fontSize=9.5, textColor=status_color)
        meta_rows[status_row_idx][1] = Paragraph(status_text, m_stat)
        meta_extra = [
            ("BACKGROUND", (0, status_row_idx), (-1, status_row_idx), status_bg),
        ]
        meta_tbl.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (0, -1), C_LIGHT),
            ("FONTNAME",      (0, 0), (0, -1), "Helvetica-Bold"),
            ("FONTSIZE",      (0, 0), (-1, -1), 9.5),
            ("TOPPADDING",    (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LEFTPADDING",   (0, 0), (-1, -1), 8),
            ("GRID",          (0, 0), (-1, -1), 0.4, C_BORDER),
            ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ] + meta_extra))
        story.append(meta_tbl)
        story.append(Spacer(1, 0.5 * cm))

        # ══════════════════════════════════════════════════════════════════════
        # SECTION 2 — EXECUTIVE SUMMARY
        # ══════════════════════════════════════════════════════════════════════
        story.append(Paragraph("Executive Summary", S["section_heading"]))
        story.append(HRFlowable(width=CONTENT_W, thickness=1, color=C_BORDER, spaceAfter=6))

        if total == 0:
            summary = (
                "During the period under review, <b>no PPE compliance violations were recorded</b> "
                "across any monitoring zones or cameras on this project. All personnel observed "
                "were found to be wearing the required personal protective equipment at all times. "
                "This reflects excellent safety culture and discipline on site."
            )
        else:
            summary = (
                f"The automated monitoring system recorded a total of <b>{total} PPE compliance "
                f"incident{'s' if total != 1 else ''}</b> involving <b>{workers_count} "
                f"worker{'s' if workers_count != 1 else ''}</b> over the period {period_str}. "
            )
            if compliance_pct >= 90:
                summary += f"Of these, {resolved} ({compliance_pct}%) have been reviewed and closed, indicating a strong safety management response. "
            elif compliance_pct >= 60:
                summary += f"To date, {resolved} incidents ({compliance_pct}%) have been closed. {open_count} remain open and require attention. "
            else:
                summary += f"{'No' if resolved == 0 else str(resolved)} incidents ({compliance_pct}%) have been resolved. <b>{open_count} remain open and require immediate management attention.</b> "
            if critical_count > 0:
                summary += f"{'All' if critical_count == total else str(critical_count)} incident{'s were' if critical_count != 1 else ' was'} classified as Critical severity, requiring immediate follow-up."

        story.append(Paragraph(summary, S["body"]))
        story.append(Spacer(1, 0.4 * cm))

        # ── KPI row (only when there is data) ─────────────────────────────────
        if total > 0:
            kv = ParagraphStyle("kv", fontName="Helvetica-Bold", fontSize=20, textColor=C_NAVY,  alignment=TA_CENTER)
            kl = ParagraphStyle("kl", fontName="Helvetica",      fontSize=8,  textColor=C_MUTED, alignment=TA_CENTER)
            kv_crit = ParagraphStyle("kvc", fontName="Helvetica-Bold", fontSize=20,
                                     textColor=C_RED if critical_count else C_MUTED, alignment=TA_CENTER)
            kv_open = ParagraphStyle("kvo", fontName="Helvetica-Bold", fontSize=20,
                                     textColor=C_AMBER if open_count else C_MUTED, alignment=TA_CENTER)
            kv_res  = ParagraphStyle("kvr", fontName="Helvetica-Bold", fontSize=20,
                                     textColor=C_GREEN if compliance_pct >= 80 else C_RED, alignment=TA_CENTER)

            kpi_tbl = Table(
                [
                    [Paragraph(str(total),          kv),
                     Paragraph(str(critical_count), kv_crit),
                     Paragraph(str(open_count),     kv_open),
                     Paragraph(str(resolved),       kv_res),
                     Paragraph(str(workers_count),  kv)],
                    [Paragraph("Total Incidents",         kl),
                     Paragraph("Critical",                kl),
                     Paragraph("Open",          kl),
                     Paragraph(f"Resolved ({compliance_pct}%)", kl),
                     Paragraph("Workers Involved",        kl)],
                ],
                colWidths=[CONTENT_W / 5] * 5,
            )
            kpi_tbl.setStyle(TableStyle([
                ("BACKGROUND",    (0, 0), (-1, -1), C_LIGHT),
                ("BOX",           (0, 0), (-1, -1), 0.5, C_BORDER),
                ("TOPPADDING",    (0, 0), (-1, -1), 10),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
            ]))
            story.append(kpi_tbl)
            story.append(Spacer(1, 0.5 * cm))

        # ══════════════════════════════════════════════════════════════════════
        # SECTION 3 — VIOLATION BREAKDOWN
        # ══════════════════════════════════════════════════════════════════════
        if total > 0:
            story.append(Paragraph("Violation Breakdown", S["section_heading"]))
            story.append(HRFlowable(width=CONTENT_W, thickness=1, color=C_BORDER, spaceAfter=6))

            viol_data = [[
                Paragraph("Violation Category",        S["th"]),
                Paragraph("Incidents",                 S["th"]),
                Paragraph("% of Total",                S["th"]),
                Paragraph("Critical",                  S["th"]),
                Paragraph("Moderate",                  S["th"]),
                Paragraph("Minor",                     S["th"]),
            ]]
            for v_label, v_code in [
                ("Safety Helmet Non-Compliance",  "no_helmet"),
                ("Safety Vest Non-Compliance",    "no_vest"),
                ("Helmet and Vest Non-Compliance","both_missing"),
            ]:
                rel = [i for i in incidents if i.incident_type == v_code]
                if not rel:
                    continue
                cnt  = len(rel)
                pct  = round(cnt / total * 100)
                crit = sum(1 for i in rel if i.severity == "high")
                mod  = sum(1 for i in rel if i.severity == "medium")
                mnr  = sum(1 for i in rel if i.severity == "low")
                viol_data.append([
                    Paragraph(v_label,          S["td"]),
                    Paragraph(str(cnt),         S["td"]),
                    Paragraph(f"{pct}%",        S["td"]),
                    Paragraph(str(crit) if crit else "—", S["td"]),
                    Paragraph(str(mod)  if mod  else "—", S["td"]),
                    Paragraph(str(mnr)  if mnr  else "—", S["td"]),
                ])

            viol_tbl = Table(viol_data,
                             colWidths=[CONTENT_W * f for f in [0.36, 0.12, 0.12, 0.13, 0.13, 0.14]])
            viol_tbl.setStyle(_tbl_style())
            story.append(viol_tbl)
            story.append(Spacer(1, 0.5 * cm))

        # ══════════════════════════════════════════════════════════════════════
        # SECTION 4 — ZONE SUMMARY
        # ══════════════════════════════════════════════════════════════════════
        if zone_stats:
            story.append(Paragraph("Zone-by-Zone Summary", S["section_heading"]))
            story.append(HRFlowable(width=CONTENT_W, thickness=1, color=C_BORDER, spaceAfter=6))

            zone_data = [[
                Paragraph("Work Zone / Area",  S["th"]),
                Paragraph("Total Incidents",   S["th"]),
                Paragraph("Open",              S["th"]),
                Paragraph("Critical",          S["th"]),
                Paragraph("Risk Level",        S["th"]),
            ]]
            for zn, zs in sorted(zone_stats.items(), key=lambda x: x[1]["total"], reverse=True):
                risk = "High" if (zs["critical"] >= 3 or (zs["open"] > zs["total"] * 0.5 and zs["total"] >= 3)) \
                       else "Medium" if (zs["critical"] >= 1 or zs["open"] >= 2) else "Low"
                zone_data.append([
                    Paragraph(zn,                                        S["td"]),
                    Paragraph(str(zs["total"]),                          S["td"]),
                    Paragraph(str(zs["open"])     if zs["open"]     else "—", S["td"]),
                    Paragraph(str(zs["critical"]) if zs["critical"] else "—", S["td"]),
                    Paragraph(risk,                                      S["td"]),
                ])
            zone_tbl = Table(zone_data,
                             colWidths=[CONTENT_W * f for f in [0.38, 0.16, 0.12, 0.12, 0.22]])
            zone_tbl.setStyle(_tbl_style())
            story.append(zone_tbl)
            story.append(Spacer(1, 0.5 * cm))

        # ══════════════════════════════════════════════════════════════════════
        # SECTION 5 — COMPLETE INCIDENT LOG
        # ══════════════════════════════════════════════════════════════════════
        if total > 0:
            story.append(PageBreak())
            story.append(Paragraph("Complete Incident Log", S["section_heading"]))
            story.append(HRFlowable(width=CONTENT_W, thickness=1, color=C_BORDER, spaceAfter=6))
            story.append(Spacer(1, 4))

            log_data = [[
                Paragraph("Timestamp (PKT)",  S["th"]),
                Paragraph("Violation",          S["th"]),
                Paragraph("Zone",               S["th"]),
                Paragraph("Camera",             S["th"]),
                Paragraph("Worker ID",          S["th"]),
                Paragraph("Severity",           S["th"]),
                Paragraph("Status",             S["th"]),
            ]]
            sev_extras = []
            for row_idx, inc in enumerate(incidents, start=1):
                cam_name = cam_map.get(inc.camera_id, f"Camera {inc.camera_id}") if inc.camera_id else "—"
                log_data.append([
                    Paragraph(_as_pk(inc.created_at).strftime("%d %b %Y\n%H:%M") if inc.created_at else "—", S["td_sm"]),
                    Paragraph(_fmt_violation(inc.incident_type), S["td_sm"]),
                    Paragraph(inc.zone_name or "Unspecified",    S["td_sm"]),
                    Paragraph(cam_name,                          S["td_sm"]),
                    Paragraph(str(inc.global_person_id or inc.track_id or "—"), S["td_sm"]),
                    Paragraph(_fmt_severity(inc.severity),       S["td_sm"]),
                    Paragraph(_fmt_status(inc.status),           S["td_sm"]),
                ])
                bg = _sev_bg(inc.severity)
                sev_extras += [
                    ("BACKGROUND", (5, row_idx), (5, row_idx), bg),
                    ("TEXTCOLOR",  (5, row_idx), (5, row_idx), _sev_color(inc.severity)),
                    ("FONTNAME",   (5, row_idx), (5, row_idx), "Helvetica-Bold"),
                ]

            log_tbl = Table(log_data,
                            colWidths=[CONTENT_W * f for f in [0.16, 0.22, 0.17, 0.14, 0.10, 0.10, 0.11]],
                            repeatRows=1)
            log_tbl.setStyle(_tbl_style(sev_extras))
            story.append(log_tbl)

        # ══════════════════════════════════════════════════════════════════════
        # SECTION 6 — WORKER INCIDENT DETAIL CARDS
        # ══════════════════════════════════════════════════════════════════════
        if worker_incidents:
            story.append(PageBreak())
            story.append(Paragraph("Worker Incident Details", S["section_heading"]))
            story.append(HRFlowable(width=CONTENT_W, thickness=1, color=C_BORDER, spaceAfter=6))
            story.append(Paragraph(
                "Detailed account of each worker involved in a PPE compliance incident during the reporting period.",
                S["body"],
            ))

            for worker_id, w_incs in sorted(worker_incidents.items(), key=lambda x: len(x[1]), reverse=True):
                w_total = len(w_incs)
                w_crit  = sum(1 for i in w_incs if i.severity == "high")
                w_open  = sum(1 for i in w_incs if i.status == "open")
                w_zones = sorted({i.zone_name or "Unspecified" for i in w_incs})
                w_cams  = sorted({cam_map.get(i.camera_id, f"Camera {i.camera_id}") for i in w_incs if i.camera_id})
                w_types = sorted({_fmt_violation(i.incident_type) for i in w_incs})
                first_i = min(w_incs, key=lambda i: i.created_at or datetime.min.replace(tzinfo=timezone.utc))
                last_i  = max(w_incs, key=lambda i: i.created_at or datetime.min.replace(tzinfo=timezone.utc))

                td9 = ParagraphStyle("td9", fontName="Helvetica", fontSize=9, textColor=C_TEXT, leading=13)
                td9b = ParagraphStyle("td9b", fontName="Helvetica-Bold", fontSize=9, textColor=C_TEXT, leading=13)
                card_tbl = Table([
                    [Paragraph("Worker Identifier", td9b), Paragraph(str(worker_id), td9)],
                    [Paragraph("Total Incidents",   td9b), Paragraph(str(w_total), td9)],
                    [Paragraph("Open Incidents",    td9b), Paragraph(str(w_open) if w_open else "None", td9)],
                    [Paragraph("Critical",          td9b), Paragraph(str(w_crit) if w_crit else "None", td9)],
                    [Paragraph("Violation Types",   td9b), Paragraph(", ".join(w_types), td9)],
                    [Paragraph("Zones",     td9b), Paragraph(", ".join(w_zones), td9)],
                    [Paragraph("Cameras",           td9b), Paragraph(", ".join(w_cams) if w_cams else "—", td9)],
                    [Paragraph("First Incident",    td9b), Paragraph(_fmt_pk(first_i.created_at) if first_i.created_at else "—", td9)],
                    [Paragraph("Last Incident",     td9b), Paragraph(_fmt_pk(last_i.created_at)  if last_i.created_at else "—", td9)],
                ], colWidths=[CONTENT_W * 0.30, CONTENT_W * 0.70])
                card_tbl.setStyle(TableStyle([
                    ("BACKGROUND",    (0, 0), (0, -1), C_LIGHT),
                    ("FONTNAME",      (0, 0), (0, -1), "Helvetica-Bold"),
                    ("FONTSIZE",      (0, 0), (-1, -1), 9),
                    ("TOPPADDING",    (0, 0), (-1, -1), 6),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                    ("LEFTPADDING",   (0, 0), (-1, -1), 8),
                    ("GRID",          (0, 0), (-1, -1), 0.4, C_BORDER),
                    ("VALIGN",        (0, 0), (-1, -1), "TOP"),
                ]))

                pw_data = [[
                    Paragraph("Timestamp (PKT)", S["th"]),
                    Paragraph("Violation",         S["th"]),
                    Paragraph("Zone",              S["th"]),
                    Paragraph("Camera",            S["th"]),
                    Paragraph("Severity",          S["th"]),
                    Paragraph("Status",            S["th"]),
                ]]
                for inc in sorted(w_incs, key=lambda i: i.created_at or datetime.min.replace(tzinfo=timezone.utc), reverse=True):
                    pw_data.append([
                        Paragraph(_as_pk(inc.created_at).strftime("%d %b %Y\n%H:%M") if inc.created_at else "—", S["td_sm"]),
                        Paragraph(_fmt_violation(inc.incident_type), S["td_sm"]),
                        Paragraph(inc.zone_name or "Unspecified",    S["td_sm"]),
                        Paragraph(cam_map.get(inc.camera_id, f"Camera {inc.camera_id}") if inc.camera_id else "—", S["td_sm"]),
                        Paragraph(_fmt_severity(inc.severity),       S["td_sm"]),
                        Paragraph(_fmt_status(inc.status),           S["td_sm"]),
                    ])
                pw_tbl = Table(pw_data,
                               colWidths=[CONTENT_W * f for f in [0.18, 0.26, 0.18, 0.16, 0.12, 0.10]])
                pw_tbl.setStyle(_tbl_style())

                w_hdr_s = ParagraphStyle(
                    f"wh_{worker_id}", fontName="Helvetica-Bold", fontSize=11,
                    textColor=C_WHITE, alignment=TA_LEFT,
                )
                hdr_tbl = Table(
                    [[Paragraph(f"Worker ID: {worker_id}  —  {w_total} Incident{'s' if w_total != 1 else ''}", w_hdr_s)]],
                    colWidths=[CONTENT_W],
                )
                hdr_tbl.setStyle(TableStyle([
                    ("BACKGROUND",    (0, 0), (-1, -1), C_NAVY),
                    ("TOPPADDING",    (0, 0), (-1, -1), 8),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                    ("LEFTPADDING",   (0, 0), (-1, -1), 10),
                ]))

                story.append(KeepTogether([
                    hdr_tbl, Spacer(1, 3),
                    card_tbl, Spacer(1, 4),
                    pw_tbl, Spacer(1, 14),
                ]))

        # ══════════════════════════════════════════════════════════════════════
        # SECTION 7 — RECOMMENDATIONS
        # ══════════════════════════════════════════════════════════════════════
        story.append(PageBreak())
        story.append(Paragraph("Recommendations", S["section_heading"]))
        story.append(HRFlowable(width=CONTENT_W, thickness=1, color=C_BORDER, spaceAfter=6))

        recs = []
        if total == 0:
            recs.append(("Maintain Current Standards",
                "No violations were detected during this period. Continue enforcing existing PPE "
                "protocols and conduct regular toolbox talks to sustain this level of compliance."))
        else:
            if critical_count > 0:
                recs.append(("Immediate Action — Critical Incidents",
                    f"{critical_count} incident{'s were' if critical_count != 1 else ' was'} classified as Critical. "
                    "Each must be reviewed by the Site Supervisor or Safety Officer within 24 hours. "
                    "Affected workers must receive immediate safety briefings before returning to the relevant zone."))
            if open_count > 0:
                recs.append(("Close Outstanding Incidents",
                    f"{open_count} incident{'s remain' if open_count != 1 else ' remains'} open. "
                    "The Project Manager should assign responsibility for reviewing and closing each "
                    "outstanding incident within five (5) working days."))
            if helmet_v > 0:
                recs.append(("Safety Helmet Compliance",
                    f"{helmet_v} safety helmet violation{'s were' if helmet_v != 1 else ' was'} recorded. "
                    "Review helmet availability, condition, and sizing. Reinforce requirements at all "
                    "site entrances and during daily briefings."))
            if vest_v > 0:
                recs.append(("Safety Vest Compliance",
                    f"{vest_v} safety vest violation{'s were' if vest_v != 1 else ' was'} recorded. "
                    "Ensure adequate vest inventory is available at all site access points."))
            if zone_stats:
                top_zone = max(zone_stats, key=lambda z: zone_stats[z]["total"])
                recs.append(("High-Risk Zone Focus",
                    f"The zone '{top_zone}' recorded the highest number of violations. "
                    "Consider increasing supervisor presence and installing additional signage in this area."))
            if workers_count >= 5:
                recs.append(("Worker Training Programme",
                    f"{workers_count} workers were involved in incidents. A structured PPE refresher "
                    "training session is recommended for all site personnel."))
            if compliance_pct < 70:
                recs.append(("Escalation to Senior Management",
                    f"The overall resolution rate of {compliance_pct}% is below the acceptable threshold. "
                    "A corrective action plan with defined targets and timelines should be developed."))
        recs.append(("Continued Monitoring",
            "Maintain regular automated PPE monitoring. Review reports weekly to track trends over time. "
            "Recognize compliant teams to reinforce safety standards across the site."))

        for idx, (title, detail) in enumerate(recs, 1):
            story.append(Paragraph(f"{idx}. {title}", S["sub_heading"]))
            story.append(Paragraph(detail, S["body"]))

        # ══════════════════════════════════════════════════════════════════════
        # SECTION 8 — INCIDENT SNAPSHOTS
        # ══════════════════════════════════════════════════════════════════════
        snap_incs = [i for i in incidents if i.snapshot_url and i.snapshot_url.strip()]
        if snap_incs:
            story.append(PageBreak())
            story.append(Paragraph("Incident Snapshots", S["section_heading"]))
            story.append(HRFlowable(width=CONTENT_W, thickness=1, color=C_BORDER, spaceAfter=6))
            story.append(Paragraph(
                "Snapshots automatically captured by the monitoring system at the time of each incident.",
                S["body"],
            ))
            story.append(Spacer(1, 0.3 * cm))

            MAX_W = (CONTENT_W - 1 * cm) / 2
            MAX_H = 6.5 * cm

            # Pre-fetch all snapshot bytes in parallel before PDF assembly
            all_snap_urls = [i.snapshot_url for i in snap_incs]
            image_bytes_cache = _prefetch_image_bytes(all_snap_urls, max_workers=min(8, len(all_snap_urls)))

            for pair in [snap_incs[i:i+2] for i in range(0, len(snap_incs), 2)]:
                row_cells = []
                for inc in pair:
                    cam_lbl = cam_map.get(inc.camera_id, f"Camera {inc.camera_id}") if inc.camera_id else "Unknown"
                    ts_lbl  = _fmt_pk(inc.created_at, "%d %b %Y, %H:%M") if inc.created_at else "—"
                    w_lbl   = str(inc.global_person_id or inc.track_id or "Unidentified")
                    img     = _make_rl_image(image_bytes_cache.get(inc.snapshot_url), MAX_W, MAX_H)
                    cap     = Paragraph(
                        f"<b>Worker:</b> {w_lbl}  |  <b>Zone:</b> {inc.zone_name or 'Unspecified'}  |  "
                        f"<b>Camera:</b> {cam_lbl}<br/>"
                        f"<b>Violation:</b> {_fmt_violation(inc.incident_type)}  |  "
                        f"<b>Severity:</b> {_fmt_severity(inc.severity)}  |  {ts_lbl}",
                        S["caption"],
                    )
                    if img:
                        row_cells.append([img, cap])
                    else:
                        row_cells.append([
                            Spacer(1, 2 * cm),
                            Paragraph("[Image unavailable]", ParagraphStyle(
                                "ph", fontName="Helvetica-Oblique", fontSize=9,
                                textColor=C_MUTED, alignment=TA_CENTER)),
                            Spacer(1, 2 * cm),
                            cap,
                        ])
                if len(row_cells) == 1:
                    row_cells.append([Spacer(1, 1)])
                photo_row = Table([row_cells],
                                  colWidths=[CONTENT_W / 2 - 5, CONTENT_W / 2 - 5])
                photo_row.setStyle(TableStyle([
                    ("VALIGN",        (0, 0), (-1, -1), "TOP"),
                    ("TOPPADDING",    (0, 0), (-1, -1), 6),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                    ("LEFTPADDING",   (0, 0), (-1, -1), 4),
                    ("RIGHTPADDING",  (0, 0), (-1, -1), 4),
                    ("BOX",           (0, 0), (0, -1), 0.4, C_BORDER),
                    ("BOX",           (1, 0), (1, -1), 0.4, C_BORDER),
                ]))
                story.append(photo_row)
                story.append(Spacer(1, 0.3 * cm))

        # ── Closing line (once, at very end) ───────────────────────────────────
        story.append(Spacer(1, 1 * cm))
        story.append(HRFlowable(width=CONTENT_W, thickness=0.5, color=C_BORDER, spaceAfter=6))
        story.append(Paragraph(
            f"This report was automatically generated by ConstructionSight AI Safety Monitoring System "
            f"on {_fmt_pk(gen_dt, '%d %B %Y at %H:%M')}. Data is generated through automated AI analysis "
            f"and should be reviewed by a qualified safety professional. CONFIDENTIAL — authorised personnel only.",
            S["closing"],
        ))

        doc.build(story)
        buf.seek(0)
        return buf.read()

    except ReportGenerationError:
        raise
    except Exception as exc:
        logger.error("PDF generation failed for project %s: %s", project_id, exc, exc_info=True)
        raise ReportGenerationError(f"PDF generation failed: {exc}") from exc


# ── Workforce Analytics PDF ────────────────────────────────────────────────────

def generate_workforce_pdf_report(
    db: Session,
    project_id: int,
    period_start: datetime,
    period_end: datetime,
    triggered_by: str = "scheduled",
) -> bytes:
    from app.models.project import Project
    from app.models.workforce_snapshot import WorkforceSnapshot
    from app.models.workforce_alert import WorkforceAlert
    from app.models.workforce_zone_settings import WorkforceZoneSettings
    from app.models.camera import Camera

    try:
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise ReportGenerationError(f"Project {project_id} not found.")

        snapshots = (
            db.query(WorkforceSnapshot)
            .filter(
                WorkforceSnapshot.project_id == project_id,
                WorkforceSnapshot.recorded_at >= period_start,
                WorkforceSnapshot.recorded_at <= period_end,
            )
            .order_by(WorkforceSnapshot.recorded_at.asc())
            .all()
        )

        alerts = (
            db.query(WorkforceAlert)
            .filter(
                WorkforceAlert.project_id == project_id,
                WorkforceAlert.triggered_at >= period_start,
                WorkforceAlert.triggered_at <= period_end,
            )
            .order_by(WorkforceAlert.triggered_at.desc())
            .all()
        )

        # Required workers setting (project-level row has camera_id IS NULL)
        wf_settings = (
            db.query(WorkforceZoneSettings)
            .filter(
                WorkforceZoneSettings.project_id == project_id,
                WorkforceZoneSettings.camera_id == None,
            )
            .first()
        )
        required_workers = (wf_settings.required_workers if wf_settings else None) or 2

        # Camera name map
        cam_ids = {s.camera_id for s in snapshots} | {a.camera_id for a in alerts}
        cam_map: dict[int, str] = {}
        if cam_ids:
            cams = db.query(Camera).filter(Camera.id.in_(cam_ids)).all()
            cam_map = {c.id: (c.name or f"Camera {c.id}") for c in cams}

        # ── Aggregate summary ──────────────────────────────────────────────────
        total_snaps     = len(snapshots)
        peak_workers    = max((s.worker_count for s in snapshots), default=0)
        avg_workers     = (sum(s.worker_count for s in snapshots) / total_snaps) if total_snaps else 0.0
        avg_utilization = (sum(s.utilization_score for s in snapshots) / total_snaps) if total_snaps else 0.0
        avg_idle_ratio  = (
            sum((s.idle_count / s.worker_count * 100) if s.worker_count else 0.0 for s in snapshots) / total_snaps
        ) if total_snaps else 0.0
        congestion_events = sum(1 for s in snapshots if s.congestion_flag)
        avg_dwell = (
            sum(s.avg_dwell_seconds for s in snapshots if s.avg_dwell_seconds) /
            max(sum(1 for s in snapshots if s.avg_dwell_seconds), 1)
        ) if snapshots else 0.0

        def _fmt_dwell(secs):
            if not secs: return "—"
            m = int(secs // 60); s2 = int(secs % 60)
            return f"{m}m {s2}s" if s2 else f"{m}m"

        # ── Zone breakdown ─────────────────────────────────────────────────────
        zone_data: dict[str, dict] = defaultdict(lambda: {
            "count": 0, "workers": [], "utilization": [], "idle_ratio": [], "congestion": 0
        })
        for s in snapshots:
            z = s.zone_name or "Unspecified Zone"
            zone_data[z]["count"] += 1
            zone_data[z]["workers"].append(s.worker_count)
            zone_data[z]["utilization"].append(s.utilization_score)
            idle_r = (s.idle_count / s.worker_count * 100) if s.worker_count else 0.0
            zone_data[z]["idle_ratio"].append(idle_r)
            if s.congestion_flag: zone_data[z]["congestion"] += 1

        # ── Hourly / daily timeline ────────────────────────────────────────────
        period_hours_wf = (period_end - period_start).total_seconds() / 3600
        use_daily_wf = period_hours_wf > 48
        wf_hourly: dict[str, list] = defaultdict(list)
        for s in snapshots:
            key = _as_pk(s.recorded_at).strftime("%d %b %Y" if use_daily_wf else "%d %b %Y %H:00")
            wf_hourly[key].append(s)

        # ── Per-camera alert detail ────────────────────────────────────────────
        wf_cam_alert_detail: dict[int, list] = defaultdict(list)
        for a in alerts:
            wf_cam_alert_detail[a.camera_id].append(a)

        # ── Alert type counts for recommendations ──────────────────────────────
        wf_alert_type_counts: dict[str, int] = defaultdict(int)
        for a in alerts:
            wf_alert_type_counts[a.alert_type] += 1

        # ── Efficiency score — exact same formula as WorkforceEfficiencyScore dashboard component ──
        # Staffing: avg workers vs required_workers
        staffing_comp   = min(100, round(avg_workers / (required_workers or 1) * 100))
        # Activity: active (non-idle) workers as % of total workers, averaged across snapshots
        active_rate     = round(min(100 - avg_idle_ratio, 100))
        # Insight-Free: only understaffed + idle_ratio_high alerts penalise this component (×5 each)
        threshold_alerts = sum(1 for a in alerts if a.alert_type in ("understaffed", "idle_ratio_high"))
        alert_free_pct  = max(0, 100 - min(100, threshold_alerts * 5))
        # Stability: congestion-free rate (each congestion event removes 25 points)
        cong_free_pct   = 100 if congestion_events == 0 else max(0, 100 - congestion_events * 25)
        efficiency_total = min(100, round(
            staffing_comp  * 0.40 +
            active_rate    * 0.30 +
            alert_free_pct * 0.20 +
            cong_free_pct  * 0.10
        ))
        # Labels match dashboard: >=70 EXCELLENT, >=40 ADEQUATE, else CRITICAL
        eff_label = ("EXCELLENT" if efficiency_total >= 70 else "ADEQUATE" if efficiency_total >= 40 else "CRITICAL")
        has_data = total_snaps > 0

        gen_dt     = datetime.now(timezone.utc)
        period_str = f"{_as_pk(period_start).strftime('%d %B %Y')} to {_as_pk(period_end).strftime('%d %B %Y')}"
        S          = _S()

        # ── Document setup — identical pattern to PPE ──────────────────────────
        buf = io.BytesIO()
        cover_frame = Frame(0, 0, PAGE_W, PAGE_H, leftPadding=0, rightPadding=0,
                            topPadding=0, bottomPadding=0, id="cover_frame")
        content_frame = Frame(MARGIN_LEFT, MARGIN_BOTTOM, CONTENT_W,
                              PAGE_H - MARGIN_TOP - MARGIN_BOTTOM,
                              leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0,
                              id="content_frame")
        cover_tpl   = PageTemplate(id="Cover",   frames=[cover_frame],   onPage=_cover_background)
        content_tpl = PageTemplate(id="Content", frames=[content_frame], onPage=_content_background)
        doc = BaseDocTemplate(
            buf, pagesize=A4,
            pageTemplates=[cover_tpl, content_tpl],
            title=f"Workforce Analytics Report — {project.name}",
            author="ConstructionSight-AI",
        )

        # Page 1 = Cover (first template auto-applied); PageBreak → page 2 = Content
        story = []
        story.append(NextPageTemplate("Content"))
        story.append(PageBreak())

        # ── Report header (matches PPE style) ──────────────────────────────────
        story.append(Paragraph("Workforce Analytics Report", ParagraphStyle(
            "rpt_title", fontName="Helvetica-Bold", fontSize=16,
            textColor=C_NAVY, leading=20, spaceAfter=4,
        )))
        story.append(HRFlowable(width=CONTENT_W, thickness=2, color=C_BLUE, spaceAfter=8))

        m_lbl = ParagraphStyle("ml", fontName="Helvetica-Bold", fontSize=9.5, textColor=C_TEXT)
        m_val = ParagraphStyle("mv", fontName="Helvetica",      fontSize=9.5, textColor=C_TEXT)
        eff_color = (C_GREEN if efficiency_total >= 70 else C_AMBER if efficiency_total >= 40 else C_RED)
        eff_bg    = (C_GREEN_BG if efficiency_total >= 70 else C_AMBER_BG if efficiency_total >= 40 else C_RED_BG)

        meta_rows = [
            [Paragraph("Project",        m_lbl), Paragraph(project.name, m_val)],
            [Paragraph("Period",         m_lbl), Paragraph(period_str, m_val)],
            [Paragraph("Generated",      m_lbl), Paragraph(_fmt_pk(gen_dt), m_val)],
        ]
        if has_data:
            meta_rows.append([
                Paragraph("Efficiency Score", m_lbl),
                Paragraph(f"{efficiency_total} / 100 — {eff_label}",
                    ParagraphStyle("ms", fontName="Helvetica-Bold", fontSize=9.5, textColor=eff_color)),
            ])
        if hasattr(project, "location") and project.location:
            meta_rows.insert(1, [Paragraph("Location", m_lbl), Paragraph(project.location, m_val)])

        meta_tbl = Table(meta_rows, colWidths=[CONTENT_W * 0.25, CONTENT_W * 0.75])
        meta_tbl.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (0, -1), C_LIGHT),
            ("FONTNAME",      (0, 0), (0, -1), "Helvetica-Bold"),
            ("FONTSIZE",      (0, 0), (-1, -1), 9.5),
            ("TOPPADDING",    (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LEFTPADDING",   (0, 0), (-1, -1), 8),
            ("GRID",          (0, 0), (-1, -1), 0.4, C_BORDER),
            ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
            ("BACKGROUND",    (0, len(meta_rows) - 1), (-1, len(meta_rows) - 1), eff_bg),
        ]))
        story.append(meta_tbl)
        story.append(Spacer(1, 0.5 * cm))

        # ── Section 1: Executive Summary ───────────────────────────────────────
        story.append(Paragraph("Executive Summary", S["section_heading"]))
        story.append(HRFlowable(width=CONTENT_W, thickness=1, color=C_BORDER, spaceAfter=6))
        if total_snaps == 0:
            exec_text = (
                "No workforce monitoring data was recorded during the reporting period. "
                "This may reflect a period of low or no site activity, workforce conditions that did not "
                "trigger monitoring snapshots, or monitoring coverage that was not active across site zones "
                "during the selected timeframe. Review site activity logs and camera configurations "
                "for further context."
            )
        else:
            exec_text = (
                f"Workforce monitoring recorded <b>{total_snaps} data snapshots</b> across the period {period_str}. "
                f"Peak occupancy reached <b>{peak_workers} workers</b> on site. "
                f"Average site utilization was <b>{avg_utilization:.1f}%</b> with an idle ratio of "
                f"<b>{avg_idle_ratio:.1f}%</b>. "
            )
            if congestion_events:
                exec_text += f"<b>{congestion_events} congestion event{'s were' if congestion_events != 1 else ' was'}</b> detected. "
            if alerts:
                exec_text += (
                    f"<b>{len(alerts)} workforce insight{'s were' if len(alerts) != 1 else ' was'}</b> recorded. "
                    "Review the insights section for details."
                )
            else:
                exec_text += "No workforce insights were recorded during this period."
        story.append(Paragraph(exec_text, S["body"]))
        story.append(Spacer(1, 0.3 * cm))

        summary_data = [
            [Paragraph("Metric", S["th"]),    Paragraph("Value", S["th"])],
            ["Peak Workers On-Site",           str(peak_workers)],
            ["Average Utilization",            f"{avg_utilization:.1f}%"],
            ["Average Idle Ratio",             f"{avg_idle_ratio:.1f}%"],
            ["Average Dwell Time",             _fmt_dwell(avg_dwell)],
            ["Congestion Events",              str(congestion_events)],
            ["Total Workforce Insights",        str(len(alerts))],
            ["Workforce Efficiency Score",     f"{efficiency_total} / 100" if has_data else "0 / 100"],
            ["Data Snapshots Recorded",        str(total_snaps)],
        ]
        tbl = Table(summary_data, colWidths=[CONTENT_W * 0.55, CONTENT_W * 0.45])
        tbl.setStyle(_tbl_style())
        story.append(tbl)

        # ── Section 2: Zone Performance ────────────────────────────────────────
        story.append(Spacer(1, 0.5 * cm))
        story.append(Paragraph("Zone Performance", S["section_heading"]))
        story.append(HRFlowable(width=CONTENT_W, thickness=1, color=C_BORDER, spaceAfter=6))
        if zone_data:
            zone_rows = [
                [Paragraph(h, S["th"]) for h in
                 ["Zone", "Avg Workers", "Avg Utilization", "Avg Idle Ratio", "Congestion Events"]],
            ]
            for zn, zd in sorted(zone_data.items()):
                n = zd["count"] or 1
                zone_rows.append([
                    zn,
                    f"{sum(zd['workers']) / n:.1f}",
                    f"{sum(zd['utilization']) / n:.1f}%",
                    f"{sum(zd['idle_ratio']) / n:.1f}%",
                    str(zd["congestion"]),
                ])
            tbl2 = Table(zone_rows,
                         colWidths=[CONTENT_W * 0.30, CONTENT_W * 0.17,
                                    CONTENT_W * 0.18, CONTENT_W * 0.17, CONTENT_W * 0.18])
            tbl2.setStyle(_tbl_style())
            story.append(tbl2)
        else:
            story.append(Paragraph("No zone data available for this period.", S["note"]))

        # ── Section 3: Efficiency Score Breakdown ──────────────────────────────
        story.append(Spacer(1, 0.5 * cm))
        story.append(Paragraph("Workforce Efficiency Score Breakdown", S["section_heading"]))
        story.append(HRFlowable(width=CONTENT_W, thickness=1, color=C_BORDER, spaceAfter=6))
        if not has_data:
            story.append(Paragraph(
                "No workforce monitoring data was recorded in this period.",
                S["note"],
            ))
        else:
            eff_data = [
                [Paragraph(h, S["th"]) for h in ["Component", "Weight", "Raw Input", "Weighted Score"]],
                ["Staffing Coverage",   "40%",
                 f"{avg_workers:.1f} workers / {required_workers} required ({staffing_comp}%)",
                 str(round(staffing_comp * 0.40))],
                ["Activity Rate",       "30%", f"{active_rate}% non-idle", str(round(active_rate * 0.30))],
                ["Insight-Free Rate",   "20%", f"{alert_free_pct}% ({threshold_alerts} staffing/idle insights)",
                 str(round(alert_free_pct * 0.20))],
                ["Stability",          "10%",
                 f"{cong_free_pct}% ({congestion_events} congestion event{'s' if congestion_events != 1 else ''})",
                 str(round(cong_free_pct * 0.10))],
                [Paragraph("<b>Total Score</b>", S["td"]), "", "",
                 Paragraph(f"<b>{efficiency_total} / 100 — {eff_label}</b>", S["td"])],
            ]
            tbl3 = Table(eff_data, colWidths=[CONTENT_W * 0.35, CONTENT_W * 0.15,
                                              CONTENT_W * 0.25, CONTENT_W * 0.25])
            tbl3.setStyle(_tbl_style())
            story.append(tbl3)

        # ── Section 4: Hourly Workforce Timeline ───────────────────────────────
        story.append(Spacer(1, 0.5 * cm))
        wf_bucket_label = "Daily" if use_daily_wf else "Hourly"
        story.append(Paragraph(f"{wf_bucket_label} Workforce Timeline", S["section_heading"]))
        story.append(HRFlowable(width=CONTENT_W, thickness=1, color=C_BORDER, spaceAfter=6))
        if wf_hourly:
            wf_tl_header = "Period (PKT)" if use_daily_wf else "Hour (PKT)"
            wf_tl_rows = [
                [Paragraph(h, S["th"]) for h in
                 [wf_tl_header, "Avg Workers", "Avg Utilization", "Avg Idle Ratio", "Avg Dwell", "Congestion"]],
            ]
            for bucket_key in sorted(wf_hourly.keys()):
                bs = wf_hourly[bucket_key]
                nb = len(bs) or 1
                avg_w_b   = sum(s.worker_count for s in bs) / nb
                avg_u_b   = sum(s.utilization_score for s in bs) / nb
                avg_ir_b  = sum((s.idle_count / s.worker_count * 100) if s.worker_count else 0 for s in bs) / nb
                avg_dw_b  = sum(s.avg_dwell_seconds for s in bs if s.avg_dwell_seconds) / max(
                    sum(1 for s in bs if s.avg_dwell_seconds), 1)
                cong_b    = sum(1 for s in bs if s.congestion_flag)
                wf_tl_rows.append([
                    bucket_key,
                    f"{avg_w_b:.1f}",
                    f"{avg_u_b:.1f}%",
                    f"{avg_ir_b:.1f}%",
                    _fmt_dwell(avg_dw_b),
                    str(cong_b),
                ])
            wf_tl_tbl = Table(wf_tl_rows,
                               colWidths=[CONTENT_W * 0.26, CONTENT_W * 0.14,
                                          CONTENT_W * 0.16, CONTENT_W * 0.14,
                                          CONTENT_W * 0.15, CONTENT_W * 0.15])
            wf_tl_tbl.setStyle(_tbl_style())
            story.append(wf_tl_tbl)
        else:
            story.append(Paragraph("No timeline data available for this period.", S["note"]))

        # ── Section 5: Workforce Insights ──────────────────────────────────────
        story.append(Spacer(1, 0.5 * cm))
        story.append(Paragraph("Workforce Insights", S["section_heading"]))
        story.append(HRFlowable(width=CONTENT_W, thickness=1, color=C_BORDER, spaceAfter=6))
        fmt_wtype = lambda t: t.replace("_", " ").title()
        if alerts:
            story.append(Paragraph(
                f"All {len(alerts)} insight{'s' if len(alerts) != 1 else ''} recorded during the period, "
                f"sorted by most recent first. All timestamps are shown in Pakistan Standard Time (PKT, UTC+5).",
                S["body"],
            ))
            story.append(Spacer(1, 0.2 * cm))
            alert_rows = [
                [Paragraph(h, S["th"]) for h in
                 ["Insight Type", "Severity", "Zone", "Camera", "Triggered At (PKT)", "Status"]],
            ]
            for a in alerts:
                alert_rows.append([
                    fmt_wtype(a.alert_type),
                    a.severity.capitalize() if a.severity else "—",
                    a.zone_name or "—",
                    cam_map.get(a.camera_id, f"Camera {a.camera_id}") if a.camera_id else "—",
                    _as_pk(a.triggered_at).strftime("%d %b %Y %H:%M") if a.triggered_at else "—",
                    a.status.capitalize() if a.status else "—",
                ])
            tbl4 = Table(alert_rows,
                         colWidths=[CONTENT_W * 0.20, CONTENT_W * 0.10, CONTENT_W * 0.18,
                                    CONTENT_W * 0.17, CONTENT_W * 0.22, CONTENT_W * 0.13])
            tbl4.setStyle(_tbl_style())
            story.append(tbl4)
        else:
            story.append(Paragraph("No workforce insights recorded in this period.", S["note"]))

        # ── Section 6: Per-Camera Insight Detail Cards ─────────────────────────
        wf_cams_with_alerts = sorted(wf_cam_alert_detail.keys(), key=lambda cid: -len(wf_cam_alert_detail[cid]))
        if wf_cams_with_alerts:
            story.append(Spacer(1, 0.5 * cm))
            story.append(Paragraph("Per-Camera Insight Detail", S["section_heading"]))
            story.append(HRFlowable(width=CONTENT_W, thickness=1, color=C_BORDER, spaceAfter=6))
            story.append(Paragraph(
                "Detailed insight breakdown for each camera that recorded insights during the period. "
                "Cameras are ordered by insight count, highest first.",
                S["body"],
            ))
            story.append(Spacer(1, 0.2 * cm))

            wf_cam_sub = ParagraphStyle(
                "wf_cam_sub", fontName="Helvetica-Bold", fontSize=10,
                textColor=C_NAVY, spaceBefore=8, spaceAfter=4,
            )
            wf_cam_meta = ParagraphStyle(
                "wf_cam_meta", fontName="Helvetica", fontSize=8.5,
                textColor=C_MUTED, spaceAfter=4,
            )

            for cam_id in wf_cams_with_alerts:
                cam_name       = cam_map.get(cam_id, f"Camera {cam_id}")
                cam_ins_list   = wf_cam_alert_detail[cam_id]
                cam_snaps_list = [s for s in snapshots if s.camera_id == cam_id]
                zone_name      = cam_snaps_list[0].zone_name if cam_snaps_list else (
                    cam_ins_list[0].zone_name if cam_ins_list else "—"
                )
                n_snaps    = len(cam_snaps_list)
                avg_w_cam  = (sum(s.worker_count for s in cam_snaps_list) / n_snaps) if n_snaps else 0.0
                avg_u_cam  = (sum(s.utilization_score for s in cam_snaps_list) / n_snaps) if n_snaps else 0.0

                story.append(Paragraph(f"{cam_name}  —  Zone: {zone_name or '—'}", wf_cam_sub))
                story.append(Paragraph(
                    f"{n_snaps} snapshot{'s' if n_snaps != 1 else ''} recorded.  "
                    f"Avg workers: {avg_w_cam:.1f}.  Avg utilization: {avg_u_cam:.1f}%.  "
                    f"Total insights: {len(cam_ins_list)}.",
                    wf_cam_meta,
                ))
                wf_det_rows = [
                    [Paragraph(h, S["th"]) for h in
                     ["Insight Type", "Severity", "Triggered At (PKT)", "Status", "Message"]],
                ]
                for a in sorted(cam_ins_list, key=lambda x: x.triggered_at or datetime.min):
                    msg = (a.message or "—")
                    wf_det_rows.append([
                        fmt_wtype(a.alert_type),
                        a.severity.capitalize() if a.severity else "—",
                        _as_pk(a.triggered_at).strftime("%d %b %Y %H:%M") if a.triggered_at else "—",
                        a.status.capitalize() if a.status else "—",
                        Paragraph(msg, ParagraphStyle("wmsg", fontName="Helvetica", fontSize=7.5,
                                                       textColor=C_TEXT, leading=10)),
                    ])
                wf_det_tbl = Table(wf_det_rows,
                                   colWidths=[CONTENT_W * 0.20, CONTENT_W * 0.10,
                                              CONTENT_W * 0.20, CONTENT_W * 0.10, CONTENT_W * 0.40])
                wf_det_tbl.setStyle(_tbl_style())
                story.append(wf_det_tbl)
                story.append(Spacer(1, 0.3 * cm))

        # ── Section 7: Insight Snapshots ────────────────────────────────────
        snap_alerts = [a for a in alerts if a.snapshot_url]
        if snap_alerts:
            all_snap_urls      = [a.snapshot_url for a in snap_alerts]
            image_bytes_cache  = _prefetch_image_bytes(all_snap_urls, max_workers=min(8, len(all_snap_urls)))
            story.append(PageBreak())
            story.append(Paragraph("Insight Snapshots", S["section_heading"]))
            story.append(HRFlowable(width=CONTENT_W, thickness=1, color=C_BORDER, spaceAfter=6))
            story.append(Paragraph(
                f"All {len(snap_alerts)} snapshot{'s' if len(snap_alerts) != 1 else ''} automatically captured "
                f"by the monitoring system at the time of each insight. "
                f"Timestamps shown in Pakistan Standard Time (PKT, UTC+5).",
                S["body"],
            ))
            story.append(Spacer(1, 0.3 * cm))
            MAX_W = CONTENT_W / 2 - 5
            MAX_H = 6.5 * cm
            for pair in [snap_alerts[i:i+2] for i in range(0, len(snap_alerts), 2)]:
                row_cells = []
                for a in pair:
                    cam_lbl = cam_map.get(a.camera_id, f"Camera {a.camera_id}") if a.camera_id else "—"
                    ts_lbl  = _fmt_pk(a.triggered_at, "%d %b %Y, %H:%M") if a.triggered_at else "—"
                    img     = _make_rl_image(image_bytes_cache.get(a.snapshot_url), MAX_W, MAX_H)
                    cap     = Paragraph(
                        f"<b>Insight:</b> {fmt_wtype(a.alert_type)}  |  "
                        f"<b>Zone:</b> {a.zone_name or 'Unspecified'}  |  "
                        f"<b>Camera:</b> {cam_lbl}<br/>"
                        f"<b>Severity:</b> {a.severity.capitalize() if a.severity else '—'}  |  {ts_lbl}",
                        S["caption"],
                    )
                    if img:
                        row_cells.append([img, cap])
                    else:
                        row_cells.append([
                            Spacer(1, 2 * cm),
                            Paragraph("[Image unavailable]", ParagraphStyle(
                                "wf_ph", fontName="Helvetica-Oblique", fontSize=9,
                                textColor=C_MUTED, alignment=TA_CENTER)),
                            Spacer(1, 2 * cm),
                            cap,
                        ])
                if len(row_cells) == 1:
                    row_cells.append([Spacer(1, 1)])
                photo_row = Table([row_cells], colWidths=[CONTENT_W / 2 - 5, CONTENT_W / 2 - 5])
                photo_row.setStyle(TableStyle([
                    ("VALIGN",        (0, 0), (-1, -1), "TOP"),
                    ("TOPPADDING",    (0, 0), (-1, -1), 6),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                    ("LEFTPADDING",   (0, 0), (-1, -1), 4),
                    ("RIGHTPADDING",  (0, 0), (-1, -1), 4),
                    ("BOX",           (0, 0), (0, -1), 0.4, C_BORDER),
                    ("BOX",           (1, 0), (1, -1), 0.4, C_BORDER),
                ]))
                story.append(photo_row)
                story.append(Spacer(1, 0.3 * cm))

        # ── Section 8: Recommendations ─────────────────────────────────────────
        story.append(Spacer(1, 0.5 * cm))
        story.append(Paragraph("Recommendations", S["section_heading"]))
        story.append(HRFlowable(width=CONTENT_W, thickness=1, color=C_BORDER, spaceAfter=6))
        wf_recs = []
        if avg_utilization < 50:
            wf_recs.append(
                f"Average site utilization was {avg_utilization:.1f}%, below the 50% threshold. "
                "Review shift scheduling and zone assignments to improve workforce deployment efficiency."
            )
        if avg_idle_ratio > 30:
            wf_recs.append(
                f"Average idle ratio of {avg_idle_ratio:.1f}% exceeds the 30% guideline. "
                "Investigate zones with high idle clustering and consider task re-distribution or closer supervision."
            )
        understaffed = wf_alert_type_counts.get("understaffed", 0)
        if understaffed > 2:
            wf_recs.append(
                f"{understaffed} understaffing alerts were raised during the period. "
                "Consider increasing required headcount thresholds or adjusting shift overlap to maintain adequate coverage."
            )
        idle_high = wf_alert_type_counts.get("idle_ratio_high", 0)
        if idle_high > 2:
            wf_recs.append(
                f"{idle_high} high idle ratio alerts were recorded. "
                "Review camera zones for extended break patterns or inactive work areas that may require operational changes."
            )
        overload = wf_alert_type_counts.get("overload", 0)
        if overload > 1:
            wf_recs.append(
                f"{overload} overload alerts were detected, indicating excessive worker density in monitored zones. "
                "Review zone capacity settings and consider redistributing tasks to adjacent areas."
            )
        if congestion_events > 3:
            wf_recs.append(
                f"{congestion_events} congestion events were recorded. "
                "High congestion may slow productivity and increase safety risks. "
                "Review site layout and entry/exit flow patterns for the affected zones."
            )
        if efficiency_total < 40:
            wf_recs.append(
                f"The Workforce Efficiency Score of {efficiency_total}/100 is rated CRITICAL. "
                "A comprehensive review of staffing levels, idle management, and alert thresholds is recommended."
            )
        if not wf_recs:
            wf_recs.append(
                "No significant workforce concerns were identified during this period. "
                "Efficiency thresholds are well-calibrated for current site conditions. "
                "Continue monitoring and review settings periodically to maintain operational standards."
            )
        wf_rec_style = ParagraphStyle(
            "wf_rec_item", fontName="Helvetica", fontSize=9,
            textColor=C_TEXT, leading=13, leftIndent=12, spaceBefore=4,
        )
        for i, rec in enumerate(wf_recs, 1):
            story.append(Paragraph(f"{i}.  {rec}", wf_rec_style))

        # ── Closing ────────────────────────────────────────────────────────────
        story.append(Spacer(1, 1 * cm))
        story.append(HRFlowable(width=CONTENT_W, thickness=0.5, color=C_BORDER, spaceAfter=6))
        story.append(Paragraph(
            f"This report was automatically generated by ConstructionSight AI Workforce Monitoring System "
            f"on {_fmt_pk(gen_dt, '%d %B %Y at %H:%M')} (PKT). Data is derived from automated AI analysis "
            f"and should be reviewed by a qualified site manager. CONFIDENTIAL — authorised personnel only.",
            S["closing"],
        ))

        doc.build(story)
        buf.seek(0)
        return buf.read()

    except ReportGenerationError:
        raise
    except Exception as exc:
        logger.error("Workforce PDF generation failed for project %s: %s", project_id, exc, exc_info=True)
        raise ReportGenerationError(f"Workforce PDF generation failed: {exc}") from exc


# ── Activity Monitoring PDF ────────────────────────────────────────────────────

def generate_activity_pdf_report(
    db: Session,
    project_id: int,
    period_start: datetime,
    period_end: datetime,
    triggered_by: str = "scheduled",
) -> bytes:
    from app.models.project import Project
    from app.models.activity_snapshot import ActivitySnapshot
    from app.models.activity_alert import ActivityAlert
    from app.models.camera import Camera

    try:
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise ReportGenerationError(f"Project {project_id} not found.")

        snapshots = (
            db.query(ActivitySnapshot)
            .filter(
                ActivitySnapshot.project_id == project_id,
                ActivitySnapshot.recorded_at >= period_start,
                ActivitySnapshot.recorded_at <= period_end,
            )
            .order_by(ActivitySnapshot.recorded_at.asc())
            .all()
        )

        alerts = (
            db.query(ActivityAlert)
            .filter(
                ActivityAlert.project_id == project_id,
                ActivityAlert.triggered_at >= period_start,
                ActivityAlert.triggered_at <= period_end,
            )
            .order_by(ActivityAlert.triggered_at.desc())
            .all()
        )

        # Camera name map
        cam_ids_act = {s.camera_id for s in snapshots} | {a.camera_id for a in alerts}
        cam_map_act: dict[int, str] = {}
        if cam_ids_act:
            cams_act = db.query(Camera).filter(Camera.id.in_(cam_ids_act)).all()
            cam_map_act = {c.id: (c.name or f"Camera {c.id}") for c in cams_act}

        # ── Aggregate summary ──────────────────────────────────────────────────
        total_snaps       = len(snapshots)
        avg_intensity     = (sum(s.motion_intensity_score for s in snapshots) / total_snaps) if total_snaps else 0.0
        total_active_min  = max((s.active_minutes_today for s in snapshots), default=0)
        total_idle_min    = max((s.idle_minutes_today for s in snapshots), default=0)
        longest_idle_secs = max((s.longest_idle_seconds or 0 for s in snapshots), default=0)

        def _fmt_secs(secs):
            if not secs: return "—"
            m = int(secs // 60); s2 = int(secs % 60)
            return f"{m}m {s2}s" if s2 else f"{m}m"

        # Zone state distribution
        state_counts: dict[str, int] = defaultdict(int)
        for s in snapshots:
            state_counts[s.zone_state or "UNKNOWN"] += 1

        # Alert type breakdown
        alert_type_counts: dict[str, int] = defaultdict(int)
        for a in alerts:
            alert_type_counts[a.alert_type] += 1

        # Per-camera summary
        cam_perf: dict[int, dict] = defaultdict(lambda: {
            "name": "—", "zone": "—", "intensity": [], "active_pct": [], "alerts": 0
        })
        for s in snapshots:
            cd = cam_perf[s.camera_id]
            cd["zone"] = s.zone_name or "—"
            cd["name"] = cam_map_act.get(s.camera_id, f"Camera {s.camera_id}")
            cd["intensity"].append(s.motion_intensity_score)
            active_pct = (s.moving_count / s.total_count * 100) if s.total_count else 0.0
            cd["active_pct"].append(active_pct)
        for a in alerts:
            cam_perf[a.camera_id]["alerts"] += 1

        # Efficiency score (mirrors dashboard)
        motion_comp  = round(avg_intensity * 0.40)
        active_snaps = [s for s in snapshots if s.total_count > 0]
        avg_active_ratio = (
            sum(s.moving_count / s.total_count * 100 for s in active_snaps) / len(active_snaps)
        ) if active_snaps else 0.0
        active_comp  = round(avg_active_ratio * 0.30)
        alert_free_pct = max(0, 100 - min(100, len(alerts) * 10))
        alert_comp   = round(alert_free_pct * 0.20)
        stability_comp = round(10) if avg_intensity >= 30 else 0
        efficiency_total = min(100, motion_comp + active_comp + alert_comp + stability_comp)

        # ── Per-zone performance breakdown ─────────────────────────────────────
        zone_perf: dict[str, dict] = defaultdict(lambda: {
            "intensity": [], "active_pct": [], "active_min": 0, "idle_min": 0, "alerts": 0
        })
        for s in snapshots:
            z = s.zone_name or "Unspecified"
            zone_perf[z]["intensity"].append(s.motion_intensity_score)
            pct = (s.moving_count / s.total_count * 100) if s.total_count else 0.0
            zone_perf[z]["active_pct"].append(pct)
            zone_perf[z]["active_min"] = max(zone_perf[z]["active_min"], s.active_minutes_today or 0)
            zone_perf[z]["idle_min"]   = max(zone_perf[z]["idle_min"],   s.idle_minutes_today or 0)
        for a in alerts:
            zone_perf[a.zone_name or "Unspecified"]["alerts"] += 1

        # ── Hourly / daily activity timeline ──────────────────────────────────
        period_hours = (period_end - period_start).total_seconds() / 3600
        use_daily_buckets = period_hours > 48
        hourly_buckets: dict[str, list] = defaultdict(list)
        for s in snapshots:
            if use_daily_buckets:
                key = _as_pk(s.recorded_at).strftime("%d %b %Y")
            else:
                key = _as_pk(s.recorded_at).strftime("%d %b %Y %H:00")
            hourly_buckets[key].append(s)

        # ── Per-camera alert detail ────────────────────────────────────────────
        cam_alert_detail: dict[int, list] = defaultdict(list)
        for a in alerts:
            cam_alert_detail[a.camera_id].append(a)

        gen_dt     = datetime.now(timezone.utc)
        period_str = f"{_as_pk(period_start).strftime('%d %B %Y')} to {_as_pk(period_end).strftime('%d %B %Y')}"
        S          = _S()

        fmt_atype = {
            "zone_idle":              "Zone Idle",
            "activity_drop":          "Activity Drop",
            "low_activity_sustained": "Low Activity (Sustained)",
            "repeated_inactivity":    "Repeated Inactivity",
        }

        # ── Document setup — identical pattern to PPE ──────────────────────────
        buf = io.BytesIO()
        cover_frame = Frame(0, 0, PAGE_W, PAGE_H, leftPadding=0, rightPadding=0,
                            topPadding=0, bottomPadding=0, id="cover_frame")
        content_frame = Frame(MARGIN_LEFT, MARGIN_BOTTOM, CONTENT_W,
                              PAGE_H - MARGIN_TOP - MARGIN_BOTTOM,
                              leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0,
                              id="content_frame")
        cover_tpl   = PageTemplate(id="Cover",   frames=[cover_frame],   onPage=_cover_background)
        content_tpl = PageTemplate(id="Content", frames=[content_frame], onPage=_content_background)
        doc = BaseDocTemplate(
            buf, pagesize=A4,
            pageTemplates=[cover_tpl, content_tpl],
            title=f"Activity Monitoring Report — {project.name}",
            author="ConstructionSight-AI",
        )

        # Page 1 = Cover (first template auto-applied); PageBreak → page 2 = Content
        story = []
        story.append(NextPageTemplate("Content"))
        story.append(PageBreak())

        # ── Report header ──────────────────────────────────────────────────────
        story.append(Paragraph("Activity Monitoring Report", ParagraphStyle(
            "rpt_title", fontName="Helvetica-Bold", fontSize=16,
            textColor=C_NAVY, leading=20, spaceAfter=4,
        )))
        story.append(HRFlowable(width=CONTENT_W, thickness=2, color=C_BLUE, spaceAfter=8))

        m_lbl = ParagraphStyle("ml", fontName="Helvetica-Bold", fontSize=9.5, textColor=C_TEXT)
        m_val = ParagraphStyle("mv", fontName="Helvetica",      fontSize=9.5, textColor=C_TEXT)
        eff_label = ("PRODUCTIVE" if efficiency_total >= 70
                     else "MODERATE" if efficiency_total >= 40
                     else "CRITICAL")
        eff_color = C_GREEN if efficiency_total >= 70 else (C_AMBER if efficiency_total >= 40 else C_RED)
        eff_bg    = C_GREEN_BG if efficiency_total >= 70 else (C_AMBER_BG if efficiency_total >= 40 else C_RED_BG)

        meta_rows = [
            [Paragraph("Project",          m_lbl), Paragraph(project.name, m_val)],
            [Paragraph("Period",           m_lbl), Paragraph(period_str, m_val)],
            [Paragraph("Generated",        m_lbl), Paragraph(_fmt_pk(gen_dt), m_val)],
            [Paragraph("Activity Score",   m_lbl), Paragraph(f"{efficiency_total} / 100 — {eff_label}",
                ParagraphStyle("ms", fontName="Helvetica-Bold", fontSize=9.5, textColor=eff_color))],
        ]
        if hasattr(project, "location") and project.location:
            meta_rows.insert(1, [Paragraph("Location", m_lbl), Paragraph(project.location, m_val)])

        meta_tbl = Table(meta_rows, colWidths=[CONTENT_W * 0.25, CONTENT_W * 0.75])
        meta_tbl.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (0, -1), C_LIGHT),
            ("FONTNAME",      (0, 0), (0, -1), "Helvetica-Bold"),
            ("FONTSIZE",      (0, 0), (-1, -1), 9.5),
            ("TOPPADDING",    (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LEFTPADDING",   (0, 0), (-1, -1), 8),
            ("GRID",          (0, 0), (-1, -1), 0.4, C_BORDER),
            ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
            ("BACKGROUND",    (0, len(meta_rows) - 1), (-1, len(meta_rows) - 1), eff_bg),
        ]))
        story.append(meta_tbl)
        story.append(Spacer(1, 0.5 * cm))

        # ── Section 1: Executive Summary ───────────────────────────────────────
        story.append(Paragraph("Executive Summary", S["section_heading"]))
        story.append(HRFlowable(width=CONTENT_W, thickness=1, color=C_BORDER, spaceAfter=6))
        if total_snaps == 0:
            exec_text = (
                "No activity monitoring data was recorded during the reporting period. "
                "This may reflect a period of low or no site activity, motion levels that did not "
                "trigger monitoring snapshots, or monitoring coverage that was not active across site zones "
                "during the selected timeframe. Review site activity logs and camera configurations "
                "for further context."
            )
        else:
            exec_text = (
                f"Activity monitoring recorded <b>{total_snaps} data snapshots</b> over the period {period_str}. "
                f"Average motion intensity was <b>{avg_intensity:.1f} / 100</b> with an active worker ratio of "
                f"<b>{avg_active_ratio:.1f}%</b>. "
            )
            if longest_idle_secs:
                exec_text += f"The longest recorded idle period was <b>{_fmt_secs(longest_idle_secs)}</b>. "
            if alerts:
                exec_text += (
                    f"<b>{len(alerts)} activity alert{'s were' if len(alerts) != 1 else ' was'}</b> raised. "
                    "See the alerts section for a full breakdown."
                )
            else:
                exec_text += "No activity alerts were raised during this period."
        story.append(Paragraph(exec_text, S["body"]))
        story.append(Spacer(1, 0.3 * cm))

        summary_data = [
            [Paragraph("Metric", S["th"]),     Paragraph("Value", S["th"])],
            ["Average Motion Intensity",        f"{avg_intensity:.1f} / 100"],
            ["Average Active Worker Ratio",     f"{avg_active_ratio:.1f}%"],
            ["Peak Active Minutes",             str(total_active_min)],
            ["Peak Idle Minutes",               str(total_idle_min)],
            ["Longest Idle Period",             _fmt_secs(longest_idle_secs)],
            ["Total Activity Alerts",           str(len(alerts))],
            ["Activity Efficiency Score",       f"{efficiency_total} / 100 — {eff_label}"],
            ["Data Snapshots Recorded",         str(total_snaps)],
        ]
        tbl = Table(summary_data, colWidths=[CONTENT_W * 0.55, CONTENT_W * 0.45])
        tbl.setStyle(_tbl_style())
        story.append(tbl)

        # ── Section 2: Efficiency Score Breakdown ──────────────────────────────
        story.append(Spacer(1, 0.5 * cm))
        story.append(Paragraph("Activity Efficiency Score Breakdown", S["section_heading"]))
        story.append(HRFlowable(width=CONTENT_W, thickness=1, color=C_BORDER, spaceAfter=6))
        story.append(Paragraph(
            "The Activity Efficiency Score is a composite metric (0–100) derived from four weighted components "
            "that together reflect the quality and consistency of site activity during the reporting period.",
            S["body"],
        ))
        story.append(Spacer(1, 0.2 * cm))
        eff_rows = [
            [Paragraph(h, S["th"]) for h in ["Component", "Weight", "Raw Score", "Contribution"]],
            ["Motion Intensity",    "40%", f"{avg_intensity:.1f} / 100", f"{motion_comp} pts"],
            ["Active Worker Ratio", "30%", f"{avg_active_ratio:.1f}%",  f"{active_comp} pts"],
            ["Alert-Free Rate",     "20%", f"{alert_free_pct:.0f}%",    f"{alert_comp} pts"],
            ["Stability Bonus",     "10%", "100" if avg_intensity >= 30 else "0", f"{stability_comp} pts"],
            [Paragraph("<b>Total Score</b>", ParagraphStyle("eff_tot", fontName="Helvetica-Bold", fontSize=8.5, textColor=eff_color)),
             "100%", "—",
             Paragraph(f"<b>{efficiency_total} / 100 — {eff_label}</b>",
                       ParagraphStyle("eff_tot2", fontName="Helvetica-Bold", fontSize=8.5, textColor=eff_color))],
        ]
        eff_tbl = Table(eff_rows, colWidths=[CONTENT_W * 0.38, CONTENT_W * 0.15,
                                              CONTENT_W * 0.22, CONTENT_W * 0.25])
        eff_style = _tbl_style()
        eff_style.add("BACKGROUND", (0, len(eff_rows) - 1), (-1, len(eff_rows) - 1), eff_bg)
        eff_tbl.setStyle(eff_style)
        story.append(eff_tbl)

        # ── Section 3: Alert Type Breakdown ────────────────────────────────────
        story.append(Spacer(1, 0.5 * cm))
        story.append(Paragraph("Alert Type Breakdown", S["section_heading"]))
        story.append(HRFlowable(width=CONTENT_W, thickness=1, color=C_BORDER, spaceAfter=6))
        if alert_type_counts:
            total_alerts_count = len(alerts)
            at_rows = [
                [Paragraph(h, S["th"]) for h in ["Alert Type", "Count", "% of Total"]],
            ]
            for atype, cnt in sorted(alert_type_counts.items(), key=lambda x: -x[1]):
                at_rows.append([
                    fmt_atype.get(atype, atype.replace("_", " ").title()),
                    str(cnt),
                    f"{cnt / total_alerts_count * 100:.1f}%",
                ])
            tbl2 = Table(at_rows, colWidths=[CONTENT_W * 0.55, CONTENT_W * 0.22, CONTENT_W * 0.23])
            tbl2.setStyle(_tbl_style())
            story.append(tbl2)
        else:
            story.append(Paragraph("No activity alerts recorded in this period.", S["note"]))

        # ── Section 4: Zone State Distribution ─────────────────────────────────
        story.append(Spacer(1, 0.5 * cm))
        story.append(Paragraph("Zone State Distribution", S["section_heading"]))
        story.append(HRFlowable(width=CONTENT_W, thickness=1, color=C_BORDER, spaceAfter=6))
        if state_counts and total_snaps:
            zs_rows = [
                [Paragraph(h, S["th"]) for h in ["Zone State", "Snapshot Count", "% of Time"]],
            ]
            for state in ["ACTIVE", "LOW_ACTIVITY", "IDLE", "ALERTED"]:
                cnt = state_counts.get(state, 0)
                zs_rows.append([
                    state.replace("_", " ").title(),
                    str(cnt),
                    f"{cnt / total_snaps * 100:.1f}%",
                ])
            tbl3 = Table(zs_rows, colWidths=[CONTENT_W * 0.45, CONTENT_W * 0.27, CONTENT_W * 0.28])
            tbl3.setStyle(_tbl_style())
            story.append(tbl3)
        else:
            story.append(Paragraph("No zone state data available.", S["note"]))

        # ── Section 5: Per-Zone Performance Breakdown ──────────────────────────
        story.append(Spacer(1, 0.5 * cm))
        story.append(Paragraph("Per-Zone Performance Breakdown", S["section_heading"]))
        story.append(HRFlowable(width=CONTENT_W, thickness=1, color=C_BORDER, spaceAfter=6))
        if zone_perf:
            zp_rows = [
                [Paragraph(h, S["th"]) for h in
                 ["Zone", "Avg Motion Intensity", "Avg Active %", "Peak Active Min", "Peak Idle Min", "Alerts"]],
            ]
            for zname, zd in sorted(zone_perf.items()):
                n = len(zd["intensity"]) or 1
                zp_rows.append([
                    zname,
                    f"{sum(zd['intensity']) / n:.1f}",
                    f"{sum(zd['active_pct']) / n:.1f}%",
                    str(zd["active_min"]),
                    str(zd["idle_min"]),
                    str(zd["alerts"]),
                ])
            zp_tbl = Table(zp_rows,
                           colWidths=[CONTENT_W * 0.22, CONTENT_W * 0.18,
                                      CONTENT_W * 0.15, CONTENT_W * 0.16,
                                      CONTENT_W * 0.14, CONTENT_W * 0.15])
            zp_tbl.setStyle(_tbl_style())
            story.append(zp_tbl)
        else:
            story.append(Paragraph("No zone performance data available for this period.", S["note"]))

        # ── Section 6: Per-Camera Summary ──────────────────────────────────────
        story.append(Spacer(1, 0.5 * cm))
        story.append(Paragraph("Per-Camera Summary", S["section_heading"]))
        story.append(HRFlowable(width=CONTENT_W, thickness=1, color=C_BORDER, spaceAfter=6))
        if cam_perf:
            cam_rows = [
                [Paragraph(h, S["th"]) for h in
                 ["Camera", "Zone", "Avg Motion Intensity", "Avg Active %", "Alerts"]],
            ]
            for cam_id, cd in sorted(cam_perf.items()):
                n = len(cd["intensity"]) or 1
                cam_rows.append([
                    cd["name"],
                    cd["zone"],
                    f"{sum(cd['intensity']) / n:.1f}",
                    f"{sum(cd['active_pct']) / n:.1f}%",
                    str(cd["alerts"]),
                ])
            tbl4 = Table(cam_rows,
                         colWidths=[CONTENT_W * 0.25, CONTENT_W * 0.22,
                                    CONTENT_W * 0.22, CONTENT_W * 0.17, CONTENT_W * 0.14])
            tbl4.setStyle(_tbl_style())
            story.append(tbl4)
        else:
            story.append(Paragraph("No camera data available for this period.", S["note"]))

        # ── Section 7: Hourly Activity Timeline ────────────────────────────────
        story.append(Spacer(1, 0.5 * cm))
        bucket_label = "Daily" if use_daily_buckets else "Hourly"
        story.append(Paragraph(f"{bucket_label} Activity Timeline", S["section_heading"]))
        story.append(HRFlowable(width=CONTENT_W, thickness=1, color=C_BORDER, spaceAfter=6))
        if hourly_buckets:
            tl_header = "Period (PKT)" if use_daily_buckets else "Hour (PKT)"
            tl_rows = [
                [Paragraph(h, S["th"]) for h in
                 [tl_header, "Avg Intensity", "Avg Moving", "Avg Idle", "Avg Total", "Dominant State"]],
            ]
            for bucket_key in sorted(hourly_buckets.keys()):
                bucket_snaps = hourly_buckets[bucket_key]
                nb = len(bucket_snaps) or 1
                avg_int_b  = sum(s.motion_intensity_score for s in bucket_snaps) / nb
                avg_mov_b  = sum(s.moving_count for s in bucket_snaps) / nb
                avg_idl_b  = sum(s.idle_count for s in bucket_snaps) / nb
                avg_tot_b  = sum(s.total_count for s in bucket_snaps) / nb
                state_ctr: dict[str, int] = defaultdict(int)
                for s in bucket_snaps:
                    state_ctr[s.zone_state or "UNKNOWN"] += 1
                dom_state = max(state_ctr, key=state_ctr.get).replace("_", " ").title()
                tl_rows.append([
                    bucket_key,
                    f"{avg_int_b:.1f}",
                    f"{avg_mov_b:.1f}",
                    f"{avg_idl_b:.1f}",
                    f"{avg_tot_b:.1f}",
                    dom_state,
                ])
            tl_tbl = Table(tl_rows,
                           colWidths=[CONTENT_W * 0.26, CONTENT_W * 0.15,
                                      CONTENT_W * 0.13, CONTENT_W * 0.12,
                                      CONTENT_W * 0.13, CONTENT_W * 0.21])
            tl_tbl.setStyle(_tbl_style())
            story.append(tl_tbl)
        else:
            story.append(Paragraph("No timeline data available for this period.", S["note"]))

        # ── Section 8: Complete Activity Alerts Log ─────────────────────────────
        story.append(Spacer(1, 0.5 * cm))
        story.append(Paragraph("Complete Activity Alerts Log", S["section_heading"]))
        story.append(HRFlowable(width=CONTENT_W, thickness=1, color=C_BORDER, spaceAfter=6))
        if alerts:
            story.append(Paragraph(
                f"All {len(alerts)} alert{'s' if len(alerts) != 1 else ''} recorded during the period, "
                f"sorted by most recent first. All timestamps are shown in Pakistan Standard Time (PKT, UTC+5).",
                S["body"],
            ))
            story.append(Spacer(1, 0.2 * cm))
            al_rows = [
                [Paragraph(h, S["th"]) for h in
                 ["Alert Type", "Severity", "Zone", "Camera", "Triggered At (PKT)", "Status"]],
            ]
            for a in alerts:
                al_rows.append([
                    fmt_atype.get(a.alert_type, a.alert_type.replace("_", " ").title()),
                    a.severity.capitalize() if a.severity else "—",
                    a.zone_name or "—",
                    cam_map_act.get(a.camera_id, f"Camera {a.camera_id}") if a.camera_id else "—",
                    _as_pk(a.triggered_at).strftime("%d %b %Y %H:%M") if a.triggered_at else "—",
                    a.status.capitalize() if a.status else "—",
                ])
            tbl5 = Table(al_rows,
                         colWidths=[CONTENT_W * 0.20, CONTENT_W * 0.10, CONTENT_W * 0.18,
                                    CONTENT_W * 0.17, CONTENT_W * 0.22, CONTENT_W * 0.13])
            tbl5.setStyle(_tbl_style())
            story.append(tbl5)
        else:
            story.append(Paragraph("No activity alerts in this period.", S["note"]))

        # ── Section 9: Per-Camera Alert Detail Cards ────────────────────────────
        cams_with_alerts = sorted(cam_alert_detail.keys(), key=lambda cid: -len(cam_alert_detail[cid]))
        if cams_with_alerts:
            story.append(Spacer(1, 0.5 * cm))
            story.append(Paragraph("Per-Camera Alert Detail", S["section_heading"]))
            story.append(HRFlowable(width=CONTENT_W, thickness=1, color=C_BORDER, spaceAfter=6))
            story.append(Paragraph(
                "Detailed alert breakdown for each camera that recorded alerts during the period. "
                "Cameras are ordered by alert count, highest first.",
                S["body"],
            ))
            story.append(Spacer(1, 0.2 * cm))

            cam_sub_heading = ParagraphStyle(
                "cam_sub", fontName="Helvetica-Bold", fontSize=10,
                textColor=C_NAVY, spaceBefore=8, spaceAfter=4,
            )
            cam_meta_style = ParagraphStyle(
                "cam_meta", fontName="Helvetica", fontSize=8.5,
                textColor=C_MUTED, spaceAfter=4,
            )

            for cam_id in cams_with_alerts:
                cam_name  = cam_map_act.get(cam_id, f"Camera {cam_id}")
                cam_alerts_list = cam_alert_detail[cam_id]
                cam_snaps_list  = [s for s in snapshots if s.camera_id == cam_id]
                zone_name = cam_snaps_list[0].zone_name if cam_snaps_list else (
                    cam_alerts_list[0].zone_name if cam_alerts_list else "—"
                )
                n_snaps = len(cam_snaps_list)
                avg_int_cam = (
                    sum(s.motion_intensity_score for s in cam_snaps_list) / n_snaps
                ) if n_snaps else 0.0

                story.append(Paragraph(f"{cam_name}  —  Zone: {zone_name or '—'}", cam_sub_heading))
                story.append(Paragraph(
                    f"{n_snaps} snapshot{'s' if n_snaps != 1 else ''} recorded.  "
                    f"Avg motion intensity: {avg_int_cam:.1f} / 100.  "
                    f"Total alerts: {len(cam_alerts_list)}.",
                    cam_meta_style,
                ))
                detail_rows = [
                    [Paragraph(h, S["th"]) for h in
                     ["Alert Type", "Severity", "Triggered At (PKT)", "Status", "Message"]],
                ]
                for a in sorted(cam_alerts_list, key=lambda x: x.triggered_at or datetime.min):
                    msg = (a.message or "—")
                    detail_rows.append([
                        fmt_atype.get(a.alert_type, a.alert_type.replace("_", " ").title()),
                        a.severity.capitalize() if a.severity else "—",
                        _as_pk(a.triggered_at).strftime("%d %b %Y %H:%M") if a.triggered_at else "—",
                        a.status.capitalize() if a.status else "—",
                        Paragraph(msg, ParagraphStyle("amsg", fontName="Helvetica", fontSize=7.5,
                                                       textColor=C_TEXT, leading=10)),
                    ])
                det_tbl = Table(detail_rows,
                                colWidths=[CONTENT_W * 0.20, CONTENT_W * 0.10,
                                           CONTENT_W * 0.20, CONTENT_W * 0.10, CONTENT_W * 0.40])
                det_tbl.setStyle(_tbl_style())
                story.append(det_tbl)
                story.append(Spacer(1, 0.3 * cm))

        # ── Section 10: Alert Snapshots ──────────────────────────────────────
        snap_alerts = [a for a in alerts if a.snapshot_url and a.snapshot_url.strip()]
        if snap_alerts:
            all_snap_urls_act     = [a.snapshot_url for a in snap_alerts]
            image_bytes_cache_act = _prefetch_image_bytes(all_snap_urls_act, max_workers=min(40, len(all_snap_urls_act)))
            story.append(PageBreak())
            story.append(Paragraph("Alert Snapshots", S["section_heading"]))
            story.append(HRFlowable(width=CONTENT_W, thickness=1, color=C_BORDER, spaceAfter=6))
            story.append(Paragraph(
                f"All {len(snap_alerts)} snapshot{'s' if len(snap_alerts) != 1 else ''} automatically captured "
                f"by the monitoring system at the time of each alert. "
                f"Timestamps shown in Pakistan Standard Time (PKT, UTC+5).",
                S["body"],
            ))
            story.append(Spacer(1, 0.3 * cm))
            MAX_W = CONTENT_W / 2 - 5
            MAX_H = 6.5 * cm
            for pair in [snap_alerts[i:i+2] for i in range(0, len(snap_alerts), 2)]:
                row_cells = []
                for a in pair:
                    cam_lbl = cam_map_act.get(a.camera_id, f"Camera {a.camera_id}") if a.camera_id else "Unknown"
                    ts_lbl  = _fmt_pk(a.triggered_at, "%d %b %Y, %H:%M") if a.triggered_at else "—"
                    img     = _make_rl_image(image_bytes_cache_act.get(a.snapshot_url), MAX_W, MAX_H)
                    cap     = Paragraph(
                        f"<b>Alert:</b> {fmt_atype.get(a.alert_type, a.alert_type.replace('_', ' ').title())}  |  "
                        f"<b>Severity:</b> {a.severity.capitalize() if a.severity else '—'}  |  "
                        f"<b>Zone:</b> {a.zone_name or 'Unspecified'}  |  "
                        f"<b>Camera:</b> {cam_lbl}<br/>{ts_lbl}",
                        S["caption"],
                    )
                    if img:
                        row_cells.append([img, cap])
                    else:
                        row_cells.append([
                            Spacer(1, 2 * cm),
                            Paragraph("[Image unavailable]", ParagraphStyle(
                                "act_ph", fontName="Helvetica-Oblique", fontSize=9,
                                textColor=C_MUTED, alignment=TA_CENTER)),
                            Spacer(1, 2 * cm),
                            cap,
                        ])
                if len(row_cells) == 1:
                    row_cells.append([Spacer(1, 1)])
                photo_row = Table([row_cells], colWidths=[CONTENT_W / 2 - 5, CONTENT_W / 2 - 5])
                photo_row.setStyle(TableStyle([
                    ("VALIGN",        (0, 0), (-1, -1), "TOP"),
                    ("TOPPADDING",    (0, 0), (-1, -1), 6),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                    ("LEFTPADDING",   (0, 0), (-1, -1), 4),
                    ("RIGHTPADDING",  (0, 0), (-1, -1), 4),
                    ("BOX",           (0, 0), (0, -1), 0.4, C_BORDER),
                    ("BOX",           (1, 0), (1, -1), 0.4, C_BORDER),
                ]))
                story.append(photo_row)
                story.append(Spacer(1, 0.3 * cm))

        # ── Section 11: Recommendations ────────────────────────────────────────
        story.append(Spacer(1, 0.5 * cm))
        story.append(Paragraph("Recommendations", S["section_heading"]))
        story.append(HRFlowable(width=CONTENT_W, thickness=1, color=C_BORDER, spaceAfter=6))
        recs = []
        if avg_intensity < 30:
            recs.append(
                "Average motion intensity is below 30/100, indicating consistently low site activity. "
                "Consider reviewing staffing levels or shift schedules for the monitored zones."
            )
        if avg_active_ratio < 40:
            recs.append(
                "Less than 40% of detected workers were actively moving on average. "
                "Review task assignments and identify zones where idle clustering occurs."
            )
        if longest_idle_secs > 1800:
            recs.append(
                f"The longest recorded idle period was {_fmt_secs(longest_idle_secs)}, exceeding 30 minutes. "
                "Investigate zone coverage gaps or equipment downtime during this window."
            )
        idle_alerts = alert_type_counts.get("zone_idle", 0)
        if idle_alerts > 3:
            recs.append(
                f"{idle_alerts} zone idle alerts were raised. Consider adjusting the idle threshold settings "
                "or redistributing workers to maintain consistent coverage across monitored zones."
            )
        drop_alerts = alert_type_counts.get("activity_drop", 0)
        if drop_alerts > 2:
            recs.append(
                f"{drop_alerts} activity drop alerts were detected. Sudden drops may indicate shift breaks, "
                "equipment issues, or access restrictions. Review camera coverage timing and alert thresholds."
            )
        low_alerts = alert_type_counts.get("low_activity_sustained", 0)
        if low_alerts > 2:
            recs.append(
                f"{low_alerts} sustained low-activity alerts were raised. Zones with chronic low activity "
                "should be re-evaluated for camera placement, zone boundary sizing, or staffing allocation."
            )
        repeat_alerts = alert_type_counts.get("repeated_inactivity", 0)
        if repeat_alerts > 1:
            recs.append(
                f"{repeat_alerts} repeated inactivity alerts were recorded. Recurring inactivity patterns "
                "may indicate structural workflow issues. Review shift handover procedures and zone assignments."
            )
        if not recs:
            recs.append(
                "No significant activity concerns were identified during this period. "
                "Activity monitoring thresholds appear well-calibrated for current site conditions. "
                "Continue monitoring and review settings periodically to ensure coverage remains effective."
            )
        rec_style = ParagraphStyle(
            "rec_item", fontName="Helvetica", fontSize=9,
            textColor=C_TEXT, leading=13, leftIndent=12, spaceBefore=4,
        )
        for i, rec in enumerate(recs, 1):
            story.append(Paragraph(f"{i}.  {rec}", rec_style))

        # ── Closing ────────────────────────────────────────────────────────────
        story.append(Spacer(1, 1 * cm))
        story.append(HRFlowable(width=CONTENT_W, thickness=0.5, color=C_BORDER, spaceAfter=6))
        story.append(Paragraph(
            f"This report was automatically generated by ConstructionSight AI Activity Monitoring System "
            f"on {_fmt_pk(gen_dt, '%d %B %Y at %H:%M')} (PKT). Data is derived from automated AI analysis "
            f"and should be reviewed by a qualified site manager. CONFIDENTIAL — authorised personnel only.",
            S["closing"],
        ))

        doc.build(story)
        buf.seek(0)
        return buf.read()

    except ReportGenerationError:
        raise
    except Exception as exc:
        logger.error("Activity PDF generation failed for project %s: %s", project_id, exc, exc_info=True)
        raise ReportGenerationError(f"Activity PDF generation failed: {exc}") from exc


# ── Risk Analysis PDF ─────────────────────────────────────────────────────────

def generate_risk_pdf_report(
    db: Session,
    project_id: int,
    period_start: datetime,
    period_end: datetime,
    triggered_by: str = "manual",
) -> bytes:
    """
    Enterprise-grade Risk Analysis Report.
    Covers: executive summary, KPI snapshot, zone risk table,
    open incidents by type, top risk factors, weather impact, recommendations.
    No per-worker data. No snapshot images.
    """
    import json as _json
    from collections import defaultdict
    from app.models.project import Project
    from app.models.risk_snapshot import RiskSnapshot
    from app.models.risk_event import RiskEvent
    from app.models.ppe_incident import PpeIncident
    from app.models.camera import Camera

    try:
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise ReportGenerationError(f"Project {project_id} not found.")

        # ── Latest snapshot per zone ──────────────────────────────────────────
        from sqlalchemy import func as _func
        latest_ids = (
            db.query(_func.max(RiskSnapshot.id))
            .filter(RiskSnapshot.project_id == project_id)
            .group_by(RiskSnapshot.camera_id)
            .all()
        )
        latest_id_list = [row[0] for row in latest_ids if row[0]]
        snapshots = (
            db.query(RiskSnapshot)
            .filter(RiskSnapshot.id.in_(latest_id_list))
            .order_by(RiskSnapshot.overall_risk.desc())
            .all()
        ) if latest_id_list else []

        # ── Camera map ───────────────────────────────────────────────────────
        cam_ids = list({s.camera_id for s in snapshots if s.camera_id})
        cam_map: dict[int, str] = {}
        if cam_ids:
            cams = db.query(Camera).filter(Camera.id.in_(cam_ids)).all()
            cam_map = {c.id: c.name for c in cams}

        # ── Risk events in period ─────────────────────────────────────────────
        try:
            risk_events = (
                db.query(RiskEvent)
                .filter(
                    RiskEvent.project_id == project_id,
                    RiskEvent.triggered_at >= period_start,
                    RiskEvent.triggered_at <= period_end,
                )
                .order_by(RiskEvent.created_at.desc())
                .all()
            )
        except Exception:
            risk_events = []

        # ── Open incidents (all-time from project start) ───────────────────────
        proj_start_cutoff = None
        if project.start_date:
            sd = project.start_date
            proj_start_cutoff = datetime(sd.year, sd.month, sd.day, tzinfo=timezone.utc)

        open_ppe = open_wf = open_act = 0
        try:
            q = db.query(PpeIncident).filter(
                PpeIncident.project_id == project_id,
                PpeIncident.status == "open",
            )
            if proj_start_cutoff:
                q = q.filter(PpeIncident.started_at >= proj_start_cutoff)
            open_ppe = q.count()
        except Exception:
            pass

        try:
            from app.models.workforce_alert import WorkforceAlert
            q = db.query(WorkforceAlert).filter(
                WorkforceAlert.project_id == project_id,
                WorkforceAlert.status == "open",
            )
            if proj_start_cutoff:
                q = q.filter(WorkforceAlert.triggered_at >= proj_start_cutoff)
            open_wf = q.count()
        except Exception:
            pass

        try:
            from app.models.activity_alert import ActivityAlert
            q = db.query(ActivityAlert).filter(
                ActivityAlert.project_id == project_id,
                ActivityAlert.status == "open",
            )
            if proj_start_cutoff:
                q = q.filter(ActivityAlert.triggered_at >= proj_start_cutoff)
            open_act = q.count()
        except Exception:
            pass

        total_open_incidents = open_ppe + open_wf + open_act

        # ── Aggregate KPIs from snapshots ─────────────────────────────────────
        def _p95(vals):
            if not vals: return 0.0
            vs = sorted(vals)
            if len(vs) <= 2: return float(vs[-1])
            idx = int(__import__('math').ceil(0.95 * (len(vs) - 1)))
            return float(vs[idx])

        overall_vals      = [float(s.overall_risk or 0) for s in snapshots]
        safety_vals       = [float(s.safety_risk or 0) for s in snapshots]
        productivity_vals = [float(s.productivity_risk or 0) for s in snapshots]
        delay_vals        = [float(s.delay_risk or 0) for s in snapshots]

        risk_score_p95    = round(_p95(overall_vals))
        avg_safety        = round(sum(safety_vals) / len(safety_vals)) if safety_vals else 0
        avg_productivity  = round(sum(productivity_vals) / len(productivity_vals)) if productivity_vals else 0
        avg_delay         = round(sum(delay_vals) / len(delay_vals)) if delay_vals else 0

        high_risk_zones   = sum(1 for s in snapshots if s.risk_level in ("high", "critical"))
        compound_zones    = sum(1 for s in snapshots if s.compound_risk_flag)
        critical_zones    = sum(1 for s in snapshots if s.risk_level == "critical")

        if risk_score_p95 >= 75:   overall_level = "CRITICAL"
        elif risk_score_p95 >= 50: overall_level = "HIGH"
        elif risk_score_p95 >= 25: overall_level = "MODERATE"
        else:                       overall_level = "LOW"

        if overall_level == "CRITICAL":    level_color, level_bg = C_RED, C_RED_BG
        elif overall_level == "HIGH":      level_color, level_bg = C_AMBER, C_AMBER_BG
        elif overall_level == "MODERATE":  level_color, level_bg = HexColor("#1e40af"), HexColor("#dbeafe")
        else:                              level_color, level_bg = C_GREEN, C_GREEN_BG

        # ── Top risk factors across all zones ─────────────────────────────────
        factor_agg: dict[str, dict] = defaultdict(lambda: {"contribution": 0, "count": 0, "detail": ""})
        for snap in snapshots:
            try:
                factors = _json.loads(snap.factors_json or "[]")
                for f in factors:
                    key = f.get("factor", "")
                    if not key or f.get("source") == "meta":
                        continue
                    factor_agg[key]["contribution"] += float(f.get("contribution", 0) or 0)
                    factor_agg[key]["count"] += 1
                    if not factor_agg[key]["detail"]:
                        factor_agg[key]["detail"] = f.get("detail", "")
            except Exception:
                pass

        top_factors = sorted(
            [{"factor": k, **v} for k, v in factor_agg.items()],
            key=lambda x: x["contribution"],
            reverse=True,
        )[:10]

        # ── Recommendations across all zones ──────────────────────────────────
        recs_seen: set = set()
        all_recs: list[str] = []
        for snap in snapshots:
            try:
                recs = _json.loads(snap.factors_json or "[]")
            except Exception:
                recs = []
            for r in getattr(snap, "recommendations", None) or []:
                if isinstance(r, str) and r not in recs_seen:
                    recs_seen.add(r)
                    all_recs.append(r)
            if len(all_recs) >= 10:
                break

        # ── Risk events in period summary ──────────────────────────────────────
        ev_open = sum(1 for e in risk_events if e.status == "open")
        ev_ack  = sum(1 for e in risk_events if e.status == "acknowledged")
        ev_res  = sum(1 for e in risk_events if e.status == "resolved")

        gen_dt     = datetime.now(timezone.utc)
        period_str = f"{_as_pk(period_start).strftime('%d %B %Y')} to {_as_pk(period_end).strftime('%d %B %Y')}"

        # ═══════════════════════════════════════════════════════════════════════
        # DOCUMENT SETUP
        # ═══════════════════════════════════════════════════════════════════════
        buf = io.BytesIO()

        cover_frame = Frame(0, 0, PAGE_W, PAGE_H, leftPadding=0, rightPadding=0,
                            topPadding=0, bottomPadding=0, id="cover_frame")
        content_frame = Frame(
            MARGIN_LEFT, MARGIN_BOTTOM, CONTENT_W,
            PAGE_H - MARGIN_TOP - MARGIN_BOTTOM,
            leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0,
            id="content_frame",
        )
        cover_tpl   = PageTemplate(id="Cover",   frames=[cover_frame],   onPage=_cover_background)
        content_tpl = PageTemplate(id="Content", frames=[content_frame], onPage=_content_background)

        doc = BaseDocTemplate(
            buf, pagesize=A4,
            pageTemplates=[cover_tpl, content_tpl],
            title=f"Risk Analysis Report — {project.name}",
            author="ConstructionSight-AI",
        )

        S = _S()
        story = []

        # ── Cover page ────────────────────────────────────────────────────────
        story.append(NextPageTemplate("Content"))
        story.append(PageBreak())

        # ═══════════════════════════════════════════════════════════════════════
        # SECTION 1 — REPORT HEADER
        # ═══════════════════════════════════════════════════════════════════════
        story.append(Paragraph("Risk Analysis Report", ParagraphStyle(
            "rpt_title", fontName="Helvetica-Bold", fontSize=16,
            textColor=C_NAVY, leading=20, spaceAfter=4,
        )))
        story.append(HRFlowable(width=CONTENT_W, thickness=2, color=C_BLUE, spaceAfter=8))

        m_lbl = ParagraphStyle("ml", fontName="Helvetica-Bold", fontSize=9.5, textColor=C_TEXT)
        m_val = ParagraphStyle("mv", fontName="Helvetica",      fontSize=9.5, textColor=C_TEXT)
        m_stat = ParagraphStyle("ms", fontName="Helvetica-Bold", fontSize=9.5, textColor=level_color)

        meta_rows = [
            [Paragraph("Project",      m_lbl), Paragraph(project.name, m_val)],
            [Paragraph("Period",       m_lbl), Paragraph(period_str, m_val)],
            [Paragraph("Generated",    m_lbl), Paragraph(_fmt_pk(gen_dt), m_val)],
            [Paragraph("Overall Risk", m_lbl), Paragraph(f"{overall_level} (Score: {risk_score_p95}/100)", m_stat)],
        ]
        if getattr(project, "location", None):
            meta_rows.insert(1, [Paragraph("Location", m_lbl), Paragraph(project.location, m_val)])

        status_row_idx = len(meta_rows) - 1
        meta_tbl = Table(meta_rows, colWidths=[CONTENT_W * 0.25, CONTENT_W * 0.75])
        meta_tbl.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (0, -1),           C_LIGHT),
            ("FONTSIZE",      (0, 0), (-1, -1),           9.5),
            ("TOPPADDING",    (0, 0), (-1, -1),           6),
            ("BOTTOMPADDING", (0, 0), (-1, -1),           6),
            ("LEFTPADDING",   (0, 0), (-1, -1),           8),
            ("GRID",          (0, 0), (-1, -1),           0.4, C_BORDER),
            ("VALIGN",        (0, 0), (-1, -1),           "MIDDLE"),
            ("BACKGROUND",    (0, status_row_idx), (-1, status_row_idx), level_bg),
        ]))
        story.append(meta_tbl)
        story.append(Spacer(1, 0.5 * cm))

        # ═══════════════════════════════════════════════════════════════════════
        # SECTION 2 — EXECUTIVE SUMMARY
        # ═══════════════════════════════════════════════════════════════════════
        story.append(Paragraph("Executive Summary", S["section_heading"]))
        story.append(HRFlowable(width=CONTENT_W, thickness=1, color=C_BORDER, spaceAfter=6))

        if not snapshots:
            exec_text = (
                "No risk analysis data is available for this project during the selected period. "
                "Ensure the Risk Analysis Engine scheduler is enabled and has completed at least one cycle."
            )
        else:
            zone_word = f"{len(snapshots)} monitoring zone{'s' if len(snapshots) != 1 else ''}"
            exec_text = (
                f"The Risk Analysis Engine has evaluated <b>{zone_word}</b> on this project. "
                f"The project-level risk score stands at <b>{risk_score_p95}/100 ({overall_level})</b>. "
            )
            if critical_zones:
                exec_text += (
                    f"<b>{critical_zones} zone{'s' if critical_zones != 1 else ''} are in CRITICAL status</b> and require immediate intervention. "
                )
            elif high_risk_zones:
                exec_text += (
                    f"{high_risk_zones} zone{'s' if high_risk_zones != 1 else ''} "
                    f"{'are' if high_risk_zones != 1 else 'is'} operating at HIGH risk and warrant prompt attention. "
                )
            else:
                exec_text += "No zones are currently at critical or high risk level. "

            if total_open_incidents:
                exec_text += (
                    f"Across all monitoring sources, <b>{total_open_incidents:,} open incident{'s' if total_open_incidents != 1 else ''}</b> "
                    f"remain unresolved since project start "
                    f"({open_ppe:,} PPE, {open_wf:,} workforce, {open_act:,} activity). "
                )
            if compound_zones:
                exec_text += (
                    f"<b>{compound_zones} zone{'s' if compound_zones != 1 else ''} exhibit compound risk</b> "
                    f"— simultaneous elevation across multiple risk dimensions — requiring coordinated response."
                )

        story.append(Paragraph(exec_text, S["body"]))
        story.append(Spacer(1, 0.4 * cm))

        # ═══════════════════════════════════════════════════════════════════════
        # SECTION 3 — KPI SNAPSHOT
        # ═══════════════════════════════════════════════════════════════════════
        story.append(Paragraph("Risk KPI Snapshot", S["section_heading"]))
        story.append(HRFlowable(width=CONTENT_W, thickness=1, color=C_BORDER, spaceAfter=6))

        kv = ParagraphStyle("kv", fontName="Helvetica-Bold", fontSize=18, textColor=C_NAVY, alignment=TA_CENTER)
        kl = ParagraphStyle("kl", fontName="Helvetica", fontSize=8, textColor=C_MUTED, alignment=TA_CENTER)
        kv_c = ParagraphStyle("kvc", fontName="Helvetica-Bold", fontSize=18, textColor=level_color, alignment=TA_CENTER)
        kv_hr = ParagraphStyle("kvhr", fontName="Helvetica-Bold", fontSize=18,
                               textColor=C_RED if high_risk_zones else C_MUTED, alignment=TA_CENTER)
        kv_oi = ParagraphStyle("kvoi", fontName="Helvetica-Bold", fontSize=18,
                               textColor=C_AMBER if total_open_incidents else C_MUTED, alignment=TA_CENTER)
        kv_cp = ParagraphStyle("kvcp", fontName="Helvetica-Bold", fontSize=18,
                               textColor=C_RED if compound_zones else C_MUTED, alignment=TA_CENTER)

        kpi_tbl = Table(
            [
                [Paragraph(str(risk_score_p95),        kv_c),
                 Paragraph(str(high_risk_zones),        kv_hr),
                 Paragraph(f"{total_open_incidents:,}", kv_oi),
                 Paragraph(str(compound_zones),         kv_cp),
                 Paragraph(str(len(snapshots)),          kv)],
                [Paragraph("Risk Score (P95)",     kl),
                 Paragraph("High-Risk Zones",      kl),
                 Paragraph("Open Incidents",        kl),
                 Paragraph("Compound Risk Zones",   kl),
                 Paragraph("Zones Monitored",       kl)],
            ],
            colWidths=[CONTENT_W / 5] * 5,
        )
        kpi_tbl.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (-1, -1), C_LIGHT),
            ("BOX",           (0, 0), (-1, -1), 0.5, C_BORDER),
            ("TOPPADDING",    (0, 0), (-1, -1), 10),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ]))
        story.append(kpi_tbl)
        story.append(Spacer(1, 0.5 * cm))

        # ═══════════════════════════════════════════════════════════════════════
        # SECTION 4 — OPEN INCIDENTS BREAKDOWN
        # ═══════════════════════════════════════════════════════════════════════
        story.append(Paragraph("Open Incidents by Feature (Project Start to Date)", S["section_heading"]))
        story.append(HRFlowable(width=CONTENT_W, thickness=1, color=C_BORDER, spaceAfter=6))

        inc_data = [
            [Paragraph("Feature",          S["th"]),
             Paragraph("Open Incidents",   S["th"]),
             Paragraph("% of Total",       S["th"]),
             Paragraph("Status",           S["th"])],
        ]
        for label, count in [("PPE Violations", open_ppe), ("Workforce Alerts", open_wf), ("Activity Alerts", open_act)]:
            pct = f"{round(count / total_open_incidents * 100)}%" if total_open_incidents else "—"
            status_txt = "Requires Attention" if count > 0 else "Clear"
            status_col = C_AMBER if count > 0 else C_GREEN
            inc_data.append([
                Paragraph(label, S["td"]),
                Paragraph(f"{count:,}", S["td"]),
                Paragraph(pct, S["td"]),
                Paragraph(status_txt, ParagraphStyle("is", fontName="Helvetica-Bold", fontSize=8, textColor=status_col, leading=12)),
            ])
        inc_tbl = Table(inc_data, colWidths=[CONTENT_W * 0.40, CONTENT_W * 0.20, CONTENT_W * 0.20, CONTENT_W * 0.20])
        inc_tbl.setStyle(_tbl_style())
        story.append(inc_tbl)
        story.append(Spacer(1, 0.5 * cm))

        # ═══════════════════════════════════════════════════════════════════════
        # SECTION 5 — ZONE RISK BREAKDOWN
        # ═══════════════════════════════════════════════════════════════════════
        if snapshots:
            story.append(Paragraph("Zone Risk Breakdown", S["section_heading"]))
            story.append(HRFlowable(width=CONTENT_W, thickness=1, color=C_BORDER, spaceAfter=6))

            zone_data = [
                [Paragraph("Zone",               S["th"]),
                 Paragraph("Overall",            S["th"]),
                 Paragraph("PPE Risk",           S["th"]),
                 Paragraph("Workforce Risk",      S["th"]),
                 Paragraph("Activity Risk",       S["th"]),
                 Paragraph("Risk Level",          S["th"]),
                 Paragraph("Trend",               S["th"]),
                 Paragraph("Compound",            S["th"])],
            ]

            extra_styles = []
            for row_i, snap in enumerate(snapshots, start=1):
                rl = snap.risk_level or "low"
                rc = (C_RED    if rl == "critical" else
                      C_AMBER  if rl == "high"     else
                      C_BLUE   if rl == "moderate" else C_GREEN)
                trend_sym = {"rising": "↑ Rising", "decreasing": "↓ Falling", "stable": "→ Stable"}.get(snap.trend or "", "—")
                compound_txt = "YES" if snap.compound_risk_flag else "—"
                zone_name = snap.zone_name or cam_map.get(snap.camera_id) or f"Camera {snap.camera_id}"

                zone_data.append([
                    Paragraph(zone_name[:28], S["td"]),
                    Paragraph(str(round(snap.overall_risk or 0)), S["td"]),
                    Paragraph(str(round(snap.safety_risk or 0)), S["td"]),
                    Paragraph(str(round(snap.productivity_risk or 0)), S["td"]),
                    Paragraph(str(round(snap.delay_risk or 0)), S["td"]),
                    Paragraph(rl.upper(), ParagraphStyle(f"rl{row_i}", fontName="Helvetica-Bold", fontSize=7.5, textColor=rc, leading=11)),
                    Paragraph(trend_sym, S["td_sm"]),
                    Paragraph(compound_txt, ParagraphStyle(f"cp{row_i}", fontName="Helvetica-Bold", fontSize=8,
                              textColor=C_RED if snap.compound_risk_flag else C_MUTED, leading=12)),
                ])
                if snap.compound_risk_flag:
                    extra_styles.append(("BACKGROUND", (0, row_i), (-1, row_i), C_RED_BG))

            cw = CONTENT_W
            zone_tbl = Table(zone_data, colWidths=[cw*0.20, cw*0.08, cw*0.09, cw*0.12, cw*0.12, cw*0.13, cw*0.14, cw*0.12])
            zone_tbl.setStyle(_tbl_style(extra_styles))
            story.append(zone_tbl)
            story.append(Spacer(1, 0.5 * cm))

        # ═══════════════════════════════════════════════════════════════════════
        # SECTION 6 — RISK SCORE DIMENSIONS
        # ═══════════════════════════════════════════════════════════════════════
        story.append(Paragraph("Risk Score Dimensions", S["section_heading"]))
        story.append(HRFlowable(width=CONTENT_W, thickness=1, color=C_BORDER, spaceAfter=6))

        def _score_label(v):
            if v >= 75: return "Critical"
            if v >= 50: return "High"
            if v >= 25: return "Moderate"
            return "Low"

        def _score_color(v):
            if v >= 75: return C_RED
            if v >= 50: return C_AMBER
            if v >= 25: return C_BLUE
            return C_GREEN

        dim_data = [
            [Paragraph("Dimension",   S["th"]),
             Paragraph("Avg Score",   S["th"]),
             Paragraph("Status",      S["th"]),
             Paragraph("Weight",      S["th"]),
             Paragraph("Description", S["th"])],
        ]
        dimensions = [
            ("PPE / Safety Risk",         avg_safety,       "35%", "Counts open PPE violations from project start. Resolved violations auto-reduce this score."),
            ("Workforce / Delay Risk",     avg_delay,        "40%", "Measures idle time, understaffing, and open workforce alerts from project start."),
            ("Activity / Productivity Risk", avg_productivity, "25%", "Measures motion intensity, utilization, idle ratio, and open activity alerts."),
        ]
        for dim_name, dim_score, dim_weight, dim_desc in dimensions:
            sc = _score_color(dim_score)
            dim_data.append([
                Paragraph(dim_name, S["td"]),
                Paragraph(f"{dim_score}/100", ParagraphStyle("ds", fontName="Helvetica-Bold", fontSize=8, textColor=sc, leading=12)),
                Paragraph(_score_label(dim_score), ParagraphStyle("dl", fontName="Helvetica-Bold", fontSize=8, textColor=sc, leading=12)),
                Paragraph(dim_weight, S["td"]),
                Paragraph(dim_desc, S["td_sm"]),
            ])
        dim_tbl = Table(dim_data, colWidths=[CONTENT_W*0.22, CONTENT_W*0.10, CONTENT_W*0.12, CONTENT_W*0.08, CONTENT_W*0.48])
        dim_tbl.setStyle(_tbl_style())
        story.append(dim_tbl)
        story.append(Spacer(1, 0.5 * cm))

        # ═══════════════════════════════════════════════════════════════════════
        # SECTION 7 — TOP RISK FACTORS
        # ═══════════════════════════════════════════════════════════════════════
        if top_factors:
            story.append(Paragraph("Top Risk Factors (Aggregated Across All Zones)", S["section_heading"]))
            story.append(HRFlowable(width=CONTENT_W, thickness=1, color=C_BORDER, spaceAfter=6))

            fac_data = [
                [Paragraph("Risk Factor",      S["th"]),
                 Paragraph("Total Impact",     S["th"]),
                 Paragraph("Zones Affected",   S["th"]),
                 Paragraph("Detail",           S["th"])],
            ]
            for f in top_factors:
                fac_data.append([
                    Paragraph(str(f["factor"])[:50], S["td"]),
                    Paragraph(str(round(f["contribution"])), S["td"]),
                    Paragraph(str(f["count"]), S["td"]),
                    Paragraph(str(f.get("detail", ""))[:80], S["td_sm"]),
                ])
            fac_tbl = Table(fac_data, colWidths=[CONTENT_W*0.30, CONTENT_W*0.13, CONTENT_W*0.13, CONTENT_W*0.44])
            fac_tbl.setStyle(_tbl_style())
            story.append(fac_tbl)
            story.append(Spacer(1, 0.5 * cm))

        # ═══════════════════════════════════════════════════════════════════════
        # SECTION 8 — RISK EVENTS IN PERIOD
        # ═══════════════════════════════════════════════════════════════════════
        if risk_events:
            story.append(Paragraph(f"Risk Events in Period ({len(risk_events)} total)", S["section_heading"]))
            story.append(HRFlowable(width=CONTENT_W, thickness=1, color=C_BORDER, spaceAfter=6))

            ev_sum_text = (
                f"During the selected period, the risk engine generated <b>{len(risk_events)} risk "
                f"event{'s' if len(risk_events) != 1 else ''}</b>: "
                f"{ev_res} resolved, {ev_ack} acknowledged, {ev_open} still open."
            )
            story.append(Paragraph(ev_sum_text, S["body"]))
            story.append(Spacer(1, 0.3 * cm))

            ev_data = [
                [Paragraph("Date / Time",  S["th"]),
                 Paragraph("Zone",         S["th"]),
                 Paragraph("Severity",     S["th"]),
                 Paragraph("Status",       S["th"]),
                 Paragraph("Description",  S["th"])],
            ]
            shown = risk_events[:40]
            for ev in shown:
                sev_color = C_RED if getattr(ev, "severity", "") == "critical" else C_AMBER if getattr(ev, "severity", "") == "high" else C_TEXT
                stat_color = C_GREEN if ev.status == "resolved" else C_AMBER if ev.status == "acknowledged" else C_RED
                ev_data.append([
                    Paragraph(_fmt_pk(ev.triggered_at, "%d %b %Y %H:%M"), S["td_sm"]),
                    Paragraph((ev.zone_name or "—")[:22], S["td_sm"]),
                    Paragraph((getattr(ev, "severity", "") or "—").upper(),
                              ParagraphStyle("evs", fontName="Helvetica-Bold", fontSize=7.5, textColor=sev_color, leading=11)),
                    Paragraph(ev.status.upper(),
                              ParagraphStyle("evst", fontName="Helvetica-Bold", fontSize=7.5, textColor=stat_color, leading=11)),
                    Paragraph((ev.message or "—")[:60], S["td_sm"]),
                ])
            ev_tbl = Table(ev_data, colWidths=[CONTENT_W*0.18, CONTENT_W*0.17, CONTENT_W*0.11, CONTENT_W*0.13, CONTENT_W*0.41])
            ev_tbl.setStyle(_tbl_style())
            story.append(ev_tbl)
            if len(risk_events) > 40:
                story.append(Paragraph(f"… and {len(risk_events) - 40} more events not shown.", S["note"]))
            story.append(Spacer(1, 0.5 * cm))

        # ═══════════════════════════════════════════════════════════════════════
        # SECTION 9 — WEATHER CONDITIONS
        # ═══════════════════════════════════════════════════════════════════════
        weather_snap = next((s for s in snapshots if s.weather_condition), None)
        if weather_snap:
            story.append(Paragraph("Current Weather Conditions", S["section_heading"]))
            story.append(HRFlowable(width=CONTENT_W, thickness=1, color=C_BORDER, spaceAfter=6))

            wx_rows = [
                [Paragraph("Condition",    m_lbl), Paragraph(str(weather_snap.weather_condition or "—"), m_val)],
                [Paragraph("Temperature",  m_lbl), Paragraph(f"{round(weather_snap.weather_temp)}°C" if weather_snap.weather_temp is not None else "—", m_val)],
                [Paragraph("Wind Speed",   m_lbl), Paragraph(f"{round((weather_snap.weather_wind or 0) * 3.6)} km/h" if weather_snap.weather_wind is not None else "—", m_val)],
                [Paragraph("Rainfall",     m_lbl), Paragraph(f"{weather_snap.weather_rain:.1f} mm/h" if weather_snap.weather_rain else "None", m_val)],
            ]
            wx_tbl = Table(wx_rows, colWidths=[CONTENT_W * 0.25, CONTENT_W * 0.75])
            wx_tbl.setStyle(TableStyle([
                ("BACKGROUND",    (0, 0), (0, -1), C_LIGHT),
                ("FONTSIZE",      (0, 0), (-1, -1), 9.5),
                ("TOPPADDING",    (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("LEFTPADDING",   (0, 0), (-1, -1), 8),
                ("GRID",          (0, 0), (-1, -1), 0.4, C_BORDER),
                ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
            ]))
            story.append(wx_tbl)
            story.append(Spacer(1, 0.5 * cm))

        # ═══════════════════════════════════════════════════════════════════════
        # SECTION 10 — RECOMMENDATIONS
        # ═══════════════════════════════════════════════════════════════════════
        if all_recs:
            story.append(Paragraph("Recommendations", S["section_heading"]))
            story.append(HRFlowable(width=CONTENT_W, thickness=1, color=C_BORDER, spaceAfter=6))
            for i, rec in enumerate(all_recs[:10], start=1):
                story.append(Paragraph(f"{i}. {rec}", S["body"]))
            story.append(Spacer(1, 0.4 * cm))

        # ── Closing ───────────────────────────────────────────────────────────
        story.append(HRFlowable(width=CONTENT_W, thickness=0.5, color=C_BORDER, spaceAfter=6))
        story.append(Paragraph(
            f"This report was generated automatically by ConstructionSight-AI on {_fmt_pk(gen_dt)}. "
            "Risk scores reflect the latest scheduler cycle results. "
            "Resolving open incidents will reduce corresponding risk scores on the next analysis cycle.",
            S["closing"],
        ))

        doc.build(story)
        return buf.getvalue()

    except ReportGenerationError:
        raise
    except Exception as exc:
        logger.error("Risk PDF generation failed for project %s: %s", project_id, exc, exc_info=True)
        raise ReportGenerationError(f"Risk PDF generation failed: {exc}") from exc


# ── Projects List PDF ──────────────────────────────────────────────────────────

def generate_projects_pdf_report(
    projects: list,
    filter_label: str = "All Projects",
    generated_by: str = "Administrator",
) -> bytes:
    """
    Generate a portrait A4 PDF listing all admin projects.
    Matches the PPE report visual style exactly: cover.png + page_template.png.
    """
    try:
        buf = io.BytesIO()
        gen_dt = datetime.now(timezone.utc)

        # ── Identical frame+doc setup to PPE report ────────────────────────────
        cover_frame = Frame(0, 0, PAGE_W, PAGE_H,
                            leftPadding=0, rightPadding=0,
                            topPadding=0, bottomPadding=0, id="cover_frame")
        content_frame = Frame(
            MARGIN_LEFT, MARGIN_BOTTOM,
            CONTENT_W,
            PAGE_H - MARGIN_TOP - MARGIN_BOTTOM,
            leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0,
            id="content_frame",
        )
        cover_tpl   = PageTemplate(id="Cover",   frames=[cover_frame],   onPage=_cover_background)
        content_tpl = PageTemplate(id="Content", frames=[content_frame], onPage=_content_background)

        doc = BaseDocTemplate(
            buf,
            pagesize=A4,
            pageTemplates=[cover_tpl, content_tpl],
            title="Projects Directory Report",
            author="ConstructionSight-AI",
        )

        S = _S()

        # ── Helpers ────────────────────────────────────────────────────────────
        _STATUS_BG = {
            "active":            C_GREEN_BG,
            "archived":          C_RED_BG,
            "completed":         C_LIGHT,
            "draft":             HexColor("#e8eef7"),
            "setup_in_progress": C_AMBER_BG,
        }
        _STATUS_FG = {
            "active":            C_GREEN,
            "archived":          C_RED,
            "completed":         C_MUTED,
            "draft":             C_NAVY,
            "setup_in_progress": C_AMBER,
        }

        def _status_label(s: str) -> str:
            return {
                "active": "Active", "archived": "Archived", "completed": "Completed",
                "draft": "Draft", "setup_in_progress": "Setup In Progress",
            }.get(s.lower(), s.replace("_", " ").title())

        def _fmt_date(v) -> str:
            if not v:
                return "—"
            try:
                if isinstance(v, str):
                    dt = datetime.fromisoformat(v.replace("Z", "+00:00"))
                    return dt.strftime("%b %d, %Y")
                if hasattr(v, "strftime"):
                    return v.strftime("%b %d, %Y")
                return str(v)
            except Exception:
                return str(v)

        def _get(p, key):
            v = p.get(key) if isinstance(p, dict) else getattr(p, key, None)
            return v.value if hasattr(v, 'value') and not isinstance(v, (int, float)) else v

        story: list = []

        # ── PAGE 1: Cover (blank flowable — background drawn by callback) ──────
        story.append(NextPageTemplate("Content"))
        story.append(PageBreak())

        # ── SECTION 1: Report Header (identical pattern to PPE) ────────────────
        story.append(Paragraph("Projects Directory Report", ParagraphStyle(
            "proj_rpt_title", fontName="Helvetica-Bold", fontSize=16,
            textColor=C_NAVY, leading=20, spaceAfter=4,
        )))
        story.append(HRFlowable(width=CONTENT_W, thickness=2, color=C_BLUE, spaceAfter=8))

        # Metadata table — same structure as PPE (label col C_LIGHT bg, 9.5pt font)
        m_lbl = ParagraphStyle("proj_ml", fontName="Helvetica-Bold", fontSize=9.5, textColor=C_TEXT)
        m_val = ParagraphStyle("proj_mv", fontName="Helvetica",      fontSize=9.5, textColor=C_TEXT)

        total       = len(projects)
        active_n    = sum(1 for p in projects if str(_get(p, "status") or "").lower() == "active")
        archived_n  = sum(1 for p in projects if str(_get(p, "status") or "").lower() == "archived")
        completed_n = sum(1 for p in projects if str(_get(p, "status") or "").lower() == "completed")
        draft_n     = sum(1 for p in projects if str(_get(p, "status") or "").lower() == "draft")

        meta_rows = [
            [Paragraph("Filter",     m_lbl), Paragraph(filter_label, m_val)],
            [Paragraph("Generated",  m_lbl), Paragraph(_fmt_pk(gen_dt), m_val)],
            [Paragraph("By",         m_lbl), Paragraph(generated_by, m_val)],
            [Paragraph("Total",      m_lbl), Paragraph(str(total), m_val)],
        ]
        meta_tbl = Table(meta_rows, colWidths=[CONTENT_W * 0.25, CONTENT_W * 0.75])
        meta_tbl.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (0, -1), C_LIGHT),
            ("FONTNAME",      (0, 0), (0, -1), "Helvetica-Bold"),
            ("FONTSIZE",      (0, 0), (-1, -1), 9.5),
            ("TOPPADDING",    (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LEFTPADDING",   (0, 0), (-1, -1), 8),
            ("GRID",          (0, 0), (-1, -1), 0.4, C_BORDER),
            ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ]))
        story.append(meta_tbl)
        story.append(Spacer(1, 0.5 * cm))

        # ── SECTION 2: KPI summary (one row, 5 cells, matching PPE KPI style) ──
        story.append(Paragraph("Summary", ParagraphStyle(
            "proj_sh", fontName="Helvetica-Bold", fontSize=14,
            textColor=C_NAVY, leading=18, spaceBefore=6, spaceAfter=6,
        )))

        def _kpi_para(count, label, fg):
            num_style = ParagraphStyle(f"kpi_{label}", fontName="Helvetica-Bold",
                                       fontSize=22, textColor=fg, leading=26, alignment=TA_CENTER)
            lbl_style = ParagraphStyle(f"kpi_l_{label}", fontName="Helvetica",
                                       fontSize=8, textColor=fg, leading=11, alignment=TA_CENTER)
            from reportlab.platypus import KeepTogether as KT
            return [Paragraph(str(count), num_style), Paragraph(label, lbl_style)]

        kpi_col_w = CONTENT_W / 5
        kpi_rows = [
            [_kpi_para(total,       "Total",     C_WHITE),
             _kpi_para(active_n,    "Active",    C_GREEN),
             _kpi_para(archived_n,  "Archived",  C_RED),
             _kpi_para(completed_n, "Completed", C_MUTED),
             _kpi_para(draft_n,     "Draft",     C_NAVY)],
        ]
        kpi_tbl = Table(kpi_rows, colWidths=[kpi_col_w] * 5)
        kpi_tbl.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (0, 0), C_NAVY),
            ("BACKGROUND",    (1, 0), (1, 0), C_GREEN_BG),
            ("BACKGROUND",    (2, 0), (2, 0), C_RED_BG),
            ("BACKGROUND",    (3, 0), (3, 0), C_LIGHT),
            ("BACKGROUND",    (4, 0), (4, 0), HexColor("#e8eef7")),
            ("ALIGN",         (0, 0), (-1, -1), "CENTER"),
            ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING",    (0, 0), (-1, -1), 10),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
            ("GRID",          (0, 0), (-1, -1), 0.4, C_BORDER),
        ]))
        story.append(kpi_tbl)
        story.append(Spacer(1, 0.7 * cm))

        # ── SECTION 3: Projects table ──────────────────────────────────────────
        story.append(Paragraph("Project Listing", ParagraphStyle(
            "proj_listing_h", fontName="Helvetica-Bold", fontSize=14,
            textColor=C_NAVY, leading=18, spaceBefore=6, spaceAfter=6,
        )))
        story.append(HRFlowable(width=CONTENT_W, thickness=0.8, color=C_BLUE, spaceAfter=8))

        # Column widths summing to CONTENT_W (~551pt)
        col_widths = [132, 74, 96, 62, 62, 62, 63]
        headers = [
            Paragraph("Project Name", S["th"]),
            Paragraph("Client",       S["th"]),
            Paragraph("Location",     S["th"]),
            Paragraph("Status",       S["th"]),
            Paragraph("Start Date",   S["th"]),
            Paragraph("End Date",     S["th"]),
            Paragraph("Created At",   S["th"]),
        ]
        rows_data = [headers]
        extra_styles = []

        for i, p in enumerate(projects):
            status_raw = str(_get(p, "status") or "").lower()
            sl = _status_label(status_raw)
            fg = _STATUS_FG.get(status_raw, C_MUTED)
            bg = _STATUS_BG.get(status_raw, C_LIGHT)
            row_idx = i + 1

            # Status cell Paragraph needs its own style with the right foreground color
            st_style = ParagraphStyle(f"st_{i}", fontName="Helvetica-Bold",
                                      fontSize=7.5, textColor=fg, leading=11)
            rows_data.append([
                Paragraph(str(_get(p, "name") or "—"), S["td"]),
                Paragraph(str(_get(p, "client_name") or "—"), S["td_sm"]),
                Paragraph(str(_get(p, "location") or "—"), S["td_sm"]),
                Paragraph(sl, st_style),
                Paragraph(_fmt_date(_get(p, "start_date")), S["td_sm"]),
                Paragraph(_fmt_date(_get(p, "end_date")), S["td_sm"]),
                Paragraph(_fmt_date(_get(p, "created_at")), S["td_sm"]),
            ])
            extra_styles.append(("BACKGROUND", (3, row_idx), (3, row_idx), bg))

        proj_tbl = Table(rows_data, colWidths=col_widths, repeatRows=1)
        proj_tbl.setStyle(_tbl_style(extra_styles))
        story.append(proj_tbl)

        # ── Closing ────────────────────────────────────────────────────────────
        story.append(Spacer(1, 1 * cm))
        story.append(HRFlowable(width=CONTENT_W, thickness=0.5, color=C_BORDER, spaceAfter=6))
        story.append(Paragraph(
            f"This report was automatically generated by ConstructionSight AI "
            f"on {_fmt_pk(gen_dt, '%d %B %Y at %H:%M')}. "
            "Data reflects the current state of all registered projects. "
            "CONFIDENTIAL — authorised personnel only.",
            S["closing"],
        ))

        doc.build(story)
        buf.seek(0)
        return buf.read()

    except ReportGenerationError:
        raise
    except Exception as exc:
        logger.error("Projects PDF generation failed: %s", exc, exc_info=True)
        raise ReportGenerationError(f"Projects PDF generation failed: {exc}") from exc


def generate_generic_table_pdf(
    title: str,
    headers: list,
    rows: list,
    col_widths: list,
    meta_pairs: Optional[list] = None,
    filter_label: str = "All",
    generated_by: str = "Administrator",
    kpi_items: Optional[list] = None,
    status_col_index: Optional[int] = None,
    status_fg: Optional[dict] = None,
    status_bg: Optional[dict] = None,
) -> bytes:
    try:
        buf = io.BytesIO()
        gen_dt = datetime.now(timezone.utc)

        cover_frame = Frame(0, 0, PAGE_W, PAGE_H,
                            leftPadding=0, rightPadding=0,
                            topPadding=0, bottomPadding=0, id="cover_frame")
        content_frame = Frame(
            MARGIN_LEFT, MARGIN_BOTTOM,
            CONTENT_W,
            PAGE_H - MARGIN_TOP - MARGIN_BOTTOM,
            leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0,
            id="content_frame",
        )
        cover_tpl = PageTemplate(id="Cover", frames=[cover_frame], onPage=_cover_background)
        content_tpl = PageTemplate(id="Content", frames=[content_frame], onPage=_content_background)

        doc = BaseDocTemplate(
            buf,
            pagesize=A4,
            pageTemplates=[cover_tpl, content_tpl],
            title=title,
            author="ConstructionSight-AI",
        )

        S = _S()

        story: list = []
        story.append(NextPageTemplate("Content"))
        story.append(PageBreak())

        story.append(Paragraph(str(title or "Report"), ParagraphStyle(
            "gen_title", fontName="Helvetica-Bold", fontSize=16,
            textColor=C_NAVY, leading=20, spaceAfter=4,
        )))
        story.append(HRFlowable(width=CONTENT_W, thickness=2, color=C_BLUE, spaceAfter=8))

        m_lbl = ParagraphStyle("gen_ml", fontName="Helvetica-Bold", fontSize=9.5, textColor=C_TEXT)
        m_val = ParagraphStyle("gen_mv", fontName="Helvetica", fontSize=9.5, textColor=C_TEXT)

        meta_rows = []
        if meta_pairs:
            for k, v in meta_pairs:
                meta_rows.append([Paragraph(str(k), m_lbl), Paragraph(str(v), m_val)])
        meta_rows.extend([
            [Paragraph("Filter", m_lbl), Paragraph(str(filter_label), m_val)],
            [Paragraph("Generated", m_lbl), Paragraph(_fmt_pk(gen_dt), m_val)],
            [Paragraph("By", m_lbl), Paragraph(str(generated_by), m_val)],
            [Paragraph("Total", m_lbl), Paragraph(str(len(rows or [])), m_val)],
        ])

        meta_tbl = Table(meta_rows, colWidths=[CONTENT_W * 0.25, CONTENT_W * 0.75])
        meta_tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (0, -1), C_LIGHT),
            ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 9.5),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("GRID", (0, 0), (-1, -1), 0.4, C_BORDER),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]))
        story.append(meta_tbl)
        story.append(Spacer(1, 0.5 * cm))

        if kpi_items:
            story.append(Paragraph("Summary", ParagraphStyle(
                "gen_sum_h", fontName="Helvetica-Bold", fontSize=14,
                textColor=C_NAVY, leading=18, spaceBefore=6, spaceAfter=6,
            )))

            def _kpi_para(count, label, fg):
                num_style = ParagraphStyle(
                    f"gen_kpi_{label}",
                    fontName="Helvetica-Bold",
                    fontSize=22,
                    textColor=fg,
                    leading=26,
                    alignment=TA_CENTER,
                )
                lbl_style = ParagraphStyle(
                    f"gen_kpi_l_{label}",
                    fontName="Helvetica",
                    fontSize=8,
                    textColor=fg,
                    leading=11,
                    alignment=TA_CENTER,
                )
                return [Paragraph(str(count), num_style), Paragraph(str(label), lbl_style)]

            n = max(1, len(kpi_items))
            kpi_col_w = CONTENT_W / n
            kpi_rows = [[_kpi_para(c, l, fg) for (c, l, fg, _bg) in kpi_items]]
            kpi_tbl = Table(kpi_rows, colWidths=[kpi_col_w] * n)
            kpi_style = []
            for i, (_c, _l, _fg, bg) in enumerate(kpi_items):
                kpi_style.append(("BACKGROUND", (i, 0), (i, 0), bg))
            kpi_style.extend([
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 10),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
                ("GRID", (0, 0), (-1, -1), 0.4, C_BORDER),
            ])
            kpi_tbl.setStyle(TableStyle(kpi_style))
            story.append(kpi_tbl)
            story.append(Spacer(1, 0.7 * cm))

        story.append(Paragraph("Listing", ParagraphStyle(
            "gen_list_h", fontName="Helvetica-Bold", fontSize=14,
            textColor=C_NAVY, leading=18, spaceBefore=6, spaceAfter=6,
        )))
        story.append(HRFlowable(width=CONTENT_W, thickness=0.8, color=C_BLUE, spaceAfter=8))

        th_cells = [Paragraph(str(h), S["th"]) for h in (headers or [])]
        rows_data = [th_cells]
        extra_styles = []

        for i, r in enumerate(rows or []):
            row_idx = i + 1
            cells = []
            for j, v in enumerate(r or []):
                if isinstance(v, datetime):
                    txt = _as_pk(v).strftime("%b %d, %Y %H:%M")
                else:
                    txt = "—" if v is None else str(v)
                if status_col_index is not None and j == status_col_index:
                    key = str(v or "").strip().lower()
                    fg = (status_fg or {}).get(key, C_MUTED)
                    bg = (status_bg or {}).get(key, C_LIGHT)
                    st_style = ParagraphStyle(
                        f"gen_st_{i}_{j}",
                        fontName="Helvetica-Bold",
                        fontSize=7.5,
                        textColor=fg,
                        leading=11,
                        alignment=TA_CENTER,
                        splitLongWords=0,
                    )
                    cells.append(Paragraph(txt, st_style))
                    extra_styles.append(("BACKGROUND", (j, row_idx), (j, row_idx), bg))
                else:
                    cells.append(Paragraph(txt, S["td_sm"]))
            rows_data.append(cells)

        tbl = Table(rows_data, colWidths=col_widths, repeatRows=1)
        tbl.setStyle(_tbl_style(extra_styles))
        story.append(tbl)

        story.append(Spacer(1, 1 * cm))
        story.append(HRFlowable(width=CONTENT_W, thickness=0.5, color=C_BORDER, spaceAfter=6))
        story.append(Paragraph(
            f"This report was automatically generated by ConstructionSight AI "
            f"on {_fmt_pk(gen_dt, '%d %B %Y at %H:%M')}. "
            "CONFIDENTIAL — authorised personnel only.",
            S["closing"],
        ))

        doc.build(story)
        buf.seek(0)
        return buf.read()
    except ReportGenerationError:
        raise
    except Exception as exc:
        logger.error("Generic PDF generation failed: %s", exc, exc_info=True)
        raise ReportGenerationError(f"PDF generation failed: {exc}") from exc


def generate_invitations_pdf_report(
    invitations: list,
    filter_label: str = "All Invitations",
    generated_by: str = "Administrator",
) -> bytes:
    """
    Generate a portrait A4 PDF listing all admin invitations.
    Matches the Projects export visual style exactly: cover.png + page_template.png.
    """
    try:
        buf = io.BytesIO()
        gen_dt = datetime.now(timezone.utc)

        cover_frame = Frame(0, 0, PAGE_W, PAGE_H,
                            leftPadding=0, rightPadding=0,
                            topPadding=0, bottomPadding=0, id="cover_frame")
        content_frame = Frame(
            MARGIN_LEFT, MARGIN_BOTTOM,
            CONTENT_W,
            PAGE_H - MARGIN_TOP - MARGIN_BOTTOM,
            leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0,
            id="content_frame",
        )
        cover_tpl   = PageTemplate(id="Cover",   frames=[cover_frame],   onPage=_cover_background)
        content_tpl = PageTemplate(id="Content", frames=[content_frame], onPage=_content_background)

        doc = BaseDocTemplate(
            buf,
            pagesize=A4,
            pageTemplates=[cover_tpl, content_tpl],
            title="Invitations Directory Report",
            author="ConstructionSight-AI",
        )

        S = _S()

        def _get(inv, key):
            v = inv.get(key) if isinstance(inv, dict) else getattr(inv, key, None)
            return v.value if hasattr(v, 'value') and not isinstance(v, (int, float)) else v

        def _role_label(role: str) -> str:
            raw = str(role or "").strip()
            if not raw:
                return "—"
            return raw.replace("_", " ").title()

        def _derived_status(inv) -> str:
            s = str(_get(inv, "status") or "").lower()
            if s == "pending":
                ex = _get(inv, "expires_at")
                try:
                    if ex and getattr(ex, "tzinfo", None) is None:
                        ex = ex.replace(tzinfo=timezone.utc)
                    if ex and ex <= datetime.now(timezone.utc):
                        return "expired"
                except Exception:
                    pass
            return s or "—"

        def _status_label(s: str) -> str:
            return {
                "pending": "Pending",
                "accepted": "Accepted",
                "expired": "Expired",
                "cancelled": "Cancelled",
            }.get(str(s or "").lower(), str(s or "—").replace("_", " ").title())

        _STATUS_BG = {
            "pending":   C_AMBER_BG,
            "accepted":  C_GREEN_BG,
            "expired":   C_RED_BG,
            "cancelled": C_RED_BG,
        }
        _STATUS_FG = {
            "pending":   C_AMBER,
            "accepted":  C_GREEN,
            "expired":   C_RED,
            "cancelled": C_RED,
        }

        def _fmt_date(v) -> str:
            if not v:
                return "—"
            try:
                if isinstance(v, str):
                    dt = datetime.fromisoformat(v.replace("Z", "+00:00"))
                    return _as_pk(dt).strftime("%b %d, %Y")
                if hasattr(v, "strftime"):
                    return _as_pk(v).strftime("%b %d, %Y")
                return str(v)
            except Exception:
                return str(v)

        story: list = []

        story.append(NextPageTemplate("Content"))
        story.append(PageBreak())

        story.append(Paragraph("Invitations Directory Report", ParagraphStyle(
            "inv_rpt_title", fontName="Helvetica-Bold", fontSize=16,
            textColor=C_NAVY, leading=20, spaceAfter=4,
        )))
        story.append(HRFlowable(width=CONTENT_W, thickness=2, color=C_BLUE, spaceAfter=8))

        m_lbl = ParagraphStyle("inv_ml", fontName="Helvetica-Bold", fontSize=9.5, textColor=C_TEXT)
        m_val = ParagraphStyle("inv_mv", fontName="Helvetica",      fontSize=9.5, textColor=C_TEXT)

        total = len(invitations)
        pending_n = 0
        accepted_n = 0
        expired_n = 0
        cancelled_n = 0
        for inv in invitations:
            ds = _derived_status(inv)
            if ds == "accepted":
                accepted_n += 1
            elif ds == "expired":
                expired_n += 1
            elif ds == "cancelled":
                cancelled_n += 1
            elif ds == "pending":
                pending_n += 1

        meta_rows = [
            [Paragraph("Filter",     m_lbl), Paragraph(filter_label, m_val)],
            [Paragraph("Generated",  m_lbl), Paragraph(_fmt_pk(gen_dt), m_val)],
            [Paragraph("By",         m_lbl), Paragraph(generated_by, m_val)],
            [Paragraph("Total",      m_lbl), Paragraph(str(total), m_val)],
        ]
        meta_tbl = Table(meta_rows, colWidths=[CONTENT_W * 0.25, CONTENT_W * 0.75])
        meta_tbl.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (0, -1), C_LIGHT),
            ("FONTNAME",      (0, 0), (0, -1), "Helvetica-Bold"),
            ("FONTSIZE",      (0, 0), (-1, -1), 9.5),
            ("TOPPADDING",    (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LEFTPADDING",   (0, 0), (-1, -1), 8),
            ("GRID",          (0, 0), (-1, -1), 0.4, C_BORDER),
            ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ]))
        story.append(meta_tbl)
        story.append(Spacer(1, 0.5 * cm))

        story.append(Paragraph("Summary", ParagraphStyle(
            "inv_sh", fontName="Helvetica-Bold", fontSize=14,
            textColor=C_NAVY, leading=18, spaceBefore=6, spaceAfter=6,
        )))

        def _kpi_para(count, label, fg):
            num_style = ParagraphStyle(f"inv_kpi_{label}", fontName="Helvetica-Bold",
                                       fontSize=22, textColor=fg, leading=26, alignment=TA_CENTER)
            lbl_style = ParagraphStyle(f"inv_kpi_l_{label}", fontName="Helvetica",
                                       fontSize=8, textColor=fg, leading=11, alignment=TA_CENTER)
            return [Paragraph(str(count), num_style), Paragraph(label, lbl_style)]

        kpi_col_w = CONTENT_W / 5
        kpi_rows = [[
            _kpi_para(total,       "Total",     C_WHITE),
            _kpi_para(pending_n,   "Pending",   C_AMBER),
            _kpi_para(accepted_n,  "Accepted",  C_GREEN),
            _kpi_para(expired_n,   "Expired",   C_RED),
            _kpi_para(cancelled_n, "Cancelled", C_RED),
        ]]
        kpi_tbl = Table(kpi_rows, colWidths=[kpi_col_w] * 5)
        kpi_tbl.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (0, 0), C_NAVY),
            ("BACKGROUND",    (1, 0), (1, 0), C_AMBER_BG),
            ("BACKGROUND",    (2, 0), (2, 0), C_GREEN_BG),
            ("BACKGROUND",    (3, 0), (3, 0), C_RED_BG),
            ("BACKGROUND",    (4, 0), (4, 0), C_RED_BG),
            ("ALIGN",         (0, 0), (-1, -1), "CENTER"),
            ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING",    (0, 0), (-1, -1), 10),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
            ("GRID",          (0, 0), (-1, -1), 0.4, C_BORDER),
        ]))
        story.append(kpi_tbl)
        story.append(Spacer(1, 0.7 * cm))

        story.append(Paragraph("Invitation Listing", ParagraphStyle(
            "inv_listing_h", fontName="Helvetica-Bold", fontSize=14,
            textColor=C_NAVY, leading=18, spaceBefore=6, spaceAfter=6,
        )))
        story.append(HRFlowable(width=CONTENT_W, thickness=0.8, color=C_BLUE, spaceAfter=8))

        col_widths = [100, 120, 66, 70, 70, 70, 55]
        headers = [
            Paragraph("Project",     S["th"]),
            Paragraph("Invitee",     S["th"]),
            Paragraph("Role",        S["th"]),
            Paragraph("Sent By",     S["th"]),
            Paragraph("Sent At",     S["th"]),
            Paragraph("Expires At",  S["th"]),
            Paragraph("Status",      S["th"]),
        ]
        rows_data = [headers]
        extra_styles = []

        for i, inv in enumerate(invitations):
            ds = _derived_status(inv)
            fg = _STATUS_FG.get(ds, C_MUTED)
            bg = _STATUS_BG.get(ds, C_LIGHT)
            row_idx = i + 1

            st_style = ParagraphStyle(
                f"inv_st_{i}",
                fontName="Helvetica-Bold",
                fontSize=7.5,
                textColor=fg,
                leading=11,
                alignment=TA_CENTER,
                splitLongWords=0,
            )

            rows_data.append([
                Paragraph(str(_get(inv, "project_name") or "—"), S["td"]),
                Paragraph(str(_get(inv, "email") or "—"), S["td_sm"]),
                Paragraph(_role_label(_get(inv, "role")), S["td_sm"]),
                Paragraph(str(_get(inv, "invited_by_name") or "—"), S["td_sm"]),
                Paragraph(_fmt_date(_get(inv, "created_at")), S["td_sm"]),
                Paragraph(_fmt_date(_get(inv, "expires_at")), S["td_sm"]),
                Paragraph(_status_label(ds), st_style),
            ])
            extra_styles.append(("BACKGROUND", (6, row_idx), (6, row_idx), bg))

        inv_tbl = Table(rows_data, colWidths=col_widths, repeatRows=1)
        inv_tbl.setStyle(_tbl_style(extra_styles))
        story.append(inv_tbl)

        story.append(Spacer(1, 1 * cm))
        story.append(HRFlowable(width=CONTENT_W, thickness=0.5, color=C_BORDER, spaceAfter=6))
        story.append(Paragraph(
            f"This report was automatically generated by ConstructionSight AI "
            f"on {_fmt_pk(gen_dt, '%d %B %Y at %H:%M')}. "
            "Data reflects the current state of all invitations. "
            "CONFIDENTIAL — authorised personnel only.",
            S["closing"],
        ))

        doc.build(story)
        buf.seek(0)
        return buf.read()

    except ReportGenerationError:
        raise
    except Exception as exc:
        logger.error("Invitations PDF generation failed: %s", exc, exc_info=True)
        raise ReportGenerationError(f"Invitations PDF generation failed: {exc}") from exc
