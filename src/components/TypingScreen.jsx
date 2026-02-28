import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ControlBar from './ControlBar';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isWhitespace(character) {
  return /\s/.test(character);
}

function findForwardBoundary(text, startIndex) {
  if (!text) {
    return 0;
  }

  let index = clamp(startIndex, 0, text.length);

  while (index < text.length && !isWhitespace(text[index])) {
    index += 1;
  }

  while (index < text.length && isWhitespace(text[index])) {
    index += 1;
  }

  return clamp(index, 0, text.length);
}

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
  const WINDOW_SHIFT_STEP = 160;
  const MIN_RENDER_WINDOW_CHARS = RENDER_BEFORE_CHARS + RENDER_AFTER_CHARS + WINDOW_SHIFT_STEP;

  const [scrollOffset, setScrollOffset] = useState(0);

  const typingViewportRef = useRef(null);
  const typingTargetRef = useRef(null);
  const textFlowRef = useRef(null);
  const currentCharacterRef = useRef(null);
  const caretRef = useRef(null);

  const windowStartIndex = useMemo(() => {
    if (!targetText) {
      return 0;
    }

    const safeCursor = clamp(cursorIndex, 0, targetText.length);
    if (safeCursor <= RENDER_BEFORE_CHARS) {
      return 0;
    }

    const desiredStart = safeCursor - RENDER_BEFORE_CHARS;
    const steppedStart = Math.floor(desiredStart / WINDOW_SHIFT_STEP) * WINDOW_SHIFT_STEP;
    const boundaryStart = findForwardBoundary(targetText, steppedStart);

    return clamp(boundaryStart, 0, safeCursor);
  }, [cursorIndex, targetText]);

  const prefixText = useMemo(() => {
    if (!targetText || windowStartIndex <= 0) {
      return '';
    }

    // Invisible prefix keeps line-wrapping continuity when the render window shifts.
    return targetText.slice(0, windowStartIndex);
  }, [targetText, windowStartIndex]);

  const visibleText = useMemo(() => {
    if (!targetText) {
      return '';
    }

    const safeCursor = clamp(cursorIndex, 0, targetText.length);
    const end = Math.min(
      targetText.length,
      Math.max(safeCursor + RENDER_AFTER_CHARS, windowStartIndex + MIN_RENDER_WINDOW_CHARS)
    );

    return targetText.slice(windowStartIndex, end);
  }, [cursorIndex, targetText, windowStartIndex]);

  const visibleCharacters = useMemo(() => visibleText.split(''), [visibleText]);

  useEffect(() => {
    typingTargetRef.current?.focus();
  }, []);

  useEffect(() => {
    if (cursorIndex === 0) {
      setScrollOffset(0);
    }
  }, [cursorIndex]);

  useEffect(() => {
    function handleGlobalShortcut(event) {
      if (event.defaultPrevented || event.repeat) {
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
    const textFlow = textFlowRef.current;
    const currentCharacter = currentCharacterRef.current;
    const caret = caretRef.current;

    if (!viewport || !textFlow || !currentCharacter || !caret) {
      if (caret) {
        caret.style.opacity = '0';
      }
      return;
    }

    const viewportAnchor = viewport.clientHeight * CARET_ANCHOR_RATIO;
    const nextOffset = Math.max(0, currentCharacter.offsetTop - viewportAnchor);
    const flowLeft = textFlow.offsetLeft || 0;
    const flowTop = textFlow.offsetTop || 0;
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
  }, [cursorIndex, visibleText, windowStartIndex]);

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
            ref={textFlowRef}
            style={{ transform: `translateY(-${scrollOffset}px)` }}
            aria-hidden="true"
          >
            {prefixText ? (
              <span className="typing-prefix-spacer" aria-hidden="true">
                {prefixText}
              </span>
            ) : null}

            {visibleCharacters.map((character, index) => {
              const absoluteIndex = windowStartIndex + index;
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
