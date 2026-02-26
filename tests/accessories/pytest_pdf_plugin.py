"""
pytest_pdf_plugin.py — Enterprise PDF Test Report Generator

Hooks into pytest to produce one professional PDF per test suite after every run.
Each PDF contains:
  - Cover page  (project name, suite, date, pass/fail totals)
  - Summary table (one row per test, colour-coded)
  - Detailed table (9 columns: TC ID | Objective | Precondition | Steps |
                    Test Data | Expected Result | Post-condition | Actual Result | Pass/Fail)

Usage:
  - Decorate every test with @pytest.mark.testcase(...) — see fields below.
  - PDFs are written to tests/accessories/reports/pdf/<suite>_report_<YYYYMMDD_HHMMSS>.pdf
  - Suite is derived automatically from the test file path.
"""
from __future__ import annotations

import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

import pytest

# ---------------------------------------------------------------------------
# ReportLab imports (already in requirements.txt)
# ---------------------------------------------------------------------------
try:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.platypus import (
        SimpleDocTemplate, Table, TableStyle, Paragraph,
        Spacer, PageBreak, HRFlowable,
    )
    from reportlab.lib.enums import TA_CENTER, TA_LEFT
    REPORTLAB_AVAILABLE = True
except ImportError:
    REPORTLAB_AVAILABLE = False


# ---------------------------------------------------------------------------
# Colour palette
# ---------------------------------------------------------------------------
DARK_GREY   = colors.HexColor("#2C3E50")
MED_GREY    = colors.HexColor("#7F8C8D")
LIGHT_GREY  = colors.HexColor("#ECF0F1")
ALT_GREY    = colors.HexColor("#F8F9FA")
PASS_GREEN  = colors.HexColor("#D5F5E3")
FAIL_RED    = colors.HexColor("#FADBD8")
SKIP_YELLOW = colors.HexColor("#FEF9E7")
WHITE       = colors.white
ACCENT_BLUE = colors.HexColor("#2980B9")
BLACK       = colors.black

# ---------------------------------------------------------------------------
# Suite name mapping (derived from test file path)
# ---------------------------------------------------------------------------

def _suite_from_nodeid(nodeid: str) -> str:
    parts = nodeid.lower().replace("\\", "/")
    if "/unit/" in parts:
        return "Unit Tests"
    if "/integration/" in parts:
        return "Integration Tests"
    if "/security/" in parts:
        return "Security Tests"
    if "/smoke/" in parts:
        return "Smoke Tests"
    if "/contract/" in parts:
        return "Contract Tests"
    if "/load/" in parts:
        return "Load Tests"
    return "General Tests"


# ---------------------------------------------------------------------------
# Plugin state — collected at runtime
# ---------------------------------------------------------------------------

_results: list[dict[str, Any]] = []


def pytest_configure(config):
    """Register the custom 'testcase' marker so pytest doesn't warn about it."""
    config.addinivalue_line(
        "markers",
        "testcase(tc_id, objective, precondition, steps, test_data, "
        "expected_result, post_condition): Test case metadata for PDF report",
    )


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    """Capture result after the 'call' phase (the actual test execution)."""
    outcome = yield
    report = outcome.get_result()

    if report.when == "teardown":
        return
    if report.when == "setup" and not report.failed:
        return

    # Extract testcase marker metadata
    marker = item.get_closest_marker("testcase")
    if marker is None:
        return  # Only document tests that carry the marker

    tc_id         = marker.kwargs.get("tc_id", item.name)
    objective     = marker.kwargs.get("objective", "—")
    precondition  = marker.kwargs.get("precondition", "—")
    steps         = marker.kwargs.get("steps", [])
    test_data     = marker.kwargs.get("test_data", "—")
    expected      = marker.kwargs.get("expected_result", "—")
    post_cond     = marker.kwargs.get("post_condition", "—")

    # Format steps
    if isinstance(steps, (list, tuple)):
        steps_text = "\n".join(f"{i+1}. {s}" for i, s in enumerate(steps))
    else:
        steps_text = str(steps)

    # Format test data
    if isinstance(test_data, dict):
        td_text = "\n".join(f"{k}: {v}" for k, v in test_data.items())
    else:
        td_text = str(test_data)

    # Actual result
    if report.passed:
        outcome_str = "PASS"
        actual = "Test passed — all assertions satisfied"
    elif report.failed:
        outcome_str = "FAIL"
        longrepr = str(report.longrepr) if report.longrepr else "Assertion failed"
        # Trim to keep PDF manageable
        actual = longrepr[:300] + ("..." if len(longrepr) > 300 else "")
    else:
        outcome_str = "SKIP"
        actual = str(report.wasxfail) if hasattr(report, "wasxfail") else "Skipped"

    _results.append({
        "suite":        _suite_from_nodeid(item.nodeid),
        "nodeid":       item.nodeid,
        "tc_id":        tc_id,
        "objective":    objective,
        "precondition": precondition,
        "steps":        steps_text,
        "test_data":    td_text,
        "expected":     expected,
        "post_cond":    post_cond,
        "actual":       actual,
        "outcome":      outcome_str,
    })


