"""EpiChat package.

The orchestrator (EpiChat, EpiChatResult) is exported lazily so that leaf
modules such as epichat.generator and epichat.schema can be imported without
loading the Anthropic SDK, the data adapters, and the narrator.
"""
from __future__ import annotations

__all__ = ["EpiChat", "EpiChatResult"]


def __getattr__(name: str):
    if name in __all__:
        from . import epichat as _orchestrator
        return getattr(_orchestrator, name)
    raise AttributeError(f"module 'epichat' has no attribute '{name}'")
