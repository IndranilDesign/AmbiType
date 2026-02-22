function LandingScreen({ onStartSession }) {
  return (
    <section className="screen-content landing-screen">
      <div className="landing-content-frame">
        <div className="landing-main">
          <img src="/icons/Visual.svg" alt="AmbiType" className="brand-orb" />

          <h1 className="primary-heading">A calm place to practice typing</h1>

          <p className="body-copy">
            Practice typing in a quiet, distraction-free space. The text continues endlessly,
            gentle music begins when you start typing, and you can move at your own pace.
          </p>
        </div>

        <footer className="screen-footer landing-footer">
          <p className="music-start-hint">
            <img src="/icons/Music.svg" alt="" aria-hidden="true" />
            Music will start when you start session
          </p>

          <button type="button" className="primary-cta" onClick={onStartSession}>
            <img src="/icons/Enter.svg" alt="" aria-hidden="true" className="cta-icon" />
            <span className="cta-label">Start session</span>
          </button>
        </footer>
      </div>
    </section>
  );
}

export default LandingScreen;
