// FlightScan - lista aeroporti (nomi in italiano) per la tendina
// Mettere in: api/airports.js
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

let CACHE = null, TS = 0;

async function fetchLoc(loc) {
  const r = await fetch(
    "https://www.ryanair.com/api/views/locate/5/airports/" + loc + "/active",
    { headers: { "User-Agent": UA, Accept: "application/json, text/plain, */*" } }
  );
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=86400");
  try {
    if (!CACHE || Date.now() - TS > 6 * 3600 * 1000) {
      let arr;
      try { arr = await fetchLoc("it"); }   // nomi italiani
      catch (e) { arr = await fetchLoc("en"); } // fallback inglese
      CACHE = arr.map((a) => ({
        code: a.code,
        name: a.name,
        city: (a.city && a.city.name) || a.name,
        country: (a.country && a.country.name) || "",
        base: !!a.base
      }));
      TS = Date.now();
    }
    res.status(200).send(JSON.stringify(CACHE));
  } catch (e) {
    res.status(502).send(JSON.stringify({ error: String((e && e.message) || e) }));
  }
};
