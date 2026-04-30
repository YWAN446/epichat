import urllib.error
from unittest.mock import patch

from epichat.adapters.un_wpp import UNWPPAdapter

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
