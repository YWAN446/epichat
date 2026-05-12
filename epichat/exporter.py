"""Export chat conversation to PDF or Word (.docx) in-memory."""
from __future__ import annotations

import io
import re
from pathlib import Path

from docx import Document
from docx.shared import Inches, Pt, RGBColor
from fpdf import FPDF


def _sanitize(text: str) -> str:
    """Replace non-Latin-1 characters with ASCII equivalents for fpdf core fonts."""
    replacements = {
        "★": "*",    # ★
        "↳": "->",   # ↳
        "·": "-",    # ·
        "—": "-",    # —
        "–": "-",    # –
        "✓": "OK",   # ✓
        "‘": "'",    # '
        "’": "'",    # '
        "“": '"',    # "
        "”": '"',    # "
        "R₀": "R0",  # R₀
        "₂": "2",    # ₂
    }
    for char, repl in replacements.items():
        text = text.replace(char, repl)
    return text.encode("latin-1", errors="replace").decode("latin-1")


def to_pdf(
    messages: list[dict],
    plot_path: str | None = None,
) -> bytes:
    """Render the conversation as a PDF and return its bytes."""
    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()

    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 10, "EpiChat Conversation", new_x="LMARGIN", new_y="NEXT", align="C")
    pdf.ln(4)

    for msg in messages:
        role = msg.get("role", "")
        content = _sanitize(msg.get("content", ""))
        msg_plot = msg.get("plot_path")

        pdf.set_font("Helvetica", "B", 9)
        label = "You" if role == "user" else "EpiChat"
        pdf.set_text_color(80, 80, 80)
        pdf.cell(0, 5, label, new_x="LMARGIN", new_y="NEXT")
        pdf.set_text_color(0, 0, 0)

        if role == "user":
            pdf.set_fill_color(255, 255, 255)
        else:
            pdf.set_fill_color(245, 245, 245)
        pdf.set_font("Helvetica", "", 9)
        pdf.multi_cell(0, 5, content, fill=(role == "assistant"))

        if msg_plot and Path(msg_plot).exists():
            pdf.image(msg_plot, x=pdf.l_margin, w=pdf.epw)
        elif (
            plot_path
            and Path(plot_path).exists()
            and role == "assistant"
            and "complete" in content.lower()
        ):
            pdf.image(plot_path, x=pdf.l_margin, w=pdf.epw)

        pdf.ln(3)

    return bytes(pdf.output())


def to_docx(
    messages: list[dict],
    plot_path: str | None = None,
) -> bytes:
    """Render the conversation as a .docx file and return its bytes."""
    doc = Document()

    title = doc.add_heading("EpiChat Conversation", level=1)
    title.alignment = 1  # center

    for msg in messages:
        role = msg.get("role", "")
        content = msg.get("content", "")
        msg_plot = msg.get("plot_path")

        label_para = doc.add_paragraph()
        label_run = label_para.add_run("You" if role == "user" else "EpiChat")
        label_run.bold = True
        label_run.font.size = Pt(9)
        label_run.font.color.rgb = RGBColor(80, 80, 80)

        body_para = doc.add_paragraph(content)
        body_para.style.font.size = Pt(9)

        target_plot = msg_plot or (
            plot_path
            if role == "assistant" and "complete" in content.lower()
            else None
        )
        if target_plot and Path(target_plot).exists():
            doc.add_picture(target_plot, width=Inches(6))

        doc.add_paragraph()

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()
