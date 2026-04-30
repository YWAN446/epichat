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


def test_resolver_empty_queries_returns_empty():
    r = Resolver()
    assert r.resolve([]) == []


def test_resolver_routes_to_registered_adapter():
    r = Resolver()
    r.register(_EchoAdapter())
    results = r.resolve([DataQuery(source="echo", indicators=[], location_id=1, start_year=2023, end_year=2023)])
    assert len(results) == 1
    assert results[0].field == "birth_rate"


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
