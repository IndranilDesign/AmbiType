import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ControlBar from './ControlBar';

function TypingScreen({
  targetText,
  cursorIndex,
  typedResults,
  elapsedSeconds,
  liveWpm,
  isMuted,
  onToggleMute,
  onFinishSession,
  onTypeCharacter,
  onStepBack,
  onTypingInteraction
}) {
  const CARET_ANCHOR_RATIO = 0.33;
  const RENDER_BEFORE_CHARS = 1400;
  const RENDER_AFTER_CHARS = 2600;
  const [scrollOffset, setScrollOffset] = useState(0);
  const typingViewportRef = useRef(null);
  const typingTargetRef = useRef(null);
  const currentCharacterRef = useRef(null);
  const caretRef = useRef(null);

  const { visibleText, windowStart } = useMemo(() => {
    if (!targetText) {
      return { visibleText: '', windowStart: 0 };
    }

    const safeCursor = Math.max(0, Math.min(cursorIndex, targetText.length));
    const start = Math.max(0, safeCursor - RENDER_BEFORE_CHARS);
    const end = Math.min(targetText.length, safeCursor + RENDER_AFTER_CHARS);

    return {
      visibleText: targetText.slice(start, end),
      windowStart: start
    };
  }, [cursorIndex, targetText]);

  const visibleCharacters = useMemo(() => visibleText.split(''), [visibleText]);

  useEffect(() => {
    typingTargetRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleGlobalShortcut(event) {
      if (event.defaultPrevented) {
        return;
      }

      if (event.repeat) {
        return;
      }

      if (event.ctrlKey && (event.key === 'm' || event.key === 'M')) {
        event.preventDefault();
        onToggleMute();
        typingTargetRef.current?.focus();
        return;
      }

      if (event.ctrlKey && event.key === 'Enter') {
        event.preventDefault();
        onFinishSession();
      }
    }

    window.addEventListener('keydown', handleGlobalShortcut);
    return () => {
      window.removeEventListener('keydown', handleGlobalShortcut);
    };
  }, [onFinishSession, onToggleMute]);

  useLayoutEffect(() => {
    const viewport = typingViewportRef.current;
    const currentCharacter = currentCharacterRef.current;
    const caret = caretRef.current;

    if (!viewport || !currentCharacter || !caret) {
      if (caret) {
        caret.style.opacity = '0';
      }
      return;
    }

    const viewportAnchor = viewport.clientHeight * CARET_ANCHOR_RATIO;
    const nextOffset = Math.max(0, currentCharacter.offsetTop - viewportAnchor);
    const textFlow = currentCharacter.parentElement;
    const flowLeft = textFlow?.offsetLeft || 0;
    const flowTop = textFlow?.offsetTop || 0;
    const caretX = flowLeft + currentCharacter.offsetLeft;
    const caretY =
      flowTop + currentCharacter.offsetTop - nextOffset + currentCharacter.offsetHeight;
    const caretWidth = Math.max(10, currentCharacter.offsetWidth || 12);

    setScrollOffset((previousOffset) => {
      if (Math.abs(previousOffset - nextOffset) < 1) {
        return previousOffset;
      }

      return nextOffset;
    });

    caret.style.width = `${Math.round(caretWidth)}px`;
    caret.style.transform = `translate(${Math.round(caretX)}px, ${Math.round(caretY)}px)`;
    caret.style.opacity = '1';
  }, [cursorIndex, visibleText]);

  function handleKeyDown(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      onStepBack();
      return;
    }

    if (event.key.length === 1) {
      event.preventDefault();
      onTypingInteraction();
      onTypeCharacter(event.key);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      onTypingInteraction();
      onTypeCharacter(' ');
    }
  }

  function handleMuteToggle() {
    onToggleMute();
    typingTargetRef.current?.focus();
  }

  function handleFinishSession() {
    onFinishSession();
  }

  return (
    <section className="typing-screen">
      <div
        className="typing-target"
        ref={typingTargetRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onMouseDown={() => typingTargetRef.current?.focus()}
        aria-label="Typing practice area"
      >
        <div
          className="typing-viewport"
          ref={typingViewportRef}
          onWheel={(event) => event.preventDefault()}
        >
          <p
            className="typing-text-flow"
            style={{ transform: `translateY(-${scrollOffset}px)` }}
            aria-hidden="true"
          >
            {visibleCharacters.map((character, index) => {
              const absoluteIndex = windowStart + index;
              let className = 'glyph glyph-pending';

              if (absoluteIndex < cursorIndex) {
                className = typedResults[absoluteIndex] ? 'glyph glyph-correct' : 'glyph glyph-incorrect';
              }

              if (absoluteIndex === cursorIndex) {
                className = 'glyph glyph-current';
              }

              return (
                <span
                  key={absoluteIndex}
                  className={className}
                  ref={absoluteIndex === cursorIndex ? currentCharacterRef : null}
                >
                  {character}
                </span>
              );
            })}
          </p>

          <span className="typing-caret" ref={caretRef} aria-hidden="true" />

          <div
            className={`typing-top-fade-overlay${scrollOffset > 2 ? ' active' : ''}`}
            aria-hidden="true"
          />
          <div className="typing-fade-overlay" aria-hidden="true" />
        </div>
      </div>

      <div className="control-bar-wrap">
        <ControlBar
          elapsedSeconds={elapsedSeconds}
          liveWpm={liveWpm}
          isMuted={isMuted}
          onToggleMute={handleMuteToggle}
          onFinishSession={handleFinishSession}
        />
      </div>
    </section>
  );
}

export default TypingScreen;
