"""All tunable defaults (spec §9). Values are modelling assumptions, not facts."""
import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.environ.get("ROBO_DB_PATH", BACKEND_DIR / "data" / "roboadvisor.db"))
ETFS_CSV = BACKEND_DIR / "data" / "etfs.csv"
STATIC_DIR = Path(os.environ.get("ROBO_STATIC_DIR", BACKEND_DIR.parent / "frontend" / "dist"))  # built frontend

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
# Fund size (Yahoo totalAssets, in EUR) below which the café menu leaves a fund out: small funds trade thinly and
# are more likely to close. Funds without a known size are kept. The classic pages do not apply it.
MIN_FUND_SIZE_EUR = 100_000_000
VAR_LEVELS = (0.95, 0.99)
WARM_MENU = os.environ.get("ROBO_WARM_MENU", "1") == "1"  # build the café menu at server start  # monthly Value at Risk levels reported with every recommendation

# Yardsticks shown next to every backtest (spec 2026-09-30 §2). By ISIN; converted to the base currency
# like any fund. Buy-and-hold of the single ETF, no costs; independent of the investor's filters.
REFERENCES = {
    "world": {"label": "World equities (MSCI World)", "isin": "IE00B4L5Y983"},
    "sp500": {"label": "S&P 500", "isin": "IE00B5BMR087"},
}

# Textbook portfolio (spec 2026-10-04): fixed building blocks per base currency, by ISIN. Every fund has its own
# prices in the base-currency listing for the whole window (checked 2026-10-04), so no proxy returns are used.
TEXTBOOK_FUNDS = {
    "EUR": {
        "risky": {
            "US equities": "IE00B52SFT06",  # iShares MSCI USA
            "European equities": "IE00B1YZSC51",  # iShares Core MSCI Europe
            "Emerging market equities": "IE00BKM4GZ66",  # iShares Core MSCI EM IMI
            "Government bonds": "LU0290355717",  # Xtrackers Eurozone Government Bond
            "Corporate bonds": "IE00B3F81R35",  # iShares Core Euro Corporate Bond
            "Gold": "IE00B579F325",  # Invesco Physical Gold
            "Real estate": "IE00B0M63284",  # iShares European Property Yield
        },
        "risk_free": "LU0290358497",  # Xtrackers EUR Overnight Rate Swap
    },
    "USD": {
        "risky": {
            "US equities": "US9229087690",  # Vanguard Total Stock Market (VTI)
            "Developed ex-US equities": "US9219438580",  # Vanguard FTSE Developed Markets (VEA)
            "Emerging market equities": "US9220428588",  # Vanguard FTSE Emerging Markets (VWO)
            "Government bonds": "US4642874402",  # iShares 7-10 Year Treasury (IEF)
            "Corporate bonds": "US4642872422",  # iShares Investment Grade Corporate (LQD)
            "Gold": "US78463V1070",  # SPDR Gold Shares (GLD)
            "Real estate": "US9229085538",  # Vanguard Real Estate (VNQ)
        },
        "risk_free": "US78468R6633",  # SPDR 1-3 Month T-Bill (BIL)
    },
}
TEXTBOOK_WINDOW_YEARS = 5
TEXTBOOK_PREMIUM = 0.05  # default market risk premium (course: 5-7% historical, 3-5% in practice)
TEXTBOOK_RISK_AVERSION = (10.0, 2.0)  # A at risk level 0 and at risk level 100 (this tool's assumption)
TEXTBOOK_FRONTIER_POINTS = 25
