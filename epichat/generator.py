from __future__ import annotations

from pathlib import Path

from jinja2 import Environment, FileSystemLoader, StrictUndefined

from .schema import SimParams

_TEMPLATES_DIR = Path(__file__).parent.parent / "templates"


class CodeGenerator:
    def __init__(self) -> None:
        self._env = Environment(
            loader=FileSystemLoader(str(_TEMPLATES_DIR)),
            undefined=StrictUndefined,
            autoescape=False,
        )

    def _select_template(self, params: SimParams) -> str:
        return {
            "seir":  "seir.py.j2",
            "sirs":  "sirs.py.j2",
            "seirs": "seirs.py.j2",
            "seiar": "seiar.py.j2",
            "sis":   "sis.py.j2",
        }.get(params.disease_type, "sir.py.j2")

    def generate(self, params: SimParams, output_path: str) -> str:
        """Render the appropriate Jinja2 template and return executable Python code."""
        template_name = self._select_template(params)
        template = self._env.get_template(template_name)
        context = params.to_template_dict()
        context["output_path"] = output_path.replace("\\", "/")
        return template.render(**context)
