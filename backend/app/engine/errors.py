class DomainError(Exception):
    """An error the API turns into a readable response instead of a 500."""

    status_code = 422


class NoEligibleFunds(DomainError):
    pass


class InfeasibleConstraints(DomainError):
    pass


class InvalidSettings(DomainError):
    pass


class InsufficientHistory(DomainError):
    """Not enough overlapping weekly history for the requested calculation (422)."""


class NoData(DomainError):
    """No database loaded (503). Only for a missing/empty DB, never for thin history."""

    status_code = 503
