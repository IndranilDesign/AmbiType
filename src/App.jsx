import { useCallback, useEffect, useRef, useState } from 'react';
import LandingScreen from './components/LandingScreen';
import SummaryScreen from './components/SummaryScreen';
import TypingScreen from './components/TypingScreen';
import {
  consumePreloadedCorpusSession,
  preloadCorpusSession
} from './lib/corpusLoader';
import {
  ROLLING_WINDOW_MS,
  WPM_UI_UPDATE_MS,
  calculateAccuracy,
  calculateSessionAverageWpm,
  getRollingWpmDisplay,
  isWordBoundary,
  trimTypingEvents
} from './lib/stats';

const SCREEN = {
  LANDING: 'landing',
  TYPING: 'typing',
  SUMMARY: 'summary'
};

const MUTE_STORAGE_KEY = 'ambitype-muted';
const THEME_STORAGE_KEY = 'ambitype-theme';
const SHORT_SESSION_SKIP_SUMMARY_SECONDS = 10;
const INITIAL_TEXT_LENGTH = 24000;
const BUFFER_AHEAD_CHARS = 1700;
const BUFFER_EXTENSION_STEP = 4000;
const EMAIL_ADDRESS = 'indranil2k@gmail.com';
const LINKEDIN_URL = 'https://www.linkedin.com/in/indranil-chaudhuri-09b288194/';
const FALLBACK_CORPUS_NOTICE =
  'Corpus unavailable. Run npm run corpus:build to generate local typing text files.';

const TRACK_PATHS = [
  '/Tracks/ES_Alleviated Mind - Hanna Lindgren.mp3',
  '/Tracks/ES_Arc of Transcendence - Lama House.mp3',
  '/Tracks/ES_Atomic Chant - Joseph Beg.mp3',
  '/Tracks/ES_Birdsong by the River - Center of Attention.mp3',
  '/Tracks/ES_Capitola Sunset - Alan Ellis.mp3',
  '/Tracks/ES_Forest Canopy - 369.mp3',
  '/Tracks/ES_Holding on to Hope - Megan Wofford.mp3',
  '/Tracks/ES_Imagine Sleep - Hanna Lindgren.mp3',
  '/Tracks/ES_Lost in Thought - Amaranth Cove.mp3',
  '/Tracks/ES_Sacred Space 432 - 369.mp3',
  '/Tracks/ES_Sitting on the Moon - Rebecca Mardal.mp3',
  '/Tracks/ES_Snow Lantern - Syntropy.mp3',
  '/Tracks/ES_Sydkoster - Elm Lake.mp3',
  '/Tracks/ES_The Calm Outside - Chill Cole.mp3',
  '/Tracks/ES_Tranquillity Coast - Rebecca Mardal.mp3',
  '/Tracks/ES_The Sun Might Rise in the West - Jakob Ahlbom.mp3',
  '/Tracks/ES_Underscore - Hampus Naeselius.mp3'
].map((track) => encodeURI(track));

const EMPTY_SUMMARY = {
  averagePace: 0,
  wordsTyped: 0,
  accuracy: 100,
  timeTyped: 0
};

function shuffleArray(items) {
  const next = [...items];

  for (let index = next.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    const temp = next[index];
    next[index] = next[randomIndex];
    next[randomIndex] = temp;
  }

  return next;
}

function getStoredMutePreference() {
  try {
    const storedValue = localStorage.getItem(MUTE_STORAGE_KEY);

    if (storedValue === 'true') {
      return true;
    }

    if (storedValue === 'false') {
      return false;
    }

    // First-time visitors start muted by default.
    return true;
  } catch (error) {
    // In restricted contexts, default to muted for safe first-run behavior.
    return true;
  }
}

function getStoredThemePreference() {
  try {
    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    if (storedTheme === 'light' || storedTheme === 'dark') {
      return storedTheme;
    }
  } catch (error) {
    // Ignore storage failures in restricted contexts.
  }

  return null;
}

