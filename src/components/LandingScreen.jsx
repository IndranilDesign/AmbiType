function LandingScreen({ onStartSession, isPreparing }) {
  return (
    <section className="screen-content landing-screen">
      <div className="landing-content-frame">
        <div className="landing-main">
          <img src="/icons/Visual.svg" alt="AmbiType" className="brand-orb" />

          <h1 className="primary-heading">A calm place to practice typing</h1>

          <p className="body-copy">
            AmbiType is a chill space to practice typing with an endless flow of text and
            optional ambient music designed to keep you focused and in the flow.
          </p>
        </div>

        <footer className="screen-footer landing-footer">
          <p className="music-start-hint">
            <img src="/icons/Music.svg" alt="" aria-hidden="true" />
            Ambient music can be turned on during your session
          </p>

          <button
            type="button"
            className="primary-cta"
            onClick={onStartSession}
            disabled={isPreparing}
            aria-busy={isPreparing}
          >
            <img src="/icons/Enter.svg" alt="" aria-hidden="true" className="cta-icon" />
            <span className="cta-label">{isPreparing ? 'Preparing...' : 'Start session'}</span>
          </button>
        </footer>
      </div>
    </section>
  );
}

export default LandingScreen;
