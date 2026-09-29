import { LinkButton } from '../components/ui';
import { ExamplePreview } from '../intake/ExamplePreview';
import './Landing.css';

export default function Landing() {
  return (
    <div className="landing">
      <section className="hero" aria-labelledby="hero-h">
        <p className="hero-kicker">Rules-based ETF portfolios, explained</p>
        <h1 id="hero-h">Know what you own, and what it could cost you.</h1>
        <p className="hero-pitch">
          Answer about ten questions and get a globally diversified ETF portfolio matched to the risk you can actually carry. Every step is
          explained, the bad years are shown up front, and the fees are on the table.
        </p>
        <div className="hero-actions">
          <LinkButton to="/start" variant="primary">
            Build my portfolio
          </LinkButton>
          <span className="muted">About three minutes. No account, nothing stored on our servers.</span>
        </div>
        <ul className="hero-facts" aria-label="At a glance">
          <li>Global equities, bonds, gold and more</li>
          <li>ESG option</li>
          <li>Backtested over up to 15 years</li>
        </ul>
      </section>

      <section aria-labelledby="how-h">
        <div className="section-head">
          <h2 id="how-h">How it works</h2>
          <p>Three steps, and you stay in charge of the one decision that matters.</p>
        </div>
        <ol className="steps">
          <li>
            <h3>Tell us about your situation</h3>
            <p>Your horizon, income, savings, and how you would react if your portfolio fell 20% in a month. Plain questions, no jargon.</p>
          </li>
          <li>
            <h3>Choose your risk level</h3>
            <p>
              We suggest a number from 0 to 100, based on the lower of what you can afford to lose and what you can stomach. Then you move the
              slider and see what it means in ups and downs.
            </p>
          </li>
          <li>
            <h3>Get a portfolio you can inspect</h3>
            <p>A short list of real ETFs with weights, costs, the chance of deep losses, and a backtest. Open any step to see why it came out this way.</p>
          </li>
        </ol>
      </section>

      <section aria-labelledby="why-h">
        <div className="section-head">
          <h2 id="why-h">Built to be checked, not trusted blindly</h2>
        </div>
        <div className="points">
          <article className="point">
            <p className="quote">Explainable, not a black box.</p>
            <p>From which funds were eligible to how the weights were chosen, each step is listed with the numbers that drove it.</p>
          </article>
          <article className="point">
            <p className="quote">Honest about the downside.</p>
            <p>We show you the chance that your portfolio falls 40% below its peak at some point, before we talk about returns. If you cannot live with it, you will know now, not in a crash.</p>
          </article>
          <article className="point">
            <p className="quote">Low cost, shown upfront.</p>
            <p>Every fund's yearly fee (TER) is visible, with the total cost per 10,000 invested. Fees count against a fund in the selection, not just in the footnotes.</p>
          </article>
          <article className="point">
            <p className="quote">Global, with bonds and ESG.</p>
            <p>Regional and global equity, government and corporate bonds, gold and property, with sustainable funds and a currency choice of EUR or USD.</p>
          </article>
        </div>
      </section>

      <section aria-labelledby="example-h">
        <div className="section-head">
          <h2 id="example-h">See a real example</h2>
          <p>This portfolio is built live for a balanced investor with a ten-year horizon. Yours will differ with your answers.</p>
        </div>
        <div className="preview-card">
          <header>
            <p>
              <strong>Balanced, 10 years, EUR</strong>
            </p>
          </header>
          <ExamplePreview />
        </div>
      </section>

      <section className="cta-band" aria-labelledby="cta-h">
        <h2 id="cta-h">Ready to see your own?</h2>
        <p>Ten questions, one slider, and a portfolio you can take apart.</p>
        <LinkButton to="/start" variant="primary">
          Build my portfolio
        </LinkButton>
      </section>
    </div>
  );
}
