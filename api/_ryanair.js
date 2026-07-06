// FlightScan - libreria condivisa (CommonJS)
// Mettere in: api/_ryanair.js  (il prefisso _ fa si che NON sia una route)
// Richiede Node 18+ su Vercel (fetch globale).

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function headers(cookie) {
  const h = {
    "User-Agent": UA,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-GB,en;q=0.9"
  };
  if (cookie) h.Cookie = cookie;
  return h;
}

let _cookie = null;
let _cookieTs = 0;
async function getCookie() {
  const now = Date.now();
  if (_cookie !== null && now - _cookieTs < 30 * 60 * 1000) return _cookie;
  try {
    const r = await fetch("https://www.ryanair.com/", { headers: headers() });
    const sc = r.headers.get("set-cookie");
    _cookie = sc ? sc.split(",").map((s) => s.split(";")[0]).join("; ") : "";
  } catch (e) {
    _cookie = "";
  }
  _cookieTs = now;
  return _cookie;
}

async function rfetch(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 8000);
  try {
    const cookie = await getCookie();
    const r = await fetch(url, { headers: headers(cookie), signal: ctrl.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

// ---- cache in memoria (per istanza calda) ----
const cache = { airports: null, airportsTs: 0, routes: {}, sched: {} };
const SIX_H = 6 * 3600 * 1000;
const ONE_H = 3600 * 1000;

async function getAirports() {
  const now = Date.now();
  if (cache.airports && now - cache.airportsTs < SIX_H) return cache.airports;
  const arr = await rfetch(
    "https://www.ryanair.com/api/views/locate/5/airports/en/active"
  );
  const map = {};
  for (const a of arr) {
    map[a.code] = {
      code: a.code,
      name: a.name,
      city: (a.city && a.city.name) || a.name,
      country: (a.country && a.country.name) || "",
      base: !!a.base,
      tz: a.timeZone || "Europe/London"
    };
  }
  cache.airports = map;
  cache.airportsTs = now;
  return map;
}

async function getRoutes(code) {
  const now = Date.now();
  const c = cache.routes[code];
  if (c && now - c.ts < SIX_H) return c.list;
  const arr = await rfetch(
    "https://www.ryanair.com/api/views/locate/searchWidget/routes/en/airport/" + code
  );
  const list = arr
    .map((x) => x.arrivalAirport && x.arrivalAirport.code)
    .filter(Boolean);
  cache.routes[code] = { list, ts: now };
  return list;
}

async function getSchedule(from, to, year, month) {
  const key = from + "-" + to + "-" + year + "-" + month;
  const now = Date.now();
  const c = cache.sched[key];
  if (c && now - c.ts < ONE_H) return c.data;
  let data;
  try {
    data = await rfetch(
      "https://services-api.ryanair.com/timtbl/3/schedules/" +
        from + "/" + to + "/years/" + year + "/months/" + month
    );
  } catch (e) {
    data = { month: Number(month), days: [] };
  }
  cache.sched[key] = { data, ts: now };
  return data;
}

// ---- tempo con fuso orario ----
function tzOffset(tz, ms) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
  const p = {};
  for (const part of dtf.formatToParts(new Date(ms))) p[part.type] = part.value;
  let hh = p.hour;
  if (hh === "24") hh = "00";
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +hh, +p.minute, +p.second);
  return asUTC - ms;
}
function localToUTC(tz, y, m, d, hh, mm) {
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0);
  return guess - tzOffset(tz, guess);
}
function hhmm(s) {
  const parts = String(s).split(":");
  return [Number(parts[0]), Number(parts[1])];
}

module.exports = { getAirports, getRoutes, getSchedule, localToUTC, hhmm };
