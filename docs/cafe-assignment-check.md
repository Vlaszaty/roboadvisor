# Café robo-advisor: check against the assignment

Checked on 2026-10-06 against `Roboadvisor.pdf` (UvA case study "Setting up a Roboadvisor", 2026), looking only at the café: `/cafe` (entrance), `/cafe/order` (the order) and `/cafe/menu` (the menu). Numbers come from the live menu data (Yahoo Finance prices up to 2026-10-06) on branch `cafe-menu-board`.

Legend: ✅ met · 🟡 partly met · ❌ not met · ➖ optional, not done

## Summary

Every requirement for the product, the portfolio method and the performance per risk level is met. The open items are the Amsterdam target-group research, deploying this version, and two small portfolio points (fund size and trading volume, regional spread).

## Deliverable 1: platform, questionnaire and allocation

| Requirement | Status | How the café covers it |
|---|---|---|
| Questionnaire that automatically places the client in an ETF portfolio | ✅ | Six questions lead to one of 14 fixed portfolios. |
| Platform describes the process | ✅ | The menu board shows each answer, what it means, the strength and which side (finances or comfort) sets it. The receipt has "How we made this recipe" in four plain steps. |
| Questions on finances, investment experience and risk tolerance | ✅ | Finances: time, money set aside, milk (room for losses). Experience: stamp card. Tolerance: sugar (acceptable loss in one year). |
| Own risk assessment method | ✅ | Capacity (time, set aside, milk) and tolerance (experience, sugar) are averaged separately; the lower one sets the strength. "Extra sweet" (no loss accepted) always gives the mildest recipe, with a warning. |
| 5 to 20 risk appetites | ✅ | 7 strengths, from Very mild (3% yearly swing) to Extra strong (14.5%). |
| 5 to 20 defined portfolios | ✅ | 14: 7 strengths times coffee or matcha. Everyone on the same item gets the same funds and weights. |
| Sustainable or impact option, still ETFs only | ✅ | Matcha uses ESG-labelled funds only. Seven ESG bond ETFs were added so careful matcha recipes are not 100% shares. |
| Portfolios of ETFs only | ✅ | The café excludes ETPs and ETCs, so no crypto or commodity notes. |
| At least two ETFs per portfolio | ✅ | 4 to 10 funds per portfolio, each between 3% and 40%. |
| American and/or European ETFs, daily data from Yahoo Finance | ✅ | European (UCITS) ETFs, Yahoo Finance data. |
| Consider Net Assets, Avg Volume and Expense Ratio | 🟡 | Expense ratio: used in the optimiser and shown per fund and in euros. Net assets: funds under €100 million are left out, but Yahoo has no size for about half the chosen funds (3 to 7 per portfolio) and those still pass. Average volume: shown, not used to select funds. |
| Mean-variance framework, historical returns as proxy | ✅ | Mean-variance with a volatility target per strength. Risk comes from the last 5 years of weekly prices. Expected returns come from CAPM rather than plain historical averages; the brief says "could", so this is allowed. |
| Platform language is free as long as the model works | 🟡 | Works locally (React and FastAPI) and all tests pass. The Azure site still runs the old four-step café because this branch is not deployed. |

## Deliverable 2: performance per risk level

| Requirement | Status | How the café covers it |
|---|---|---|
| Performance of the ETF portfolios at each risk level over at least 3 years | ✅ | `/cafe/menu` shows all 7 strengths for coffee and matcha: yearly return over 3 and 5 years, deepest fall, worst month, and a 5-year growth chart of €500. Results are walk-forward: weights are re-estimated every quarter with only the data known at that time, so there is no hindsight. |
| Value at Risk (support slide 6) | ✅ | Monthly VaR at 95% and 99%, by the historical and the variance-covariance (normal curve) method, on every receipt and in the menu table. |
| VaR by Monte Carlo simulation | ➖ | Monte Carlo is used for the future outcomes and the chance of a big fall, but not for VaR. The slide lists it as one possible method. |

## Target group: Amsterdam

| Recommendation | Status | Notes |
|---|---|---|
| Demographic analysis (age, income, employment) using the brief's link | ❌ | No data or sources in the app or repository. "Young professionals" is an assumption that research still has to support. |
| Financial behaviour (saving and investing habits, risk appetite) | ❌ | Not researched. |
| Cultural relevance (openness to digital financial tools) | 🟡 | Amsterdam café theme, Dutch and English, plain language for beginners. Not yet backed by research. |
| Local regulations (fintech rules, AFM, MiFID II, GDPR) | 🟡 | Clear "not personal investment advice" and "you can lose money" messages. No personal data is sent: only the recipe number and amounts. Past orders stay in the browser. Missing: a written check of the rules, and a note on Box 3 tax. |
| Engage local experts | ❌ | Nothing recorded. |
| Technology penetration (smartphone and internet use) | 🟡 | Works on phones (folding menu board, pinned buttons, no sideways scrolling), but not yet tied to usage data. |

## Notes for the presentation

- **Global spread (support slide 7).** Coffee Rich, Strong and Extra strong hold 56% to 67% in US-only funds, and matcha Extra strong 68%. The receipt points this out, but nothing limits it.
- **Proxy history.** Several ESG bond ETFs started in 2020 or 2021. Before that, their history comes from similar older funds, so the 5-year matcha results partly rest on proxy data.
- **Time to complete.** The brief mentions about 30 minutes for a typical robo-advisor. The café takes about 2 minutes, a deliberate choice for beginners.

## To close the gaps

1. **Amsterdam research.** Use the brief's demographic link, research saving and investing habits, AFM and MiFID II rules and smartphone use, and link each finding to a feature (for example the Dutch and English switch, the €500 default, small monthly amounts, mobile first). This is the biggest gap and needs the group's input.
2. **Deploy** branch `cafe-menu-board` to Azure so the live site shows this version.
3. **Optional portfolio improvements:** require a known fund size or a minimum trading volume, cap any one region at for example 50%, and add Monte Carlo VaR.
