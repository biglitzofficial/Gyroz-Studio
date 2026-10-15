export function businessDateKey(date = new Date(), timeZone = "Asia/Kolkata") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function zonedTimeToUtc(dateKey: string, time: string, timeZone: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute, second] = time.split(":").map(Number);
  let utc = Date.UTC(year, month - 1, day, hour, minute, second || 0);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(utc)).map((part) => [part.type, part.value]));
    const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    const target = Date.UTC(year, month - 1, day, hour, minute, second || 0);
    const diff = target - asUtc;
    if (diff === 0) break;
    utc += diff;
  }
  return new Date(utc);
}

export function rangeFromKeys(fromKey: string, toKey: string, timeZone: string) {
  return {
    start: zonedTimeToUtc(fromKey, "00:00:00", timeZone),
    end: zonedTimeToUtc(toKey, "23:59:59", timeZone),
  };
}

export function eachDateKey(fromKey: string, toKey: string) {
  const keys: string[] = [];
  const [year, month, day] = fromKey.split("-").map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, day));
  const [endYear, endMonth, endDay] = toKey.split("-").map(Number);
  const end = Date.UTC(endYear, endMonth - 1, endDay);
  while (cursor.getTime() <= end) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

export function weekdayOfKey(dateKey: string, timeZone: string) {
  const instant = zonedTimeToUtc(dateKey, "12:00:00", timeZone);
  const label = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(instant);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(label);
}

export function monthBounds(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const start = `${monthKey}-01`;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${monthKey}-${String(last).padStart(2, "0")}`;
  return { start, end };
}

export function minutesBetween(start: Date, end: Date) {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}

export function minuteOfDay(date: Date, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return Number(parts.hour) * 60 + Number(parts.minute);
}

export function daysInMonth(monthKey: string) {
  return eachDateKey(monthBounds(monthKey).start, monthBounds(monthKey).end).length;
}

export function salaryPayDate(monthKey: string, salaryDay = 5) {
  const [year, month] = monthKey.split("-").map(Number);
  const paid = new Date(Date.UTC(year, month, 1));
  const last = new Date(Date.UTC(paid.getUTCFullYear(), paid.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(Math.max(salaryDay, 1), last);
  return `${paid.getUTCFullYear()}-${String(paid.getUTCMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseClock(clock: string) {
  const [hour, minute] = clock.split(":").map(Number);
  return hour * 60 + minute;
}
