import { Link } from 'react-router-dom';
import { LinkButton } from '../components/ui';
import { ExamplePreview } from '../intake/ExamplePreview';
import './Landing.css';

export default function Landing() {
  return (
    <div className="landing">
      <section className="hero" aria-labelledby="hero-h">
        <p className="hero-kicker">For people starting to invest</p>
        <h1 id="hero-h">Put your money to work, without the jargon.</h1>
        <p className="hero-pitch">
          Answer ten short questions. Get a simple mix of low-cost funds that matches how much risk you are comfortable with.
          See the good case, the bad case and the fees before you start.
        </p>
        <div className="hero-actions">
          <LinkButton to="/start" variant="primary">
            Build my plan
          </LinkButton>
          <span className="muted">About three minutes. No account, nothing stored on our servers.</span>
        </div>
        <ul className="hero-facts" aria-label="At a glance">
          <li>Shares, bonds, gold and more</li>
          <li>Sustainable option</li>
          <li>Replayed over up to 15 years</li>
        </ul>
      </section>

      <section aria-labelledby="how-h">
        <div className="section-head">
          <h2 id="how-h">How it works</h2>
          <p>Three steps. You stay in charge of the one decision that matters.</p>
        </div>
        <ol className="steps">
          <li>
            <h3>Tell us about your situation</h3>
            <p>How long you can invest, how steady your income is, and how you would feel if your money dropped 20%. Plain questions, no jargon.</p>
          </li>
          <li>
            <h3>Pick your level</h3>
            <p>We suggest one of five keys, from Safe Start to Bold Mover. Slide it calmer or bolder and watch your plan change.</p>
          </li>
          <li>
            <h3>See your plan in plain words</h3>
            <p>A short list of funds, what they cost, what could go wrong and how it did in the past. Open any detail to go deeper.</p>
          </li>
        </ol>
      </section>

      <section aria-labelledby="why-h">
        <div className="section-head">
          <h2 id="why-h">Built so you can check it</h2>
        </div>
        <div className="points">
          <article className="point">
            <h3>No black box</h3>
            <p>Every step is listed, from which funds were allowed to how much of each one you hold.</p>
          </article>
          <article className="point">
            <h3>The bad news first</h3>
            <p>We show the chance of a big fall before we talk about growth. If you could not live with it, you will know now, not in a crash.</p>
          </article>
          <article className="point">
            <h3>Fees on the table</h3>
            <p>Every fund&apos;s yearly fee is visible, with the total cost for every 10,000 you invest.</p>
          </article>
          <article className="point">
            <h3>Words explained</h3>
            <p>
              Any technical word links to a plain-English explanation. See all of them in{' '}
              <Link to="/glossary">Words explained</Link>.
            </p>
          </article>
        </div>
      </section>

      <section aria-labelledby="example-h">
        <div className="section-head">
          <h2 id="example-h">See a real example</h2>
          <p>This plan is built live for a Smart Builder (key 3) with a ten-year horizon. Yours will differ with your answers.</p>
        </div>
        <div className="preview-card">
          <header>
            <p>
              <strong>Key 3 · Smart Builder, 10 years, EUR</strong>
            </p>
          </header>
          <ExamplePreview />
        </div>
      </section>

      <section className="cta-band" aria-labelledby="cta-h">
        <h2 id="cta-h">Ready to see yours?</h2>
        <p>Ten questions, one slider, and a plan you can take apart.</p>
        <LinkButton to="/start" variant="primary">
          Build my plan
        </LinkButton>
      </section>
    </div>
  );
}
