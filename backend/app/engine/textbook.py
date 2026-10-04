"""Textbook portfolio (spec 2026-10-04): Markowitz and the CAPM as taught in the course, on a fixed fund set."""

from app.engine.types import DataSource, TextbookPortfolio


def textbook(
    base: str, risk_level: float, return_model: str, market_premium: float | None, data: DataSource
) -> TextbookPortfolio:
    raise NotImplementedError("textbook portfolio")
