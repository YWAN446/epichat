import urllib.error
from unittest.mock import patch

from epichat.adapters.un_wpp import UNWPPAdapter
from epichat.resolver import DataQuery

_LOCATIONS_CSV = """\
sep =|
id|name|iso3|iso2|longitude|latitude
840|United States of America|USA|US|-95.71|37.09
404|Kenya|KEN|KE|37.91|-0.02
356|India|IND|IN|78.96|20.59
"""

_DATA_CSV_BIRTH_DEATH = """\
sep =|
LocationId|Location|Iso3|Iso2|LocationTypeId|IndicatorId|Indicator|IndicatorDisplayName|SourceId|Source|Revision|VariantId|Variant|VariantShortName|VariantLabel|TimeId|TimeLabel|TimeMid|CategoryId|Category|EstimateTypeId|EstimateType|EstimateMethodId|EstimateMethod|SexId|Sex|AgeId|AgeLabel|AgeStart|AgeEnd|AgeMid|Value
840|United States of America|USA|US|4|55|Crude birth rate|Crude birth rate (births per 1,000 population)|27|World Population Prospects|0|4|Median|Median|Median|73|2022|2022.5|0|Not applicable|1|Model-based Estimates|2|Interpolation|3|Both sexes|188|Total|0|-1|0|10.981
840|United States of America|USA|US|4|55|Crude birth rate|Crude birth rate (births per 1,000 population)|27|World Population Prospects|0|4|Median|Median|Median|74|2023|2023.5|0|Not applicable|1|Model-based Estimates|2|Interpolation|3|Both sexes|188|Total|0|-1|0|10.648
840|United States of America|USA|US|4|59|Crude death rate|Crude death rate (deaths per 1,000 population)|27|World Population Prospects|0|4|Median|Median|Median|74|2023|2023.5|0|Not applicable|1|Model-based Estimates|2|Interpolation|3|Both sexes|188|Total|0|-1|0|8.663
"""

_DATA_CSV_AGE = """\
sep =|
LocationId|Location|Iso3|Iso2|LocationTypeId|IndicatorId|Indicator|IndicatorDisplayName|SourceId|Source|Revision|VariantId|Variant|VariantShortName|VariantLabel|TimeId|TimeLabel|TimeMid|CategoryId|Category|EstimateTypeId|EstimateType|EstimateMethodId|EstimateMethod|SexId|Sex|AgeId|AgeLabel|AgeStart|AgeEnd|AgeMid|Value
840|United States of America|USA|US|4|71|Percentage|Percentage of total population by broad age group|27|World Population Prospects|0|4|Median|Median|Median|74|2023|2023.5|0|Not applicable|1|Model-based Estimates|2|Interpolation|3|Both sexes|188|Total|0|-1|0|100
840|United States of America|USA|US|4|71|Percentage|Percentage of total population by broad age group|27|World Population Prospects|0|4|Median|Median|Median|74|2023|2023.5|0|Not applicable|1|Model-based Estimates|2|Interpolation|3|Both sexes|901|0-17|0|17|8.5|21.577
840|United States of America|USA|US|4|71|Percentage|Percentage of total population by broad age group|27|World Population Prospects|0|4|Median|Median|Median|74|2023|2023.5|0|Not applicable|1|Model-based Estimates|2|Interpolation|3|Both sexes|902|65+|65||82.5|17.432
"""

_DATA_CSV_POPULATION = """\
sep =|
LocationId|Location|Iso3|Iso2|LocationTypeId|IndicatorId|Indicator|IndicatorDisplayName|SourceId|Source|Revision|VariantId|Variant|VariantShortName|VariantLabel|TimeId|TimeLabel|TimeMid|CategoryId|Category|EstimateTypeId|EstimateType|EstimateMethodId|EstimateMethod|SexId|Sex|AgeId|AgeLabel|AgeStart|AgeEnd|AgeMid|Value
840|United States of America|USA|US|4|49|Total Population|Total Population, as of 1 July (thousands)|27|World Population Prospects|0|4|Median|Median|Median|73|2022|2022.5|0|Not applicable|1|Model-based Estimates|3|Original value|3|Both sexes|188|Total|0|-1|0|333287558
840|United States of America|USA|US|4|49|Total Population|Total Population, as of 1 July (thousands)|27|World Population Prospects|0|4|Median|Median|Median|74|2023|2023.5|0|Not applicable|1|Model-based Estimates|3|Original value|3|Both sexes|188|Total|0|-1|0|334914895
"""


def _make_adapter(locations_csv=_LOCATIONS_CSV):
    with patch("epichat.adapters.un_wpp._fetch_text", return_value=locations_csv):
        return UNWPPAdapter(api_key="test-token")


