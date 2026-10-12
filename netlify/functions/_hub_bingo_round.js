// Bingo rounds and weeks, shared by the game (hub-bingo) and Bingo Admin
// (hub-bingo-rewards) so both always agree on the current round and week.
// A round is 28 days from the anchor date; everyone gets one free draw per
// calendar week (Monday to Sunday, Eastern time).
const DEFAULT_ROUND_ANCHOR = '2026-09-21';
const ROUND_DAYS = 28;

function easternDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function epochDay(dateText) {
  const [y, m, d] = String(dateText).split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

function dateFromEpoch(day) {
  const date = new Date(day * 86400000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function roundInfo(settings = {}) {
  const current = easternDate();
  const currentDay = epochDay(current);
  const requestedAnchor = String(settings.anchorDate || '').trim().slice(0, 20);
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(requestedAnchor) ? requestedAnchor : DEFAULT_ROUND_ANCHOR;
  const anchorDay = epochDay(anchor);
  const cycle = Math.max(0, Math.floor((currentDay - anchorDay) / ROUND_DAYS));
  const startDay = anchorDay + cycle * ROUND_DAYS;
  const endDay = startDay + ROUND_DAYS - 1;
  const start = dateFromEpoch(startDay);
  const resetNumber = Math.max(0, Number(settings.resetNumber || 0));

  // Free Bingo draws refresh on the warehouse calendar week: every Monday
  // in America/New_York, regardless of when the current Bingo round began.
  const weekday = new Date(currentDay * 86400000).getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  const mondayDay = currentDay - daysSinceMonday;
  const monday = dateFromEpoch(mondayDay);

  return {
    key: resetNumber > 0 ? `${start}:r${resetNumber}` : start,
    start,
    end: dateFromEpoch(endDay),
    daysLeft: Math.max(0, endDay - currentDay + 1),
    weekKey: `monday:${monday}`,
    weekStart: monday,
    weekEnd: dateFromEpoch(mondayDay + 6),
  };
}

module.exports = { DEFAULT_ROUND_ANCHOR, ROUND_DAYS, easternDate, epochDay, dateFromEpoch, roundInfo };
