from __future__ import annotations

import logging
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, StrictUndefined

from .schema import SimParams

_TEMPLATES_DIR = Path(__file__).parent.parent / "templates"

logger = logging.getLogger(__name__)


def resolve_demographics(params: SimParams) -> SimParams:
    """Auto-fill birth_rate, death_rate, and n_contacts from country data
    (UN WPP CSV, WHO Mortality DB, World Bank Data360; empirical contact
    matrices) when params.country is set and auto_demographics is True.

    Values still at their schema defaults are treated as unset and filled;
    any other value is assumed user- or LLM-chosen and left alone. If
    n_contacts changes, beta is rescaled so the calibrated R0 is preserved.
    """
    if not params.country or not params.auto_demographics:
        return params

    defaults = {name: f.default for name, f in SimParams.model_fields.items()}

    try:
        from .data_loaders.demographics import get_country_demographics
        demo = get_country_demographics(params.country, params.demographics_year)
        if params.birth_rate == defaults["birth_rate"]:
            params.birth_rate = demo["birth_rate"]
        if params.death_rate == defaults["death_rate"]:
            params.death_rate = demo["death_rate"]
        params.use_demographics = True
        params.demographics_source = demo["source"]
    except ValueError as e:
        logger.warning("Demographics lookup failed for %s: %s — using schema defaults",
                       params.country, e)

    if params.n_contacts == defaults["n_contacts"]:
        try:
            from .data_loaders.contact_matrices import get_mean_contacts
            n = get_mean_contacts(params.country)
        except Exception:
            logger.debug("Contact matrix lookup failed for %s", params.country, exc_info=True)
            n = None
        if n is not None and int(round(n)) != params.n_contacts:
            r0_before = params.approx_r0()
            params.n_contacts = int(round(n))
            r0_after = params.approx_r0()
            if r0_after > 0:
                params.beta = round(params.beta * r0_before / r0_after, 6)
            logger.info("n_contacts set from contact matrix for %s: %d (beta rescaled)",
                        params.country, params.n_contacts)

    return params


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

    def generate(self, params: SimParams, output_path: str, pop_scale: float = 1.0) -> str:
        """Render the appropriate Jinja2 template and return executable Python code."""
        params = resolve_demographics(params)          # auto-fill country demographics
        template_name = self._select_template(params)
        template = self._env.get_template(template_name)
        context = params.to_template_dict()
        context["output_path"] = output_path.replace("\\", "/")
        context["pop_scale"] = pop_scale
        return template.render(**context)



