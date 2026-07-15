import './loadEnv.js';

const SESSION_DURATION_MS = 20 * 60 * 1000;

const DEFAULT_START = '2026-07-17T16:00:00+05:30';
const DEFAULT_END = '2026-07-17T17:00:00+05:30';

function parseEventTime(value, fallback) {
  const ms = Date.parse(value || fallback);
  if (Number.isNaN(ms)) {
    throw new Error(`Invalid event time: ${value || fallback}`);
  }
  return ms;
}

export function getEventBounds() {
  const startAt = parseEventTime(process.env.EVENT_START_AT, DEFAULT_START);
  const endAt = parseEventTime(process.env.EVENT_END_AT, DEFAULT_END);
  if (endAt <= startAt) {
    throw new Error('EVENT_END_AT must be after EVENT_START_AT');
  }
  return { startAt, endAt };
}

export function formatEventTime(ms, timeZone = process.env.EVENT_TIMEZONE || 'Asia/Kolkata') {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(ms));
}

export function formatEventDate(ms, timeZone = process.env.EVENT_TIMEZONE || 'Asia/Kolkata') {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(ms));
}

export function getEventStatus(now = Date.now()) {
  const bypass = process.env.EVENT_BYPASS === 'true';
  const { startAt, endAt } = getEventBounds();
  const timeZone = process.env.EVENT_TIMEZONE || 'Asia/Kolkata';

  let phase = 'live';
  if (now < startAt) phase = 'before';
  else if (now >= endAt) phase = 'after';

  if (bypass) {
    return {
      bypass: true,
      phase: 'live',
      startAt,
      endAt,
      now,
      startsInMs: 0,
      endsInMs: SESSION_DURATION_MS,
      startLabel: formatEventTime(startAt, timeZone),
      endLabel: formatEventTime(endAt, timeZone),
      dateLabel: formatEventDate(startAt, timeZone),
      timeZone,
      isOpen: true,
    };
  }

  return {
    bypass: false,
    phase,
    startAt,
    endAt,
    now,
    startsInMs: phase === 'before' ? startAt - now : 0,
    endsInMs: phase === 'live' ? endAt - now : 0,
    startLabel: formatEventTime(startAt, timeZone),
    endLabel: formatEventTime(endAt, timeZone),
    dateLabel: formatEventDate(startAt, timeZone),
    timeZone,
    isOpen: phase === 'live',
  };
}

export function assertEventOpen(now = Date.now()) {
  const status = getEventStatus(now);
  if (status.isOpen) return status;

  if (status.phase === 'before') {
    const err = new Error(`Gamethon opens at ${status.startLabel} (${status.dateLabel}).`);
    err.code = 'EVENT_NOT_STARTED';
    err.status = 403;
    err.event = status;
    throw err;
  }

  const err = new Error(`Gamethon ended at ${status.endLabel} (${status.dateLabel}).`);
  err.code = 'EVENT_ENDED';
  err.status = 403;
  err.event = status;
  throw err;
}

export function sessionExpiresAtForLogin(now = Date.now(), { testUser = false } = {}) {
  if (testUser) {
    return now + SESSION_DURATION_MS;
  }
  const status = getEventStatus(now);
  assertEventOpen(now);
  const personalLimit = now + SESSION_DURATION_MS;
  if (status.bypass) return personalLimit;
  return Math.min(personalLimit, status.endAt);
}
