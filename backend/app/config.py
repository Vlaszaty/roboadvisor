"""All tunable defaults (spec §9). Values are modelling assumptions, not facts."""
import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.environ.get("ROBO_DB_PATH", BACKEND_DIR / "data" / "roboadvisor.db"))
ETFS_CSV = BACKEND_DIR / "data" / "etfs.csv"

API_PORT = 8740
FRONTEND_ORIGINS = ["http://localhost:5740", "http://127.0.0.1:5740"]

BASE_CURRENCIES = ("EUR", "USD")
PERIODS_PER_YEAR = 52  # the engine works on weekly returns

VOL_RANGE = (0.02, 0.20)
ESTIMATION_WINDOW_YEARS = 5
MIN_COVERAGE = 0.8  # share of non-NaN weeks a fund needs inside the estimation window

# Market anchors per base currency, by ISIN. Lane A verifies these ISINs against real data
# and may correct the values; the keys ("global_equity", "global_bonds") are fixed.
ANCHORS = {
    "EUR": {"global_equity": "IE00B6R52259", "global_bonds": "IE00BDBRDM35"},
    "USD": {"global_equity": "US4642882579", "global_bonds": "US92206C5655"},
}
MARKETS = {
    "capm_equity": {"weights": {"global_equity": 1.0}, "premium": 0.050},
    "capm_multi_asset": {"weights": {"global_equity": 0.6, "global_bonds": 0.4}, "premium": 0.035},
}

CRYPTO_MIN_RISK_LEVEL = 40
CRYPTO_DEFAULT_CAP = 0.05  # UI default for crypto_max when the user opts in
CRYPTO_HARD_CAP = 0.10  # crypto_max above this is rejected (422)
TER_PENALTY = 1.0  # multiplier on TER in the optimizer objective
MAX_CARDINALITY_ROUNDS = 3

DRAWDOWN_THRESHOLDS = (0.3, 0.4, 0.5)
MC_PATHS = 10_000
MC_SEED = 42
BLOCK_WEEKS = (4, 13)
FAN_PERCENTILES = (5, 25, 50, 75, 95)
STRESS_EVENTS = [
    ("GFC 2008", "2007-10-09", "2009-03-09"),
    ("COVID 2020", "2020-02-19", "2020-03-23"),
    ("Rate shock 2022", "2022-01-03", "2022-10-14"),
]

BACKTEST_YEARS = 15
# optimisation candidates (except crypto) need own+proxy weekly history covering the default backtest window,
# so held funds never truncate the downside history or show missing weeks inside a backtest
MIN_HISTORY_YEARS = BACKTEST_YEARS
TRANSACTION_COST_BPS = 10.0
ROLLING_WINDOW_WEEKS = 156

MISMATCH_GAP = 20
UCITS_DEFAULT = {"EUR": True, "USD": False}
