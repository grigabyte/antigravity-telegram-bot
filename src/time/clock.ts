export interface TimeContext {
  timezone: string;
  locale: string;
  nowIsoUtc: string;
  localDate: string;
  localTime: string;
  weekday: string;
}

const DEFAULT_TZ = 'Europe/Moscow';
const DEFAULT_LOCALE = 'ru-RU';

export function isValidTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat('ru-RU', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function normalizeTimezone(timezone: string): string {
  if (!timezone) return DEFAULT_TZ;
  return isValidTimezone(timezone) ? timezone : DEFAULT_TZ;
}

export function buildTimeContext(
  timezone: string,
  locale: string = DEFAULT_LOCALE,
  now: Date = new Date()
): TimeContext {
  const safeTimezone = normalizeTimezone(timezone);
  const safeLocale = locale || DEFAULT_LOCALE;

  const dateFormatter = new Intl.DateTimeFormat(safeLocale, {
    timeZone: safeTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const timeFormatter = new Intl.DateTimeFormat(safeLocale, {
    timeZone: safeTimezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const weekdayFormatter = new Intl.DateTimeFormat(safeLocale, {
    timeZone: safeTimezone,
    weekday: 'long',
  });

  return {
    timezone: safeTimezone,
    locale: safeLocale,
    nowIsoUtc: now.toISOString(),
    localDate: dateFormatter.format(now),
    localTime: timeFormatter.format(now),
    weekday: weekdayFormatter.format(now),
  };
}

export function getHourInTimezone(timezone: string, now: Date = new Date()): number {
  const safeTimezone = normalizeTimezone(timezone);
  const hourFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: safeTimezone,
    hour: '2-digit',
    hour12: false,
  });
  const hourString = hourFormatter.format(now);
  return Number.parseInt(hourString, 10);
}

export function isInQuietHours(
  timezone: string,
  quietStart: number,
  quietEnd: number,
  now: Date = new Date()
): boolean {
  const hour = getHourInTimezone(timezone, now);
  if (quietStart === quietEnd) return false;

  if (quietStart < quietEnd) {
    return hour >= quietStart && hour < quietEnd;
  }

  return hour >= quietStart || hour < quietEnd;
}

export function parseQuietHours(input: string): { start: number; end: number } | null {
  const match = input.trim().match(/^(\d{1,2})\s*[-:]\s*(\d{1,2})$/);
  if (!match) return null;

  const start = Number.parseInt(match[1], 10);
  const end = Number.parseInt(match[2], 10);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  if (start < 0 || start > 23 || end < 0 || end > 23) return null;

  return { start, end };
}
