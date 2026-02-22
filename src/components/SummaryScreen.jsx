import { useEffect, useRef, useState } from 'react';
import formatTime from '../lib/formatTime';
import StatCard from './StatCard';

function SummaryScreen({ summaryStats, onRestartSession }) {
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollIdleTimeoutRef = useRef(null);

  useEffect(
    () => () => {
      if (scrollIdleTimeoutRef.current) {
        window.clearTimeout(scrollIdleTimeoutRef.current);
      }
    },
    []
  );

  function handleSummaryScroll() {
    setIsScrolling(true);

    if (scrollIdleTimeoutRef.current) {
      window.clearTimeout(scrollIdleTimeoutRef.current);
    }

    scrollIdleTimeoutRef.current = window.setTimeout(() => {
      setIsScrolling(false);
    }, 700);
  }

  return (
    <section className="screen-content summary-screen">
      <div
        className={`summary-scroll-area${isScrolling ? ' scrolling' : ''}`}
        onScroll={handleSummaryScroll}
      >
        <div className="summary-main">
          <h2 className="primary-heading">Nice work!</h2>
          <p className="body-copy summary-subtext">You spent some time typing in a calm, focused space.</p>

          <div className="stats-grid">
            <StatCard value={summaryStats.averagePace} label="Average WPM" />
            <StatCard value={summaryStats.wordsTyped.toLocaleString()} label="Words typed" />
            <StatCard value={`${summaryStats.accuracy}%`} label="Accuracy" />
            <StatCard value={formatTime(summaryStats.timeTyped)} label="Time typed" />
          </div>
        </div>
      </div>

      <footer className="screen-footer summary-footer">
        <p className="music-start-hint">Start again whenever you&rsquo;re ready</p>

        <button type="button" className="primary-cta" onClick={onRestartSession}>
          <img src="/icons/Enter.svg" alt="" aria-hidden="true" className="cta-icon" />
          <span className="cta-label">Start another session</span>
        </button>
      </footer>
    </section>
  );
}

export default SummaryScreen;
