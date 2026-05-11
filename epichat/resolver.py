from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable


@dataclass
class DataQuery:
    source: str
    indicators: list[int] = field(default_factory=list)
    location_id: int = 0
    start_year: int = 2020
    end_year: int = 2025
    indicator_codes: list[str] = field(default_factory=list)
    location_code: str = ""
    database_id: str = "WB_WDI"


@dataclass
class ResolvedField:
    field: str
    value: Any
    citation: str
    description: str = ""
    alternatives: list["ResolvedField"] = field(default_factory=list)


@runtime_checkable
class SourceAdapter(Protocol):
    source_name: str

    def fetch(self, query: DataQuery) -> list[ResolvedField]: ...


class Resolver:
    def __init__(self) -> None:
        self._adapters: dict[str, SourceAdapter] = {}

    def register(self, adapter: SourceAdapter) -> None:
        self._adapters[adapter.source_name] = adapter

    def resolve(self, queries: list[DataQuery]) -> list[ResolvedField]:
        results: list[ResolvedField] = []
        for query in queries:
            adapter = self._adapters.get(query.source)
            if adapter is None:
                continue
            results.extend(adapter.fetch(query))
        return results