def test_location_lookup_by_iso3():
    adapter = _make_adapter()
    assert adapter.location_id("USA") == 840
    assert adapter.location_id("KEN") == 404


def test_location_lookup_by_iso2():
    adapter = _make_adapter()
    assert adapter.location_id("US") == 840
    assert adapter.location_id("KE") == 404


def test_location_lookup_by_name():
    adapter = _make_adapter()
    assert adapter.location_id("Kenya") == 404
    assert adapter.location_id("United States of America") == 840


def test_location_lookup_unknown_returns_none():
    adapter = _make_adapter()
    assert adapter.location_id("ZZZ") is None


def test_iso3_table_contains_all_entries():
    adapter = _make_adapter()
    table = adapter.iso3_table()
    assert table["USA"] == 840
    assert table["KEN"] == 404
    assert table["IND"] == 356


def _make_adapter_with_data(data_csv):
    """Adapter whose fetch() uses mock data CSV."""
    def _side_effect(url, api_key=None):
        if "locations" in url:
            return _LOCATIONS_CSV
        return data_csv
    with patch("epichat.adapters.un_wpp._fetch_text", side_effect=_side_effect):
        return UNWPPAdapter(api_key="test-token")


def test_fetch_birth_and_death_rate():
    adapter = _make_adapter_with_data(_DATA_CSV_BIRTH_DEATH)
    query = DataQuery(source="un_wpp", indicators=[55, 59], location_id=840, start_year=2020, end_year=2024)
    with patch("epichat.adapters.un_wpp._fetch_text", return_value=_DATA_CSV_BIRTH_DEATH):
        results = adapter.fetch(query)
    fields = {r.field: r for r in results}
    assert "birth_rate" in fields
    assert abs(fields["birth_rate"].value - 10.648) < 0.001
    assert "death_rate" in fields
    assert abs(fields["death_rate"].value - 8.663) < 0.001


def test_fetch_uses_most_recent_estimate_year():
    adapter = _make_adapter_with_data(_DATA_CSV_BIRTH_DEATH)
    query = DataQuery(source="un_wpp", indicators=[55], location_id=840, start_year=2020, end_year=2024)
    with patch("epichat.adapters.un_wpp._fetch_text", return_value=_DATA_CSV_BIRTH_DEATH):
        results = adapter.fetch(query)
    birth = next(r for r in results if r.field == "birth_rate")
    assert abs(birth.value - 10.648) < 0.001  # 2023 value, not 2022 (10.981)


def test_fetch_age_distribution():
    adapter = _make_adapter_with_data(_DATA_CSV_AGE)
    query = DataQuery(source="un_wpp", indicators=[71], location_id=840, start_year=2020, end_year=2024)
    with patch("epichat.adapters.un_wpp._fetch_text", return_value=_DATA_CSV_AGE):
        results = adapter.fetch(query)
    age = next(r for r in results if r.field == "age_distribution_pct")
    assert abs(age.value["0-17"] - 21.577) < 0.01
    assert abs(age.value["65+"] - 17.432) < 0.01
    assert abs(age.value["18-64"] - (100 - 21.577 - 17.432)) < 0.1


def test_fetch_citation_format():
    adapter = _make_adapter_with_data(_DATA_CSV_BIRTH_DEATH)
    query = DataQuery(source="un_wpp", indicators=[55], location_id=840, start_year=2020, end_year=2024)
    with patch("epichat.adapters.un_wpp._fetch_text", return_value=_DATA_CSV_BIRTH_DEATH):
        results = adapter.fetch(query)
    birth = next(r for r in results if r.field == "birth_rate")
    assert "UN WPP" in birth.citation
    assert "USA" in birth.citation
    assert "2023" in birth.citation


def test_fetch_returns_empty_on_http_error():
    adapter = _make_adapter_with_data(_DATA_CSV_BIRTH_DEATH)
    query = DataQuery(source="un_wpp", indicators=[55, 59], location_id=840, start_year=2020, end_year=2024)
    with patch("epichat.adapters.un_wpp._fetch_text", side_effect=urllib.error.URLError("connection refused")):
        results = adapter.fetch(query)
    assert results == []


def test_fetch_total_population():
    adapter = _make_adapter_with_data(_DATA_CSV_POPULATION)
    query = DataQuery(source="un_wpp", indicators=[49], location_id=840, start_year=2020, end_year=2024)
    with patch("epichat.adapters.un_wpp._fetch_text", return_value=_DATA_CSV_POPULATION):
        results = adapter.fetch(query)
    pop = next(r for r in results if r.field == "total_population")
    # 334914.895 thousands × 1000 = 334,914,895
    assert pop.value == 334914895
    assert isinstance(pop.value, int)
    assert "UN WPP" in pop.citation
    assert "USA" in pop.citation
    assert "2023" in pop.citation