function getSystemThemePreference() {
  if (typeof window === 'undefined' || !window.matchMedia) {
    return 'light';
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getInitialThemePreference() {
  return getStoredThemePreference() || getSystemThemePreference();
}

function createFallbackText(minLength = INITIAL_TEXT_LENGTH) {
  let text = `${FALLBACK_CORPUS_NOTICE} `;

  while (text.length < minLength) {
    text += `${FALLBACK_CORPUS_NOTICE} `;
  }

  return text;
}

function App() {
  const [screen, setScreen] = useState(SCREEN.LANDING);
  const [sessionRunId, setSessionRunId] = useState(0);
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [isEmailCopied, setIsEmailCopied] = useState(false);
  const [isMuted, setIsMuted] = useState(getStoredMutePreference);
  const [theme, setTheme] = useState(getInitialThemePreference);
  const [hasThemeOverride, setHasThemeOverride] = useState(
    () => Boolean(getStoredThemePreference())
  );
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [playlist, setPlaylist] = useState(() => shuffleArray(TRACK_PATHS));
  const [trackIndex, setTrackIndex] = useState(0);

  const [targetText, setTargetText] = useState(() =>
    createFallbackText(INITIAL_TEXT_LENGTH)
  );
  const [cursorIndex, setCursorIndex] = useState(0);

  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [liveWpm, setLiveWpm] = useState(null);
  const [summaryStats, setSummaryStats] = useState(EMPTY_SUMMARY);
  const [isStartPreparing, setIsStartPreparing] = useState(false);

  const audioRef = useRef(null);
  const audioFadeFrameRef = useRef(null);
  const infoPopoverRef = useRef(null);
  const copiedResetTimerRef = useRef(null);

  const targetTextRef = useRef(targetText);
  const typedResultsRef = useRef([]);
  const cursorRef = useRef(cursorIndex);
  const elapsedRef = useRef(0);
  const liveWpmRef = useRef(liveWpm);
  const corpusStreamRef = useRef(null);
  const sessionLoadIdRef = useRef(0);
  const sessionStartInFlightRef = useRef(false);

  const statsRef = useRef({
    totalTypedChars: 0,
    correctTypedChars: 0,
    totalWordsTyped: 0,
    firstTypedAt: 0,
    lastTypedAt: 0
  });

  const currentWordRef = useRef({ hasChars: false, hasMistake: false });
  const typingEventsRef = useRef([]);

  const effectiveMuted = isMuted || audioBlocked;

  useEffect(() => {
    targetTextRef.current = targetText;
  }, [targetText]);

  useEffect(() => {
    cursorRef.current = cursorIndex;
  }, [cursorIndex]);

  useEffect(() => {
    elapsedRef.current = elapsedSeconds;
  }, [elapsedSeconds]);

  useEffect(() => {
    liveWpmRef.current = liveWpm;
  }, [liveWpm]);

  useEffect(() => {
    try {
      localStorage.setItem(MUTE_STORAGE_KEY, String(isMuted));
    } catch (error) {
      // Ignore storage failures in restricted contexts.
    }
  }, [isMuted]);

  useEffect(() => {
    if (!hasThemeOverride) {
      return;
    }

    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (error) {
      // Ignore storage failures in restricted contexts.
    }
  }, [hasThemeOverride, theme]);

  useEffect(() => {
    if (hasThemeOverride || typeof window === 'undefined' || !window.matchMedia) {
      return undefined;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleThemeChange = (event) => {
      setTheme(event.matches ? 'dark' : 'light');
    };

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleThemeChange);
      return () => {
        mediaQuery.removeEventListener('change', handleThemeChange);
      };
    }

    mediaQuery.addListener(handleThemeChange);
    return () => {
      mediaQuery.removeListener(handleThemeChange);
    };
  }, [hasThemeOverride]);

  useEffect(() => {
    if (!isInfoOpen) {
      return;
    }

    function handleOutsideClick(event) {
      if (!infoPopoverRef.current?.contains(event.target)) {
        setIsInfoOpen(false);
      }
    }

    window.addEventListener('mousedown', handleOutsideClick);
    return () => {
      window.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [isInfoOpen]);

  useEffect(
    () => () => {
      if (copiedResetTimerRef.current) {
        window.clearTimeout(copiedResetTimerRef.current);
      }
    },
    []
  );

  const stopAudioFade = useCallback(() => {
    if (audioFadeFrameRef.current) {
      window.cancelAnimationFrame(audioFadeFrameRef.current);
      audioFadeFrameRef.current = null;
    }
  }, []);

  const fadeAudioVolume = useCallback(
    (targetVolume, durationMs = 320, options = {}) => {
      const { pauseWhenSilent = false, onComplete } = options;
      const audio = audioRef.current;

      if (!audio) {
        return;
      }

      stopAudioFade();

      const fromVolume = Number.isFinite(audio.volume) ? audio.volume : 1;
      const toVolume = Math.max(0, Math.min(1, targetVolume));

      if (Math.abs(fromVolume - toVolume) < 0.01) {
        audio.volume = toVolume;

        if (toVolume <= 0.01 && pauseWhenSilent) {
          audio.pause();
        }

        if (typeof onComplete === 'function') {
          onComplete();
        }

        return;
      }

      const startedAt = performance.now();

      const animate = (now) => {
        const progress = Math.min(1, (now - startedAt) / durationMs);
        const easedProgress = 1 - (1 - progress) * (1 - progress);
        audio.volume = fromVolume + (toVolume - fromVolume) * easedProgress;

        if (progress < 1) {
          audioFadeFrameRef.current = window.requestAnimationFrame(animate);
          return;
        }

        audio.volume = toVolume;
        audioFadeFrameRef.current = null;

        if (toVolume <= 0.01 && pauseWhenSilent) {
          audio.pause();
        }

        if (typeof onComplete === 'function') {
          onComplete();
        }
      };

      audioFadeFrameRef.current = window.requestAnimationFrame(animate);
    },
    [stopAudioFade]
  );

  const attemptAudioPlay = useCallback(
    async (withFade = false) => {
      const audio = audioRef.current;

      if (!audio) {
        return false;
      }

      if (isMuted) {
        return false;
      }

      if (withFade) {
        audio.volume = Math.min(audio.volume || 1, 0.05);
      } else {
        audio.volume = 1;
      }

      audio.muted = false;

      try {
        await audio.play();
        setAudioBlocked(false);

        if (withFade) {
          fadeAudioVolume(1, 380);
        }

        return true;
      } catch (error) {
        setAudioBlocked(true);
        return false;
      }
    },
    [fadeAudioVolume, isMuted]
  );

  const resetSessionModel = useCallback((initialText) => {
    const safeInitialText =
      typeof initialText === 'string' && initialText.length > 0
        ? initialText
        : createFallbackText(INITIAL_TEXT_LENGTH);

    targetTextRef.current = safeInitialText;
    cursorRef.current = 0;
    elapsedRef.current = 0;

    setTargetText(safeInitialText);
    setCursorIndex(0);
    typedResultsRef.current = [];
    setElapsedSeconds(0);
    setLiveWpm(null);
    liveWpmRef.current = null;

    statsRef.current = {
      totalTypedChars: 0,
      correctTypedChars: 0,
      totalWordsTyped: 0,
      firstTypedAt: 0,
      lastTypedAt: 0
    };

    currentWordRef.current = { hasChars: false, hasMistake: false };
    typingEventsRef.current = [];
  }, []);

  const prepareNextTracklist = useCallback(() => {
    const shuffledPlaylist = shuffleArray(TRACK_PATHS);
    setPlaylist(shuffledPlaylist);
    setTrackIndex(0);

    const audio = audioRef.current;
    if (audio && shuffledPlaylist.length) {
      audio.src = shuffledPlaylist[0];
      audio.currentTime = 0;
      audio.load();
    }
  }, []);

  const startSession = useCallback(async () => {
    if (sessionStartInFlightRef.current) {
      return;
    }

    sessionStartInFlightRef.current = true;
    setIsStartPreparing(true);

    const currentLoadId = sessionLoadIdRef.current + 1;
    sessionLoadIdRef.current = currentLoadId;

    let initialSessionText = createFallbackText(INITIAL_TEXT_LENGTH);
    let nextCorpusStream = null;

    try {
      try {
        const corpusSession = await consumePreloadedCorpusSession({
          initialChars: INITIAL_TEXT_LENGTH
        });

        if (sessionLoadIdRef.current !== currentLoadId) {
          return;
        }

        nextCorpusStream = corpusSession.stream;
        initialSessionText = corpusSession.initialText;
      } catch (error) {
        if (sessionLoadIdRef.current !== currentLoadId) {
          return;
        }

        nextCorpusStream = null;
        console.error('Failed to load corpus text:', error);
      }

      if (sessionLoadIdRef.current !== currentLoadId) {
        return;
      }

      corpusStreamRef.current = nextCorpusStream;
      resetSessionModel(initialSessionText);
      prepareNextTracklist();
      setAudioBlocked(false);
      setScreen(SCREEN.TYPING);
      setSessionRunId((previous) => previous + 1);

      if (!isMuted) {
        void attemptAudioPlay(true);
      }
    } finally {
      sessionStartInFlightRef.current = false;
      setIsStartPreparing(false);
    }
  }, [attemptAudioPlay, isMuted, prepareNextTracklist, resetSessionModel]);

  const finishSession = useCallback(() => {
    const sessionSeconds = elapsedRef.current;

    if (sessionSeconds < SHORT_SESSION_SKIP_SUMMARY_SECONDS) {
      setScreen(SCREEN.LANDING);

      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }

      return;
    }

    const accuracy = calculateAccuracy(
      statsRef.current.correctTypedChars,
      statsRef.current.totalTypedChars
    );

    const averagePace = calculateSessionAverageWpm(
      statsRef.current.correctTypedChars,
      elapsedRef.current * 1000
    );

    const carriedWords = currentWordRef.current.hasChars ? 1 : 0;

    setSummaryStats({
      averagePace,
      wordsTyped: statsRef.current.totalWordsTyped + carriedWords,
      accuracy,
      timeTyped: sessionSeconds
    });

    setScreen(SCREEN.SUMMARY);

    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted((previousMuteState) => {
      const nextMuteState = !previousMuteState;
      const audio = audioRef.current;

      if (nextMuteState) {
        if (audio) {
          audio.muted = false;

          fadeAudioVolume(0, 260, {
            pauseWhenSilent: true,
            onComplete: () => {
              const currentAudio = audioRef.current;
              if (currentAudio) {
                currentAudio.muted = true;
              }
            }
          });
        }
      } else {
        if (audio) {
          audio.muted = false;
          audio.volume = Math.min(audio.volume || 1, 0.05);
        }
        setAudioBlocked(false);
        if (screen === SCREEN.TYPING) {
          void attemptAudioPlay(true);
        }
      }

      return nextMuteState;
    });
  }, [attemptAudioPlay, fadeAudioVolume, screen]);

  const handleTypingInteraction = useCallback(() => {
    const audio = audioRef.current;

    if (!audio || isMuted) {
      return;
    }

    if (audio.paused || audioBlocked) {
      void attemptAudioPlay(true);
    }
  }, [attemptAudioPlay, audioBlocked, isMuted]);

  const handleStepBack = useCallback(() => {
    const currentCursor = cursorRef.current;

    if (currentCursor <= 0) {
      return;
    }

    const previousIndex = currentCursor - 1;
    cursorRef.current = previousIndex;
    setCursorIndex(previousIndex);

    if (typedResultsRef.current[previousIndex] !== undefined) {
      typedResultsRef.current[previousIndex] = undefined;
    }
  }, []);

  const handleTypeCharacter = useCallback((typedCharacter) => {
    const now = Date.now();
    const currentCursor = cursorRef.current;

    let nextText = targetTextRef.current;
    if (nextText.length <= currentCursor + BUFFER_AHEAD_CHARS) {
      const minimumLength =
        currentCursor + BUFFER_AHEAD_CHARS + BUFFER_EXTENSION_STEP;
      if (corpusStreamRef.current) {
        nextText = corpusStreamRef.current.ensureLength(nextText, minimumLength);
      } else {
        nextText = createFallbackText(minimumLength);
      }
      targetTextRef.current = nextText;
      setTargetText(nextText);
    }

    const expectedCharacter = nextText[currentCursor] ?? ' ';
    const isCorrect = typedCharacter === expectedCharacter;

    typedResultsRef.current[currentCursor] = isCorrect;

    const nextCursor = currentCursor + 1;
    cursorRef.current = nextCursor;
    setCursorIndex(nextCursor);

    statsRef.current.totalTypedChars += 1;

    if (isCorrect) {
      statsRef.current.correctTypedChars += 1;
    }

    if (!statsRef.current.firstTypedAt) {
      statsRef.current.firstTypedAt = now;
    }

    statsRef.current.lastTypedAt = now;
    typingEventsRef.current.push({
      t: now,
      chars: 1,
      correctChars: isCorrect ? 1 : 0
    });
    trimTypingEvents(typingEventsRef.current, now, ROLLING_WINDOW_MS * 3);

    const activeWord = currentWordRef.current;

    if (isWordBoundary(typedCharacter)) {
      if (!isCorrect && activeWord.hasChars) {
        activeWord.hasMistake = true;
      }

      if (activeWord.hasChars) {
        statsRef.current.totalWordsTyped += 1;
      }

      currentWordRef.current = { hasChars: false, hasMistake: false };
    } else {
      activeWord.hasChars = true;

      if (!isCorrect) {
        activeWord.hasMistake = true;
      }
    }

  }, []);

  useEffect(() => {
    if (screen !== SCREEN.TYPING) {
      return undefined;
    }

    const startedAt = Date.now();
    const timerId = window.setInterval(() => {
      const nextElapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      elapsedRef.current = nextElapsedSeconds;
      setElapsedSeconds(nextElapsedSeconds);
    }, 250);

    return () => {
      window.clearInterval(timerId);
    };
  }, [screen, sessionRunId]);

  useEffect(() => {
    if (screen !== SCREEN.TYPING) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      const now = Date.now();
      trimTypingEvents(
        typingEventsRef.current,
        now,
        ROLLING_WINDOW_MS * 3
      );

      const { displayWpm } = getRollingWpmDisplay({
        events: typingEventsRef.current,
        now,
        firstTypedAt: statsRef.current.firstTypedAt,
        totalTypedChars: statsRef.current.totalTypedChars,
        lastTypedAt: statsRef.current.lastTypedAt,
        previousDisplay: liveWpmRef.current
      });

      const nextDisplay = displayWpm ?? null;
      setLiveWpm((previousDisplay) =>
        previousDisplay === nextDisplay ? previousDisplay : nextDisplay
      );
    }, WPM_UI_UPDATE_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [screen, sessionRunId]);

  useEffect(() => {
    if (screen !== SCREEN.LANDING) {
      return undefined;
    }

    function handleLandingEnter(event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        startSession();
      }
    }

    window.addEventListener('keydown', handleLandingEnter);

    return () => {
      window.removeEventListener('keydown', handleLandingEnter);
    };
  }, [screen, startSession]);

  useEffect(() => {
    if (screen !== SCREEN.SUMMARY) {
      return undefined;
    }

    function handleSummaryEnter(event) {
      if (event.defaultPrevented || event.repeat) {
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        startSession();
      }
    }

    window.addEventListener('keydown', handleSummaryEnter);
    return () => {
      window.removeEventListener('keydown', handleSummaryEnter);
    };
  }, [screen, startSession]);

  useEffect(() => {
    if (screen !== SCREEN.LANDING) {
      return undefined;
    }

    const preloadTimerId = window.setTimeout(() => {
      void preloadCorpusSession({
        initialChars: INITIAL_TEXT_LENGTH
      });
    }, 80);

    return () => {
      window.clearTimeout(preloadTimerId);
    };
  }, [screen]);

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio || !playlist.length) {
      return;
    }

    const nextTrack = playlist[trackIndex];

    if (audio.src !== `${window.location.origin}${nextTrack}`) {
      audio.src = nextTrack;
      audio.load();
    }

    if (screen === SCREEN.TYPING && !effectiveMuted) {
      void attemptAudioPlay(true);
    }
  }, [attemptAudioPlay, effectiveMuted, playlist, screen, trackIndex]);

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    if (screen !== SCREEN.TYPING) {
      stopAudioFade();
      audio.pause();
      audio.muted = isMuted;
      audio.volume = 1;
      return;
    }

    if (isMuted) {
      audio.muted = true;
      return;
    }

    audio.muted = false;

    if (audioBlocked) {
      return;
    }

    if (audio.paused) {
      void attemptAudioPlay(true);
    } else {
      fadeAudioVolume(1, 360);
    }
  }, [attemptAudioPlay, audioBlocked, fadeAudioVolume, isMuted, screen, stopAudioFade]);

  useEffect(
    () => () => {
      stopAudioFade();
    },
    [stopAudioFade]
  );

  function handleTrackEnded() {
    setTrackIndex((previousIndex) => {
      if (!playlist.length) {
        return 0;
      }

      return (previousIndex + 1) % playlist.length;
    });
  }

  function handleToggleTheme() {
    setHasThemeOverride(true);
    setTheme((previousTheme) => (previousTheme === 'dark' ? 'light' : 'dark'));
  }

  function handleOpenLinkedIn() {
    window.open(LINKEDIN_URL, '_blank', 'noopener,noreferrer');
  }

  async function handleCopyEmail() {
    try {
      await navigator.clipboard.writeText(EMAIL_ADDRESS);
    } catch (error) {
      const fallbackInput = document.createElement('textarea');
      fallbackInput.value = EMAIL_ADDRESS;
      fallbackInput.setAttribute('readonly', '');
      fallbackInput.style.position = 'fixed';
      fallbackInput.style.opacity = '0';
      document.body.appendChild(fallbackInput);
      fallbackInput.select();
      document.execCommand('copy');
      document.body.removeChild(fallbackInput);
    }

    setIsEmailCopied(true);

    if (copiedResetTimerRef.current) {
      window.clearTimeout(copiedResetTimerRef.current);
    }

    copiedResetTimerRef.current = window.setTimeout(() => {
      setIsEmailCopied(false);
    }, 3000);
  }

  return (
    <div className={`app-shell ${theme === 'dark' ? 'theme-dark' : 'theme-light'}`}>
      <audio ref={audioRef} preload="none" onEnded={handleTrackEnded} />

      <div className="top-controls">
        <button
          type="button"
          className="top-action-button theme-toggle-button"
          onClick={handleToggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          <img
            src={theme === 'dark' ? '/icons/Dark_mode.svg' : '/icons/Light_mode.svg'}
            alt=""
            aria-hidden="true"
          />
        </button>

        <div className="info-popover-wrap" ref={infoPopoverRef}>
          <button
            type="button"
            className="top-action-button info-button"
            onClick={() => setIsInfoOpen((previousState) => !previousState)}
            aria-label="Project information"
            aria-expanded={isInfoOpen}
          >
            <img src="/icons/infor.svg" alt="" aria-hidden="true" />
          </button>

          <aside
            className={`info-popover${isInfoOpen ? ' open' : ''}`}
            role="dialog"
            aria-label="About AmbiType"
            aria-hidden={!isInfoOpen}
          >
            <p className="info-popover-copy">
              Hey! I&apos;m Indranil, a product designer. I decided to build AmbiType because I wanted a
              calm, endless typing space that felt nice to use. After a few late-night work sessions and
              a concerning amount of coffee, it was finally done!
              <br />
              If you find any bugs, have thoughts, or just want to say hi, DM me on LinkedIn or shoot
              me an email 😊
            </p>

            <div className="info-popover-actions">
              <button type="button" className="info-action-button" onClick={handleOpenLinkedIn}>
                <img src="/icons/LinkedIn.svg" alt="" aria-hidden="true" />
                <span>LinkedIn</span>
              </button>

              <button
                type="button"
                className={`info-action-button copy-email-button${isEmailCopied ? ' copied' : ''}`}
                onClick={handleCopyEmail}
                aria-label={isEmailCopied ? 'Copied' : 'Copy email'}
              >
                <span className="copy-state copy-default" aria-hidden={isEmailCopied}>
                  <img src="/icons/Copy.svg" alt="" aria-hidden="true" />
                  <span>Copy email</span>
                </span>
                <span className="copy-state copy-success" aria-hidden={!isEmailCopied}>
                  <img src="/icons/Check.svg" alt="" aria-hidden="true" />
                  <span>Copied</span>
                </span>
              </button>
            </div>
          </aside>
        </div>
      </div>

      <main
        className={`app-card ${screen === SCREEN.TYPING ? 'typing-card' : 'default-card'} screen-${screen}`}
      >
        {screen === SCREEN.LANDING && (
          <LandingScreen onStartSession={startSession} isPreparing={isStartPreparing} />
        )}

        {screen === SCREEN.TYPING && (
          <TypingScreen
            key={sessionRunId}
            targetText={targetText}
            cursorIndex={cursorIndex}
            typedResults={typedResultsRef.current}
            elapsedSeconds={elapsedSeconds}
            liveWpm={liveWpm}
            isMuted={effectiveMuted}
            onToggleMute={toggleMute}
            onFinishSession={finishSession}
            onTypeCharacter={handleTypeCharacter}
            onStepBack={handleStepBack}
            onTypingInteraction={handleTypingInteraction}
          />
        )}

        {screen === SCREEN.SUMMARY && (
          <SummaryScreen summaryStats={summaryStats} onRestartSession={startSession} />
        )}
      </main>

      <section className="mobile-unavailable" aria-label="Mobile availability notice">
        <h1>AmbiType is not available on mobile yet.</h1>
        <p>I&apos;m still working on it, please view on desktop for now :)</p>
      </section>
    </div>
  );
}

export default App;
