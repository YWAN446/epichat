import pytest
from pathlib import Path
from epichat.exporter import to_pdf, to_docx


_MESSAGES = [
    {"role": "assistant", "content": "What would you like to simulate today?", "plot_path": None},
    {"role": "user", "content": "HIV in Kenya", "plot_path": None},
    {"role": "assistant", "content": "Got it. Here's what I've put together:\n\n  Disease  HIV/AIDS...", "plot_path": None},
    {"role": "user", "content": "run it", "plot_path": None},
    {"role": "assistant", "content": "Simulation complete!\n\nPeak infections: 61,122", "plot_path": None},
]


def test_to_pdf_returns_bytes():
    result = to_pdf(_MESSAGES)
    assert isinstance(result, bytes)
    assert len(result) > 0


def test_to_pdf_starts_with_pdf_header():
    result = to_pdf(_MESSAGES)
    assert result[:4] == b"%PDF"


def test_to_docx_returns_bytes():
    result = to_docx(_MESSAGES)
    assert isinstance(result, bytes)
    assert len(result) > 0


def test_to_docx_starts_with_zip_header():
    # .docx files are ZIP archives
    result = to_docx(_MESSAGES)
    assert result[:2] == b"PK"


def test_to_pdf_with_no_messages():
    result = to_pdf([])
    assert isinstance(result, bytes)
    assert len(result) > 0


def test_to_docx_with_no_messages():
    result = to_docx([])
    assert isinstance(result, bytes)
    assert len(result) > 0
