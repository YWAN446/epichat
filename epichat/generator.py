from __future__ import annotations

from pathlib import Path

from jinja2 import Environment, FileSystemLoader, StrictUndefined

from .schema import SimParams

from .data_loaders.demographics import get_country_demographics

_TEMPLATES_DIR = Path(__file__).parent.parent / "templates"

##added
def resolve_demographics(params: SimParams) -> SimParams:
    """
    Auto-fill birth_rate and death_rate from World Bank / WHO / UN WPP
    if country is set and auto_demographics is True.
    User-supplied non-default values are never overwritten.
    """
    if not params.country or not params.auto_demographics:
        return params
    try:
        demo = get_country_demographics(params.country, params.demographics_year)
        if params.birth_rate == 20.0:
            params.birth_rate = demo['birth_rate']
        if params.death_rate == 10.0:
            params.death_rate = demo['death_rate']
        params.use_demographics    = True
        params.demographics_source = demo['source']
    except ValueError as e:
        print(f"  ⚠ Demographics lookup failed: {e} — using schema defaults")
    
    # Auto-set n_contacts from contact matrix if country is set
    if params.country and params.n_contacts == 4:
        try:
            from .data_loaders.contact_matrices import get_mean_contacts
            n = get_mean_contacts(params.country)
            if n is not None:
                params.n_contacts = int(round(n))
                print(f"  ✓ n_contacts set from contact matrix: {params.n_contacts}")
        except Exception:
            pass
    

    return params

    # Auto-load household data if network_type is household
    if params.network_type == 'household':
        try:
            from .data_loaders.households import get_starsim_household_pars
            country = params.household_data_country or params.country
            if country:
                hh = get_starsim_household_pars(country)
                print(f"  ✓ Household network: {country} "
                      f"mean_size={hh['mean_size']} [{hh['source']}]")
        except Exception as e:
            print(f"  ⚠ Household data failed: {e}")


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
        params = resolve_demographics(params)          # auto-fill country demographics
        template_name = self._select_template(params)
        template = self._env.get_template(template_name)
        context = params.to_template_dict()
        context["output_path"] = output_path.replace("\\", "/")
        return template.render(**context)



