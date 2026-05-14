"""Export chat conversation to PDF or Word (.docx) in-memory."""
from __future__ import annotations

import io
from pathlib import Path

from docx import Document
from docx.shared import Inches, Pt, RGBColor
from fpdf import FPDF


# Special characters to normalise before writing to PDF/DOCX.
# Keys use \u escapes to avoid any encoding ambiguity in source files.
_SPECIAL_CHARS: dict[str, str] = {
    "★": "*",    # ★
    "↳": "->",   # ↳
    "·": "-",    # ·
    "—": "-",    # —
    "–": "-",    # –
    "✓": "OK",   # ✓
    "‘": "'",    # ‘ left single quotation mark
    "’": "'",    # ’ right single quotation mark
    "“": '"',    # “ left double quotation mark
    "”": '"',    # ” right double quotation mark
    "R₀": "R0",  # R₀
    "₂": "2",    # ₂
}

# System CJK font candidates searched in order; first existing file wins.
# TTF preferred over TTC as fpdf2 handles single-font TTFs most reliably.
_CJK_FONT_CANDIDATES = [
    # Windows
    r"C:\Windows\Fonts\simhei.ttf",
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\simsun.ttc",
    # macOS
    "/Library/Fonts/Arial Unicode.ttf",
    "/System/Library/Fonts/PingFang.ttc",
    # Linux
    "/usr/share/fonts/truetype/wqy/wqy-microhei.ttf",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
]


def _replace_special(text: str) -> str:
    for char, repl in _SPECIAL_CHARS.items():
        text = text.replace(char, repl)
    return text


def _sanitize_latin(text: str) -> str:
    """Replace special chars then encode to latin-1 (Helvetica fallback)."""
    text = _replace_special(text)
    return text.encode("latin-1", errors="replace").decode("latin-1")


def _has_cjk(text: str) -> bool:
    return any(
        0x2E80 <= ord(c) <= 0x9FFF or 0xAC00 <= ord(c) <= 0xD7AF
        for c in text
    )


def _find_cjk_font() -> str | None:
    for path in _CJK_FONT_CANDIDATES:
        if Path(path).exists():
            return path
    return None


def to_pdf(
    messages: list[dict],
    plot_path: str | None = None,
) -> bytes:
    """Render the conversation as a PDF and return its bytes."""
    all_text = " ".join(m.get("content", "") for m in messages)
    cjk_font_path = _find_cjk_font() if _has_cjk(all_text) else None

    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()

    if cjk_font_path:
        pdf.add_font("Unicode", fname=cjk_font_path)
        font = "Unicode"
    else:
        font = "Helvetica"

    pdf.set_font(font, size=16)
    pdf.cell(0, 10, "EpiChat Conversation", new_x="LMARGIN", new_y="NEXT", align="C")
    pdf.ln(4)

    for msg in messages:
        role = msg.get("role", "")
        raw = msg.get("content", "")
        content = _replace_special(raw) if cjk_font_path else _sanitize_latin(raw)
        msg_plot = msg.get("plot_path")

        pdf.set_font(font, size=9)
        label = "You" if role == "user" else "EpiChat"
        pdf.set_text_color(80, 80, 80)
        pdf.cell(0, 5, label, new_x="LMARGIN", new_y="NEXT")
        pdf.set_text_color(0, 0, 0)

        pdf.set_fill_color(245, 245, 245) if role == "assistant" else pdf.set_fill_color(255, 255, 255)
        pdf.set_font(font, size=9)
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
