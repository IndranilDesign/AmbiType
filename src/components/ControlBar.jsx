import formatTime from '../lib/formatTime';
import ShortcutPill from './ShortcutPill';

function ControlBar({ elapsedSeconds, liveWpm, isMuted, onToggleMute, onFinishSession }) {
  return (
    <section className="control-bar" aria-label="Session controls">
      <p className="control-time">{formatTime(elapsedSeconds)}</p>

      <div className="wpm-pill" aria-hidden="true">
        <span className="wpm-icon-wrap">
          <img src="/icons/WPM.svg" alt="" className="wpm-icon" />
        </span>
        <span className="wpm-value">{liveWpm ?? '—'}</span>
        <span className="wpm-label">WPM</span>
      </div>

      <button
        type="button"
        className={`control-action music-toggle${isMuted ? ' muted' : ''}`}
        onClick={onToggleMute}
        aria-label={isMuted ? 'Unmute music' : 'Mute music'}
      >
        <span className="music-icon-circle" aria-hidden="true">
          <img src={isMuted ? '/icons/Muted.svg' : '/icons/Sound_on.svg'} alt="" />
        </span>
        <ShortcutPill keys={['Ctrl', 'M']} />
        <span>Music</span>
      </button>

      <button type="button" className="control-action" onClick={onFinishSession}>
        <ShortcutPill keys={['Ctrl', { icon: '/icons/Enter.svg', label: 'Enter' }]} />
        <span>Finish session</span>
      </button>
    </section>
  );
}

export default ControlBar;
