from app.engine.types import StepResult


class Trace:
    """Collects one StepResult per pipeline step (spec §5.10)."""

    def __init__(self) -> None:
        self.steps: list[StepResult] = []

    def add(self, step: str, summary: dict, notes: list[str] | tuple[str, ...] = ()) -> None:
        self.steps.append(StepResult(step=step, summary=summary, notes=list(notes)))
