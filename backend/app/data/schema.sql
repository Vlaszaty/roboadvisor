CREATE TABLE IF NOT EXISTS fund (
  isin TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  issuer TEXT,
  asset_class TEXT NOT NULL,   -- equity | bond | commodity | real_estate | cash | crypto
  sub_class TEXT,
  region TEXT,
  sector TEXT,
  esg INTEGER NOT NULL DEFAULT 0,
  ter REAL,
  domicile TEXT,
  ucits INTEGER NOT NULL DEFAULT 0,
  wrapper TEXT NOT NULL DEFAULT 'etf',  -- etf | etp | etc
  distribution TEXT,           -- acc | dist
  hedged_to TEXT,
  duration REAL,
  index_name TEXT,
  inception_date TEXT,
  proxy_ticker TEXT,
  proxy_currency TEXT
);
CREATE TABLE IF NOT EXISTS listing (
  ticker TEXT PRIMARY KEY,
  isin TEXT NOT NULL REFERENCES fund(isin),
  exchange TEXT,
  currency TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS price (
  ticker TEXT NOT NULL,
  date TEXT NOT NULL,
  adj_close REAL NOT NULL,
  PRIMARY KEY (ticker, date)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS fx (
  currency TEXT NOT NULL,
  date TEXT NOT NULL,
  usd_rate REAL NOT NULL,
  PRIMARY KEY (currency, date)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS rf_rate (
  currency TEXT NOT NULL,
  date TEXT NOT NULL,
  annual_rate REAL NOT NULL,
  PRIMARY KEY (currency, date)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS fund_stats (
  isin TEXT PRIMARY KEY,
  fund_size_eur REAL,          -- Yahoo totalAssets, converted to EUR at the latest fx rate; NULL if Yahoo has none
  daily_value_eur REAL,        -- sum over listings of averageVolume x price, in EUR; NULL if unknown
  as_of TEXT NOT NULL
);
