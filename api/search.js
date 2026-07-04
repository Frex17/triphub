// FlightScan - motore di ricerca combinazioni
// Mettere in: api/search.js
// GET /api/search?from=BRI&to=MAD&date=2026-08-08&minH=1&maxH=3
const R = require("./_ryanair.js");

const MAXHUBS = 10;     // scali esaminati (priorita alle basi)
const MAXOPTIONS = 30;  // risultati restituiti

function fmtDur(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h + "h " + String(m).padStart(2, "0") + "m";
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=3600");
  try {
    const q = req.query || {};
    const from = String(q.from || "").toUpperCase();
    const to = String(q.to || "").toUpperCase();
    const date = String(q.date || "");
    const minH = parseFloat(q.minH || "1");
    const maxH = parseFloat(q.maxH || "3");
    if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).send(JSON.stringify({ error: "Parametri non validi: servono from, to (IATA) e date YYYY-MM-DD." }));
      return;
    }
    const result = await search(from, to, date, minH, maxH);
    res.status(200).send(JSON.stringify(result));
  } catch (e) {
    res.status(502).send(JSON.stringify({ error: String((e && e.message) || e) }));
  }
};

async function search(from, to, date, minH, maxH) {
  const parts = date.split("-").map(Number);
  const y = parts[0], m = parts[1], d = parts[2];

  const A = await R.getAirports();
  const tz = (c) => (A[c] && A[c].tz) || "Europe/London";
  const cityOf = (c) => (A[c] && A[c].city) || c;
  const baseOf = (c) => !!(A[c] && A[c].base);

  const routesPair = await Promise.all([R.getRoutes(from), R.getRoutes(to)]);
  const routesO = routesPair[0], routesD = routesPair[1];

  const meta = { hubsConsidered: 0, direct: 0, connections: 0, errors: [] };
  const options = [];

  function mkLeg(o, dst, f) {
    const dep = R.hhmm(f.departureTime), arr = R.hhmm(f.arrivalTime);
    const depUTC = R.localToUTC(tz(o), y, m, d, dep[0], dep[1]);
    let arrUTC = R.localToUTC(tz(dst), y, m, d, arr[0], arr[1]);
    if (arrUTC <= depUTC) arrUTC += 24 * 3600 * 1000;
    return {
      from: o, fromCity: cityOf(o), to: dst, toCity: cityOf(dst),
      dep: f.departureTime, arr: f.arrivalTime,
      fn: (f.carrierCode || "FR") + " " + f.number,
      depUTC, arrUTC, durMin: Math.round((arrUTC - depUTC) / 60000)
    };
  }
  function dayFlights(sched) {
    const dd = (sched.days || []).find((x) => x.day === d);
    return dd ? dd.flights : [];
  }
  function laterInfo(flights, o, depUTC) {
    const later = [];
    for (const f of flights) {
      const hm = R.hhmm(f.departureTime);
      const u = R.localToUTC(tz(o), y, m, d, hm[0], hm[1]);
      if (u > depUTC) later.push({ u: u, t: f.departureTime });
    }
    later.sort((a, b) => a.u - b.u);
    return { count: later.length, nextT: later.length ? later[0].t : "" };
  }

  // ---- DIRETTI ----
  if (routesO.indexOf(to) !== -1) {
    const sched = await R.getSchedule(from, to, y, m);
    const fl = dayFlights(sched);
    for (const f of fl) {
      const leg = mkLeg(from, to, f);
      const li = laterInfo(fl, from, leg.depUTC);
      options.push({
        type: "direct", legs: [leg], layovers: [],
        crit: from + "-" + to, later: li.count, nextT: li.nextT, totalMin: leg.durMin
      });
      meta.direct++;
    }
  }

  // ---- 1 SCALO ----
  const dset = {};
  for (const c of routesD) dset[c] = true;
  let hubs = routesO.filter((h) => dset[h] && h !== from && h !== to);
  hubs.sort((a, b) => (baseOf(b) ? 1 : 0) - (baseOf(a) ? 1 : 0));
  hubs = hubs.slice(0, MAXHUBS);
  meta.hubsConsidered = hubs.length;

  const minMs = minH * 3600 * 1000, maxMs = maxH * 3600 * 1000;

  await Promise.all(hubs.map(async (H) => {
    try {
      const pair = await Promise.all([R.getSchedule(from, H, y, m), R.getSchedule(H, to, y, m)]);
      const f1 = dayFlights(pair[0]), f2 = dayFlights(pair[1]);
      if (!f1.length || !f2.length) return;
      for (const a of f1) {
        const leg1 = mkLeg(from, H, a);
        for (const b of f2) {
          const leg2 = mkLeg(H, to, b);
          const lay = leg2.depUTC - leg1.arrUTC;
          if (lay >= minMs && lay <= maxMs) {
            const li1 = laterInfo(f1, from, leg1.depUTC);
            const li2 = laterInfo(f2, H, leg2.depUTC);
            const bott = li2.count <= li1.count
              ? { route: H + "-" + to, info: li2 }
              : { route: from + "-" + H, info: li1 };
            options.push({
              type: "stop", via: H, legs: [leg1, leg2],
              layovers: [{ durMin: Math.round(lay / 60000), at: cityOf(H), base: baseOf(H) }],
              crit: bott.route, later: bott.info.count, nextT: bott.info.nextT,
              totalMin: Math.round((leg2.arrUTC - leg1.depUTC) / 60000)
            });
            meta.connections++;
          }
        }
      }
    } catch (e) {
      meta.errors.push(H + ": " + String((e && e.message) || e));
    }
  }));

  // ---- rifinitura ----
  for (const o of options) {
    o.totalLabel = fmtDur(o.totalMin);
    for (const l of o.legs) { l.durLabel = fmtDur(l.durMin); delete l.depUTC; delete l.arrUTC; }
    for (const lo of o.layovers) lo.dur = fmtDur(lo.durMin);
  }
  options.sort((a, b) => (b.later - a.later) || (a.totalMin - b.totalMin));
  const capped = options.slice(0, MAXOPTIONS);

  return {
    from, to, date, fromCity: cityOf(from), toCity: cityOf(to),
    count: capped.length, options: capped, meta
  };
}
