import type { StepCopy } from '../components/textbook/copy';
import type { CafeLanguage } from './language';

export type MethodStepCopy = Record<1 | 2 | 3 | 4 | 5 | 6 | 7, StepCopy>;

/** Labels of the Step card on the method page. */
export const stepLabels = (language: CafeLanguage) => language === 'en'
  ? { example: 'With your recipe', notice: 'What to notice', formula: 'Show the formula' }
  : { example: 'Met jouw recept', notice: 'Let op', formula: 'Laat de formule zien' };

/** The seven steps of the method behind a café recipe, in Dutch or English. */
export function methodSteps(language: CafeLanguage): MethodStepCopy {
  const t = (nl: string, en: string) => (language === 'en' ? en : nl);
  return {
    1: {
      title: t('Welke fondsen mogen meedoen', 'Which funds may join'),
      technicalTitle: t('Universum en filters', 'Universe and filters'),
      plain: t(
        'We beginnen met alle fondsen in onze database en schrappen wat niet past: wat je in Europa niet mag kopen, geen ETF is, dubbel is of te kort bestaat. Wat overblijft zijn de kandidaten.',
        'We start with all funds in our database and drop what does not fit: what you cannot buy in Europe, what is not an ETF, doubles, or has not existed long enough. What is left are the candidates.',
      ),
      what: t(
        'De filters werken in een vaste volgorde. Alleen filters die iets schrapten staan in de tabel. Daarna vallen fondsen af met te weinig geschiedenis, ook als we een invaller-index gebruiken voor de jaren dat het fonds er nog niet was. Bij matcha blijven alleen fondsen met een ESG-label over, plus het geldmarktfonds.',
        'The filters work in a fixed order. Only filters that removed something are in the table. After that, funds with too little history drop out, even when a stand-in index covers the years before the fund existed. For matcha only ESG-labelled funds remain, plus the cash fund.',
      ),
      formula: <div>{t('kandidaten', 'candidates')} = {t('alle fondsen', 'all funds')} − Σ {t('per filter geschrapt', 'removed per filter')} − {t('te korte geschiedenis', 'too little history')}</div>,
      source: t('Motor: fondsfilters, daarna controle op geschiedenis', 'Engine: fund filters, then history check'),
      notice: t(
        'Het grootste deel van de database valt meestal af op regels, niet op prestaties. Bij matcha haalt het ESG-label de meeste fondsen weg; het geldmarktfonds blijft altijd mogelijk, ook zonder label.',
        'Most of the database usually drops out on rules, not on performance. For matcha the ESG label removes most funds; the cash fund always stays possible, label or not.',
      ),
    },
    2: {
      title: t('Hoe ze bewogen', 'How they moved'),
      technicalTitle: t('Weekrendementen', 'Weekly returns'),
      plain: t(
        'Van elk fonds kijken we naar de koers van elke vrijdag. De verandering van week tot week is het weekrendement. We meten over de laatste vijf jaar.',
        'For each fund we look at the price every Friday. The change from week to week is the weekly return. We measure over the last five years.',
      ),
      what: t(
        'Het weekrendement is de koers van deze week gedeeld door die van vorige week, min 1. Schommeling, correlaties en beta meten we altijd uit deze historie: vijf jaar wekelijkse rendementen. Bestond een fonds korter, dan leent de reeks de koersen van de index die het fonds volgt (de invaller).',
        'The weekly return is this week’s price divided by last week’s, minus 1. Volatility, correlations and beta are always measured from this history: five years of weekly returns. If a fund is younger, its series borrows the prices of the index it follows (the stand-in).',
      ),
      formula: <div>r<sub>t</sub> = P<sub>t</sub> / P<sub>t−1</sub> − 1</div>,
      source: t('Motor: weekrendementen, laatste vijf jaar', 'Engine: weekly returns, last five years'),
      notice: t(
        'Vijf jaar is kort: wat we meten zegt meer over het recente verleden dan over de toekomst. Een invaller is de index, niet het fonds zelf.',
        'Five years is short: what we measure says more about the recent past than about the future. A stand-in is the index, not the fund itself.',
      ),
    },
    3: {
      title: t('Hoe riskant, en hoe ze samen bewegen', 'How risky, and how they move together'),
      technicalTitle: t('Volatiliteit en correlatie (Ledoit-Wolf)', 'Volatility and correlation (Ledoit-Wolf)'),
      plain: t(
        'Schommeling is hoeveel een fonds op en neer gaat, per jaar. Correlatie zegt hoe gelijk twee fondsen bewegen: 1 is precies gelijk, 0 los van elkaar, onder 0 tegengesteld. Bewegen fondsen verschillend, dan dempt mixen het schommelen.',
        'Swing is how much a fund goes up and down in a year. Correlation says how alike two funds move: 1 is exactly alike, 0 unrelated, below 0 opposite. When funds move differently, mixing them dampens the swing.',
      ),
      what: t(
        'Beide meten we uit de weekrendementen en rekenen we om naar een jaar (× √52). Met veel fondsen en maar 260 weken zit er ruis in wat je meet. Daarom gebruiken we Ledoit-Wolf-shrinkage: de gemeten cijfers worden een stukje naar een eenvoudig gemiddeld patroon getrokken. De getallen hieronder zijn na die stap, zoals de motor ze gebruikt.',
        'We measure both from the weekly returns and scale them to a year (× √52). With many funds and only 260 weeks, some of what you measure is noise. So we use Ledoit-Wolf shrinkage: the measured numbers are pulled part of the way towards a simple average structure. The numbers below are after that step, as the engine uses them.',
      ),
      formula: (
        <>
          <div>σ<sub>P</sub><sup>2</sup> = x<sub>1</sub><sup>2</sup>σ<sub>1</sub><sup>2</sup> + x<sub>2</sub><sup>2</sup>σ<sub>2</sub><sup>2</sup> + 2x<sub>1</sub>x<sub>2</sub>ρ<sub>12</sub>σ<sub>1</sub>σ<sub>2</sub></div>
          <div>Σ<sub>shrunk</sub> = δ·F + (1 − δ)·S</div>
        </>
      ),
      source: t('Motor: covariantie, Ledoit-Wolf-shrinkage', 'Engine: covariance, Ledoit-Wolf shrinkage'),
      notice: t(
        'Zolang een correlatie onder 1 ligt, schommelt een mix minder dan het gemiddelde van de fondsen. De laagste getallen in de tabel zijn waar mixen het meest helpt.',
        'As long as a correlation is below 1, a mix swings less than the average of its funds. The lowest numbers in the table are where mixing helps most.',
      ),
    },
    4: {
      title: t('Wat elk fonds kan opleveren', 'What each fund may earn'),
      technicalTitle: t('Verwacht rendement (CAPM)', 'Expected returns (CAPM)'),
      plain: t(
        'We kijken niet naar wat een fonds vorig jaar deed. We gebruiken een regel: hoe meer een fonds met de markt meebeweegt, hoe meer extra groei het mag opleveren boven de spaarrente. Dat is een schatting, geen belofte.',
        'We do not look at what a fund did last year. We use a rule: the more a fund moves with the market, the more extra growth it may earn on top of the savings rate. That is an estimate, not a promise.',
      ),
      what: t(
        'Verwacht rendement = rente zonder risico + beta × marktpremie. De markt is een vaste mix van wereldwijde aandelen en obligaties; de premie is het extra rendement dat we voor die markt aannemen (een aanname, niet gemeten). Beta meten we uit dezelfde weekrendementen: 1 betekent net zo veel meebewegen als de markt, 0 niet meebewegen.',
        'Expected return = risk-free rate + beta × market premium. The market is a fixed mix of global equities and bonds; the premium is the extra return we assume for that market (an assumption, not measured). We measure beta from the same weekly returns: 1 means moving as much as the market, 0 means not moving with it.',
      ),
      formula: (
        <>
          <div>E[R<sub>i</sub>] = r<sub>f</sub> + β<sub>i</sub> × {t('premie', 'premium')}</div>
          <div>β<sub>i</sub> = Cov(R<sub>i</sub>, R<sub>M</sub>) / Var(R<sub>M</sub>)</div>
        </>
      ),
      source: t('Motor: verwacht rendement, CAPM met een marktmix', 'Engine: expected returns, CAPM with a market mix'),
      notice: t(
        'Het geldmarktfonds heeft een beta rond 0 en krijgt dus ongeveer de rente zonder risico. Fondsen met een beta boven 1 mogen meer dan de markt opleveren, en schommelen ook meer.',
        'The cash fund has a beta around 0, so it gets about the risk-free rate. Funds with a beta above 1 may earn more than the market, and swing more too.',
      ),
    },
    5: {
      title: t('De huisregels', 'The house rules'),
      technicalTitle: t('Volatiliteitsdoel en randvoorwaarden', 'Volatility target and constraints'),
      plain: t(
        'Elke sterkte heeft een grens voor het schommelen per jaar. Daarnaast zijn er regels die een mix gezond houden: niet te veel fondsen, niet te klein en niet te groot per fonds. Alleen het geldmarktfonds, het veilige deel, mag meer.',
        'Each strength has a limit on the yearly swing. There are also rules to keep a mix sound: not too many funds, none too small and none too big. Only the cash fund, the safe part, may be larger.',
      ),
      what: t(
        'De sterkte is een doel voor de schommeling (volatiliteit): de mix mag er niet boven uitkomen. De motor kiest hooguit een vast aantal fondsen, elk met een deel tussen een minimum en een maximum. Het geldmarktfonds valt buiten dat maximum.',
        'The strength is a target for the swing (volatility): the mix may not exceed it. The engine picks at most a fixed number of funds, each with a share between a minimum and a maximum. The cash fund is exempt from that maximum.',
      ),
      formula: (
        <>
          <div>σ(x) ≤ σ<sub>{t('doel', 'target')}</sub>, Σx<sub>i</sub> = 1</div>
          <div>x<sub>i</sub> = 0 {t('of', 'or')} min ≤ x<sub>i</sub> ≤ max; {t('hooguit', 'at most')} N {t('fondsen', 'funds')}</div>
        </>
      ),
      source: t('Motor: randvoorwaarden voor de optimalisatie', 'Engine: constraints for the optimisation'),
      notice: t(
        'Het doel is een bovengrens op de gemeten cijfers, geen garantie. In de toekomst kan de mix meer of minder schommelen.',
        'The target is an upper limit on the measured numbers, not a guarantee. In the future the mix may swing more or less.',
      ),
    },
    6: {
      title: t('De mix kiezen', 'Picking the mix'),
      technicalTitle: t('Optimalisatie bij een volatiliteitsdoel', 'Optimisation at a volatility target'),
      plain: t(
        'Van alle mixen die binnen de huisregels vallen, kiezen we die met het hoogste verwachte rendement na fondskosten, waarvan het schommelen niet boven het doel uitkomt.',
        'Of all mixes that fit the house rules, we pick the one with the highest expected return after fund costs whose swing does not go above the target.',
      ),
      what: t(
        'De optimaliser maximaliseert verwacht rendement min fondskosten (TER), onder de huisregels. In de grafiek is de lijn de beste mix per niveau van schommeling, gemaakt met dezelfde regels. Het recept ligt daar op of vlak onder, bij het doel.',
        'The optimiser maximises expected return minus fund costs (TER), under the house rules. In the chart, the line is the best mix at each level of swing, made with the same rules. The recipe sits on or just under it, at the target.',
      ),
      formula: <div>max Σ x<sub>i</sub> (μ<sub>i</sub> − TER<sub>i</sub>) {t('onder', 'subject to')} σ(x) ≤ σ<sub>{t('doel', 'target')}</sub></div>,
      source: t('Motor: optimalisatie, hoogste rendement bij volatiliteitsdoel', 'Engine: optimisation, highest return at a volatility target'),
      notice: t(
        'Een fonds met een hoger verwacht rendement hoeft niet in de mix te zitten: het moet ook passen bij de rest, en binnen het schommeldoel blijven. Voor de lijn en de stippen is het rendement vóór fondskosten.',
        'A fund with a higher expected return need not be in the mix: it also has to fit with the others and stay within the swing target. For the line and the dots, the return is before fund costs.',
      ),
    },
    7: {
      title: t('Wat je krijgt', 'What you get'),
      technicalTitle: t('Het resultaat en de risicobijdrage', 'The result and risk contribution'),
      plain: t(
        'Zo ziet het recept eruit: wat het naar verwachting oplevert, hoeveel het schommelt, wat het kost, en per fonds hoeveel van het geld en hoeveel van het risico.',
        'This is what the recipe looks like: what it is expected to earn, how much it swings, what it costs, and per fund how much of the money and how much of the risk.',
      ),
      what: t(
        'Verwacht rendement is het gewogen gemiddelde van de verwachte rendementen van de fondsen. De fondskosten (TER) gaan daar nog vanaf. De risicobijdrage van een fonds is zijn aandeel in de schommeling van de hele mix, rekening houdend met hoe het met de rest meebeweegt.',
        'Expected return is the weighted average of the funds’ expected returns. The fund costs (TER) come off that. A fund’s risk contribution is its share of the swing of the whole mix, taking into account how it moves with the rest.',
      ),
      formula: (
        <>
          <div>E[R<sub>P</sub>] = Σ x<sub>i</sub> E[R<sub>i</sub>]</div>
          <div>{t('na kosten', 'after costs')} = E[R<sub>P</sub>] − Σ x<sub>i</sub> TER<sub>i</sub></div>
        </>
      ),
      source: t('Motor: resultaat en risicobijdrage', 'Engine: result and risk contribution'),
      notice: t(
        'Geld en risico zijn niet hetzelfde: een fonds dat sterk schommelt telt veel zwaarder in het risico dan in het geld. Verwacht is een schatting; het verleden is geen belofte.',
        'Money and risk are not the same: a fund that swings a lot weighs far more in the risk than in the money. Expected is an estimate; the past is no promise.',
      ),
    },
  };
}
