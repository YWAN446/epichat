from dataclasses import dataclass
from epichat.resolver import DataQuery, ResolvedField, Resolver


@dataclass
class _EchoAdapter:
    source_name: str = "echo"

    def fetch(self, query: DataQuery) -> list[ResolvedField]:
        return [ResolvedField(field="birth_rate", value=20.0, citation="echo")]


def test_resolved_field_attributes():
    rf = ResolvedField(field="birth_rate", value=10.5, citation="UN WPP 2024, USA, 2023")
    assert rf.field == "birth_rate"
    assert rf.value == 10.5
    assert rf.citation == "UN WPP 2024, USA, 2023"


def test_data_query_attributes():
    dq = DataQuery(source="un_wpp", indicators=[55, 59], location_id=840, start_year=2020, end_year=2024)
    assert dq.source == "un_wpp"
    assert dq.indicators == [55, 59]
    assert dq.location_id == 840
    assert dq.start_year == 2020
    assert dq.end_year == 2024


def test_resolver_empty_queries_returns_empty():
    r = Resolver()
    assert r.resolve([]) == []


def test_resolver_routes_to_registered_adapter():
    r = Resolver()
    r.register(_EchoAdapter())
    results = r.resolve([DataQuery(source="echo", indicators=[], location_id=1, start_year=2023, end_year=2023)])
    assert len(results) == 1
    assert results[0].field == "birth_rate"
    assert results[0].citation == "echo"


def test_resolver_unknown_source_skips():
    r = Resolver()
    results = r.resolve([DataQuery(source="unknown", indicators=[], location_id=1, start_year=2023, end_year=2023)])
    assert results == []


def test_resolver_multiple_adapters():
    @dataclass
    class _OtherAdapter:
        source_name: str = "other"
        def fetch(self, query: DataQuery) -> list[ResolvedField]:
            return [ResolvedField(field="death_rate", value=8.0, citation="other")]

    r = Resolver()
    r.register(_EchoAdapter())
    r.register(_OtherAdapter())
    queries = [
        DataQuery(source="echo", indicators=[], location_id=1, start_year=2023, end_year=2023),
        DataQuery(source="other", indicators=[], location_id=1, start_year=2023, end_year=2023),
    ]
    results = r.resolve(queries)
    fields = {rf.field for rf in results}
    assert fields == {"birth_rate", "death_rate"}


def test_data_query_new_fields_default_empty():
    dq = DataQuery(source="who_gho", indicators=[], location_id=0, start_year=2020, end_year=2024)
    assert dq.indicator_codes == []
    assert dq.location_code == ""


def test_data_query_new_fields_explicit():
    dq = DataQuery(
        source="who_gho",
        indicator_codes=["WHS3_49", "WHS3_62"],
        location_code="KEN",
        start_year=2020,
        end_year=2024,
    )
    assert dq.indicator_codes == ["WHS3_49", "WHS3_62"]
    assert dq.location_code == "KEN"
    assert dq.location_id == 0   # default when omitted


def test_data_query_backward_compat_positional():
    """Existing positional construction still works after adding defaults."""
    dq = DataQuery("un_wpp", [55, 59], 840, 2020, 2024)
    assert dq.source == "un_wpp"
    assert dq.indicators == [55, 59]
    assert dq.location_id == 840
    assert dq.indicator_codes == []   # new fields not affected
    assert dq.location_code == ""


def test_resolved_field_description_defaults_to_empty():
    rf = ResolvedField(field="birth_rate", value=10.5, citation="x")
    assert rf.description == ""


def test_resolved_field_alternatives_defaults_to_empty_list():
    rf = ResolvedField(field="birth_rate", value=10.5, citation="x")
    assert rf.alternatives == []


def test_resolved_field_with_alternatives():
    alt = ResolvedField(field="treatment_capacity", value=0.2, citation="WB WDI, KEN, 2022",
                        description="physicians/1,000")
    primary = ResolvedField(field="treatment_capacity", value=2.3, citation="WB WDI, KEN, 2022",
                            description="hospital beds/1,000", alternatives=[alt])
    assert len(primary.alternatives) == 1
    assert primary.alternatives[0].value == 0.2
    assert primary.alternatives[0].description == "physicians/1,000"


def test_data_query_database_id_defaults_to_wdi():
    dq = DataQuery(source="wb_data360", indicator_codes=["WB_WDI_SH_TBS_INCD"], location_code="KEN")
    assert dq.database_id == "WB_WDI"


def test_data_query_database_id_explicit():
    dq = DataQuery(source="wb_data360", database_id="WB_HNP", indicator_codes=[], location_code="KEN")
    assert dq.database_id == "WB_HNP"


def test_resolved_field_backward_compat_no_description_or_alternatives():
    """Existing construction (field, value, citation only) must still work."""
    rf = ResolvedField(field="birth_rate", value=28.5, citation="UN WPP 2024, KEN, 2023")
    assert rf.description == ""
    assert rf.alternatives == []
