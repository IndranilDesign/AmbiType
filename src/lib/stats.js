export const IDLE_THRESHOLD_MS = 5000;
export const ROLLING_WINDOW_MS = 10000;
export const WPM_UI_UPDATE_MS = 1000;
export const WPM_WARMUP_MS = 3000;
export const WPM_WARMUP_MIN_CHARS = 10;
export const WPM_IDLE_RESET_MS = 15000;

const WORD_BOUNDARY_PATTERN = /[\s.,!?;:]/;

export function isWordBoundary(character) {
  if (!character) {
    return false;
  }

  return WORD_BOUNDARY_PATTERN.test(character);
}

export function calculateAccuracy(correctCharacters, totalCharacters) {
  if (!totalCharacters) {
    return 100;
  }

  return Math.round((correctCharacters / totalCharacters) * 100);
}

// Keep only events in the retention window so the in-memory event list stays bounded.
export function trimTypingEvents(events, now, retentionMs = ROLLING_WINDOW_MS * 3) {
  if (!events.length) {
    return;
  }

  const minTime = now - retentionMs;
  let trimCount = 0;

  while (trimCount < events.length && events[trimCount].t < minTime) {
    trimCount += 1;
  }

  if (trimCount > 0) {
    events.splice(0, trimCount);
  }
}

// Rolling WPM uses the standard 5-char word and looks only at events in the recent window.
export function calculateRollingWpmFromEvents(events, now, windowMs = ROLLING_WINDOW_MS) {
  if (!events.length) {
    return { rollingWpm: 0, rawWpm: 0, hasEventsInWindow: false };
  }

  const windowStart = now - windowMs;
  let sumChars = 0;
  let sumCorrectChars = 0;
  let hasEventsInWindow = false;

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];

    if (event.t < windowStart) {
      break;
    }

    hasEventsInWindow = true;
    sumChars += event.chars;
    sumCorrectChars += event.correctChars;
  }

  if (!hasEventsInWindow) {
    return { rollingWpm: 0, rawWpm: 0, hasEventsInWindow: false };
  }

  const windowMinutes = windowMs / 60000;
  return {
    rollingWpm: Math.round(sumCorrectChars / 5 / windowMinutes),
    rawWpm: Math.round(sumChars / 5 / windowMinutes),
    hasEventsInWindow: true
  };
}

// Warm-up + idle behavior for live WPM display:
// - show dash (null) before enough data is available
// - keep prior value during short pauses
// - reset back to dash after a longer idle period
export function getRollingWpmDisplay({
  events,
  now,
  firstTypedAt,
  totalTypedChars,
  lastTypedAt,
  previousDisplay,
  windowMs = ROLLING_WINDOW_MS,
  warmupMs = WPM_WARMUP_MS,
  warmupMinChars = WPM_WARMUP_MIN_CHARS,
  idleResetMs = WPM_IDLE_RESET_MS
}) {
  if (!firstTypedAt || !totalTypedChars) {
    return { displayWpm: null, rawWpm: 0 };
  }

  const warmupReached =
    now - firstTypedAt >= warmupMs || totalTypedChars >= warmupMinChars;

  if (!warmupReached) {
    return { displayWpm: null, rawWpm: 0 };
  }

  const rolling = calculateRollingWpmFromEvents(events, now, windowMs);

  if (rolling.hasEventsInWindow) {
    return { displayWpm: rolling.rollingWpm, rawWpm: rolling.rawWpm };
  }

  if (lastTypedAt && now - lastTypedAt < idleResetMs) {
    return { displayWpm: previousDisplay, rawWpm: 0 };
  }

  return { displayWpm: null, rawWpm: 0 };
}

export function calculateSessionAverageWpm(correctChars, sessionMs) {
  if (sessionMs < 1000 || !correctChars) {
    return 0;
  }

  return Math.round((correctChars / 5 / sessionMs) * 60000);
}