def pytest_sessionfinish(session, exitstatus):
    """After the full run, generate one PDF + TXT per suite and a master consolidated pair."""
    if not _results:
        print("\n[PDF Plugin] No @pytest.mark.testcase tests found — no reports generated.")
        return

    # Group by suite
    suites: dict[str, list[dict]] = {}
    for r in _results:
        suites.setdefault(r["suite"], []).append(r)

    out_dir = Path(__file__).resolve().parent / "reports" / "pdf"
    out_dir.mkdir(parents=True, exist_ok=True)

    for suite_name, rows in suites.items():
        slug = suite_name.lower().replace(" ", "_")
        # Delete any previous reports for this suite
        for old in out_dir.glob(f"{slug}_report_*.pdf"):
            old.unlink()
        for old in out_dir.glob(f"{slug}_report_*.txt"):
            old.unlink()

        txt_path = out_dir / f"{slug}_report.txt"
        _generate_txt(suite_name, rows, str(txt_path))
        print(f"\n[PDF Plugin] TXT generated: {txt_path}")

        if REPORTLAB_AVAILABLE:
            out_path = out_dir / f"{slug}_report.pdf"
            _generate_pdf(suite_name, rows, str(out_path))
            print(f"\n[PDF Plugin] PDF generated: {out_path}")

    # Master consolidated reports across all suites
    if len(suites) > 1:
        for old in out_dir.glob("MASTER_report*.pdf"):
            old.unlink()
        for old in out_dir.glob("MASTER_report*.txt"):
            old.unlink()

        master_txt = out_dir / "MASTER_report.txt"
        _generate_txt("All Suites — Master Report", _results, str(master_txt))
        print(f"\n[PDF Plugin] TXT master: {master_txt}")

        if REPORTLAB_AVAILABLE:
            master_pdf = out_dir / "MASTER_report.pdf"
            _generate_pdf("All Suites — Master Report", _results, str(master_pdf))
            print(f"\n[PDF Plugin] PDF master: {master_pdf}")

    if not REPORTLAB_AVAILABLE:
        print("\n[PDF Plugin] ReportLab not installed — PDF skipped, TXT only.")


# ---------------------------------------------------------------------------
# TXT generation
# ---------------------------------------------------------------------------

def _generate_txt(suite_name: str, rows: list[dict], out_path: str) -> None:
    run_dt = datetime.now().strftime("%Y-%m-%d  %H:%M:%S")
    passed  = sum(1 for r in rows if r["outcome"] == "PASS")
    failed  = sum(1 for r in rows if r["outcome"] == "FAIL")
    skipped = sum(1 for r in rows if r["outcome"] == "SKIP")
    total   = len(rows)
    pass_rate = f"{int(passed / total * 100)}%" if total else "N/A"

    W = 100  # line width

    lines: list[str] = []

    def hr(char="="):
        lines.append(char * W)

    def heading(text: str):
        hr()
        lines.append(f"  {text}")
        hr()

    heading("ConstructionSight-AI — Test Case Report")
    lines.append(f"  Suite     : {suite_name}")
    lines.append(f"  Generated : {run_dt}")
    lines.append(f"  Total: {total}   Pass: {passed}   Fail: {failed}   Skip: {skipped}   Pass Rate: {pass_rate}")
    hr()
    lines.append("")

    # Suite summary
    lines.append("SUITE SUMMARY")
    hr("-")
    suite_groups: dict[str, list[dict]] = {}
    for r in rows:
        suite_groups.setdefault(r["suite"], []).append(r)
    lines.append(f"  {'Suite':<35} {'Total':>6} {'Pass':>6} {'Fail':>6} {'Skip':>6} {'Rate':>7}")
    hr("-")
    for sn, sr in suite_groups.items():
        p = sum(1 for r in sr if r["outcome"] == "PASS")
        f = sum(1 for r in sr if r["outcome"] == "FAIL")
        s = sum(1 for r in sr if r["outcome"] == "SKIP")
        t = len(sr)
        rate = f"{int(p / t * 100)}%" if t else "N/A"
        lines.append(f"  {sn:<35} {t:>6} {p:>6} {f:>6} {s:>6} {rate:>7}")
    hr("-")
    lines.append(f"  {'TOTAL':<35} {total:>6} {passed:>6} {failed:>6} {skipped:>6} {pass_rate:>7}")
    lines.append("")

    # Detailed test cases
    lines.append("DETAILED TEST CASES")
    hr("=")

    for i, r in enumerate(rows, start=1):
        outcome_icon = "[ PASS ]" if r["outcome"] == "PASS" else (
            "[ FAIL ]" if r["outcome"] == "FAIL" else "[ SKIP ]"
        )
        lines.append(f"  {i:>3}. {r['tc_id']:<20}  {outcome_icon}  {r['objective']}")
        hr("-")
        lines.append(f"  Precondition   : {r['precondition']}")
        lines.append(f"  Steps          :")
        for step_line in r["steps"].splitlines():
            lines.append(f"                     {step_line}")
        lines.append(f"  Test Data      :")
        for td_line in r["test_data"].splitlines():
            lines.append(f"                     {td_line}")
        lines.append(f"  Expected Result: {r['expected']}")
        lines.append(f"  Post-condition : {r['post_cond']}")
        lines.append(f"  Actual Result  :")
        for actual_line in r["actual"].splitlines():
            lines.append(f"                     {actual_line}")
        lines.append(f"  Node ID        : {r['nodeid']}")
        hr("-")
        lines.append("")

    lines.append(f"  ConstructionSight-AI · {suite_name} · Auto-generated by pytest_pdf_plugin · {run_dt}")
    hr()

    Path(out_path).write_text("\n".join(lines), encoding="utf-8")


