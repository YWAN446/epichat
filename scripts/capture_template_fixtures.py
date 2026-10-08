"""Capture plot-mode renders of every template as characterization fixtures.

Run this ONCE before changing the templates, and again only when a template
change is meant to become the new baseline for the CLI and the Streamlit app:

    py -3.10 scripts/capture_template_fixtures.py
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from epichat.generator import CodeGenerator  # noqa: E402
from template_cases import OUTPUT_PATH, cases  # noqa: E402

out_dir = ROOT / "tests" / "fixtures" / "templates_plot"
out_dir.mkdir(parents=True, exist_ok=True)
generator = CodeGenerator()
for name, params in cases().items():
    rendered = generator.generate(params, OUTPUT_PATH)
    (out_dir / f"{name}.py").write_text(rendered, encoding="utf-8", newline="\n")
    print(f"wrote {name}: {len(rendered.splitlines())} lines")
