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
        if params.has_vaccine_intervention():
            return "sir_vaccine.py.j2"
        if params.disease_type == "seir":
            return "seir.py.j2"
        return "sir.py.j2"

    def generate(self, params: SimParams, output_path: str) -> str:
        """Render the appropriate Jinja2 template and return the Python code string."""
        template_name = self._select_template(params)
        template = self._env.get_template(template_name)
        context = params.to_template_dict()
        context["output_path"] = output_path.replace("\\", "/")
        return template.render(**context)


# Extend SimParams with a helper method used above
def _has_vaccine_intervention(self: SimParams) -> bool:
    return any(i.type == "vaccine" for i in self.interventions)


SimParams.has_vaccine_intervention = _has_vaccine_intervention  # type: ignore[attr-defined]