# ---------------------------------------------------------------------------
# PDF generation
# ---------------------------------------------------------------------------

def _generate_pdf(suite_name: str, rows: list[dict], out_path: str) -> None:
    styles = getSampleStyleSheet()

    # Custom paragraph styles
    title_style = ParagraphStyle(
        "Title", parent=styles["Title"],
        fontSize=22, textColor=WHITE, alignment=TA_CENTER,
        spaceAfter=6,
    )
    subtitle_style = ParagraphStyle(
        "Subtitle", parent=styles["Normal"],
        fontSize=11, textColor=LIGHT_GREY, alignment=TA_CENTER,
        spaceAfter=4,
    )
    cell_style = ParagraphStyle(
        "Cell", parent=styles["Normal"],
        fontSize=7, leading=9, wordWrap="CJK",
    )
    header_cell_style = ParagraphStyle(
        "HeaderCell", parent=styles["Normal"],
        fontSize=8, leading=10, textColor=WHITE, fontName="Helvetica-Bold",
    )

    doc = SimpleDocTemplate(
        out_path,
        pagesize=landscape(A4),
        rightMargin=1.2 * cm,
        leftMargin=1.2 * cm,
        topMargin=1.5 * cm,
        bottomMargin=1.5 * cm,
    )

    story = []

    # -----------------------------------------------------------------------
    # Cover / header block
    # -----------------------------------------------------------------------
    passed = sum(1 for r in rows if r["outcome"] == "PASS")
    failed = sum(1 for r in rows if r["outcome"] == "FAIL")
    skipped = sum(1 for r in rows if r["outcome"] == "SKIP")
    total = len(rows)
    run_dt = datetime.now().strftime("%Y-%m-%d  %H:%M:%S")
    pass_rate = f"{int(passed / total * 100)}%" if total else "N/A"

    cover_data = [[
        Paragraph("ConstructionSight-AI", title_style),
        Paragraph(f"{suite_name} — Test Report", subtitle_style),
        Paragraph(
            f"Generated: {run_dt}    |    "
            f"Total: {total}    Pass: {passed}    Fail: {failed}    Skip: {skipped}    "
            f"Pass Rate: {pass_rate}",
            subtitle_style,
        ),
    ]]
    cover_table = Table([[p] for p in [
        Paragraph("ConstructionSight-AI", title_style),
        Paragraph(f"{suite_name} — Test Report", subtitle_style),
        Paragraph(
            f"Generated: {run_dt}    |    Total: {total}   "
            f"Pass: {passed}   Fail: {failed}   Skip: {skipped}   Pass Rate: {pass_rate}",
            subtitle_style,
        ),
    ]], colWidths=[doc.width])
    cover_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), DARK_GREY),
        ("TOPPADDING",    (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("LEFTPADDING",   (0, 0), (-1, -1), 15),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 15),
        ("ROUNDEDCORNERS", [4]),
    ]))
    story.append(cover_table)
    story.append(Spacer(1, 0.6 * cm))
    story.append(HRFlowable(width="100%", thickness=1, color=ACCENT_BLUE))
    story.append(Spacer(1, 0.4 * cm))

    # -----------------------------------------------------------------------
    # Suite summary statistics table
    # -----------------------------------------------------------------------
    heading_style = ParagraphStyle(
        "SectionHeading", parent=styles["Heading2"],
        fontSize=12, textColor=DARK_GREY, spaceAfter=6,
    )
    summary_heading_style = ParagraphStyle(
        "SummaryHeading", parent=styles["Heading3"],
        fontSize=10, textColor=DARK_GREY, spaceAfter=4,
    )
    summary_cell_style = ParagraphStyle(
        "SummaryCell", parent=styles["Normal"],
        fontSize=8, leading=10,
    )
    summary_header_style = ParagraphStyle(
        "SummaryHeaderCell", parent=styles["Normal"],
        fontSize=8, leading=10, textColor=WHITE, fontName="Helvetica-Bold",
    )

    # Group rows by suite for the summary
    suite_groups: dict[str, list[dict]] = {}
    for r in rows:
        suite_groups.setdefault(r["suite"], []).append(r)

    summary_data = [[
        Paragraph(h, summary_header_style)
        for h in ["Suite", "Total", "Pass", "Fail", "Skip", "Pass Rate"]
    ]]
    for suite_nm, suite_rows in suite_groups.items():
        p = sum(1 for r in suite_rows if r["outcome"] == "PASS")
        f = sum(1 for r in suite_rows if r["outcome"] == "FAIL")
        s = sum(1 for r in suite_rows if r["outcome"] == "SKIP")
        t = len(suite_rows)
        rate = f"{int(p / t * 100)}%" if t else "N/A"
        summary_data.append([
            Paragraph(suite_nm, summary_cell_style),
            Paragraph(str(t), summary_cell_style),
            Paragraph(str(p), summary_cell_style),
            Paragraph(str(f), summary_cell_style),
            Paragraph(str(s), summary_cell_style),
            Paragraph(rate, summary_cell_style),
        ])

    # Totals row
    tp = sum(1 for r in rows if r["outcome"] == "PASS")
    tf = sum(1 for r in rows if r["outcome"] == "FAIL")
    ts = sum(1 for r in rows if r["outcome"] == "SKIP")
    tt = len(rows)
    total_rate = f"{int(tp / tt * 100)}%" if tt else "N/A"
    summary_data.append([
        Paragraph("TOTAL", summary_header_style),
        Paragraph(str(tt), summary_header_style),
        Paragraph(str(tp), summary_header_style),
        Paragraph(str(tf), summary_header_style),
        Paragraph(str(ts), summary_header_style),
        Paragraph(total_rate, summary_header_style),
    ])

    sum_col_widths = [8.0 * cm, 2.5 * cm, 2.5 * cm, 2.5 * cm, 2.5 * cm, 3.0 * cm]
    summary_table = Table(summary_data, colWidths=sum_col_widths, repeatRows=1)
    sum_cmds = [
        ("BACKGROUND",    (0, 0), (-1, 0), ACCENT_BLUE),
        ("TEXTCOLOR",     (0, 0), (-1, 0), WHITE),
        ("FONTNAME",      (0, 0), (-1, 0), "Helvetica-Bold"),
        ("BACKGROUND",    (0, -1), (-1, -1), DARK_GREY),
        ("TEXTCOLOR",     (0, -1), (-1, -1), WHITE),
        ("FONTNAME",      (0, -1), (-1, -1), "Helvetica-Bold"),
        ("GRID",          (0, 0), (-1, -1), 0.4, MED_GREY),
        ("BOX",           (0, 0), (-1, -1), 1,   DARK_GREY),
        ("TOPPADDING",    (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING",   (0, 0), (-1, -1), 6),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 6),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN",         (1, 0), (-1, -1), "CENTER"),
    ]
    # Alternate row colours
    for i in range(1, len(summary_data) - 1):
        bg = ALT_GREY if i % 2 == 0 else WHITE
        sum_cmds.append(("BACKGROUND", (0, i), (-1, i), bg))
    summary_table.setStyle(TableStyle(sum_cmds))

    story.append(Paragraph("Suite Summary", summary_heading_style))
    story.append(summary_table)
    story.append(Spacer(1, 0.5 * cm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=MED_GREY))
    story.append(Spacer(1, 0.3 * cm))

    # -----------------------------------------------------------------------
    # Section heading
    # -----------------------------------------------------------------------
    story.append(Paragraph("Detailed Test Case Report", heading_style))

    # -----------------------------------------------------------------------
    # Main table
    # -----------------------------------------------------------------------
    col_headers = [
        "TC ID", "Test Objective", "Precondition",
        "Steps", "Test Data", "Expected Result",
        "Post-condition", "Actual Result", "Pass/Fail",
    ]
    # Column widths (landscape A4 usable ≈ 25.7 cm)
    col_widths = [2.0, 3.5, 3.0, 4.0, 3.0, 3.5, 3.0, 3.5, 1.7]
    col_widths = [w * cm for w in col_widths]

    table_data = [[Paragraph(h, header_cell_style) for h in col_headers]]

    for r in rows:
        pf_colour = PASS_GREEN if r["outcome"] == "PASS" else (
            FAIL_RED if r["outcome"] == "FAIL" else SKIP_YELLOW
        )
        pf_text = f"✅ PASS" if r["outcome"] == "PASS" else (
            f"❌ FAIL" if r["outcome"] == "FAIL" else "⏭ SKIP"
        )
        def safe(text):
            """Escape raw text for ReportLab XML parser, then restore <br/> newlines."""
            import html as _html
            return _html.escape(str(text or "")).replace("\n", "<br/>")

        row_cells = [
            Paragraph(safe(r["tc_id"]),        cell_style),
            Paragraph(safe(r["objective"]),    cell_style),
            Paragraph(safe(r["precondition"]), cell_style),
            Paragraph(safe(r["steps"]),        cell_style),
            Paragraph(safe(r["test_data"]),    cell_style),
            Paragraph(safe(r["expected"]),     cell_style),
            Paragraph(safe(r["post_cond"]),    cell_style),
            Paragraph(safe(r["actual"]),       cell_style),
            Paragraph(pf_text,                 cell_style),
        ]
        table_data.append(row_cells)

    main_table = Table(table_data, colWidths=col_widths, repeatRows=1)

    style_cmds = [
        # Header row
        ("BACKGROUND",    (0, 0), (-1, 0), DARK_GREY),
        ("TEXTCOLOR",     (0, 0), (-1, 0), WHITE),
        ("FONTNAME",      (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",      (0, 0), (-1, 0), 8),
        ("TOPPADDING",    (0, 0), (-1, 0), 7),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 7),
        ("ALIGN",         (0, 0), (-1, 0), "CENTER"),
        # Data rows
        ("FONTNAME",      (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE",      (0, 1), (-1, -1), 7),
        ("TOPPADDING",    (0, 1), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 5),
        ("LEFTPADDING",   (0, 0), (-1, -1), 5),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 5),
        ("VALIGN",        (0, 0), (-1, -1), "TOP"),
        # Grid
        ("GRID",          (0, 0), (-1, -1), 0.4, MED_GREY),
        ("BOX",           (0, 0), (-1, -1), 1,   DARK_GREY),
        # Last column (Pass/Fail) centred
        ("ALIGN",         (-1, 1), (-1, -1), "CENTER"),
    ]

    # Row-level background colouring (alternating + outcome)
    for i, r in enumerate(rows, start=1):
        if r["outcome"] == "PASS":
            style_cmds.append(("BACKGROUND", (0, i), (-1, i), PASS_GREEN))
        elif r["outcome"] == "FAIL":
            style_cmds.append(("BACKGROUND", (0, i), (-1, i), FAIL_RED))
        elif r["outcome"] == "SKIP":
            style_cmds.append(("BACKGROUND", (0, i), (-1, i), SKIP_YELLOW))
        else:
            bg = ALT_GREY if i % 2 == 0 else WHITE
            style_cmds.append(("BACKGROUND", (0, i), (-1, i), bg))

    main_table.setStyle(TableStyle(style_cmds))
    story.append(main_table)

    # -----------------------------------------------------------------------
    # Footer note
    # -----------------------------------------------------------------------
    story.append(Spacer(1, 0.5 * cm))
    footer_style = ParagraphStyle(
        "Footer", parent=styles["Normal"],
        fontSize=8, textColor=MED_GREY, alignment=TA_CENTER,
    )
    story.append(Paragraph(
        f"ConstructionSight-AI · {suite_name} · Auto-generated by pytest_pdf_plugin · {run_dt}",
        footer_style,
    ))

    # -----------------------------------------------------------------------
    # Page number callback
    # -----------------------------------------------------------------------
    def _add_page_number(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(MED_GREY)
        page_num = f"Page {canvas.getPageNumber()}"
        canvas.drawRightString(doc.pagesize[0] - 1.2 * cm, 0.8 * cm, page_num)
        canvas.restoreState()

    doc.build(story, onFirstPage=_add_page_number, onLaterPages=_add_page_number)
