// Vercel serverless function: cheapest one-way fare from London (all airports)
// to each ski airport, departing in the next 7 days.
// Data: Travelpayouts / Aviasales Data API (cached fares found by users recently).
// Needs the TRAVELPAYOUTS_TOKEN environment variable, set in Vercel project settings.

const AIRPORTS = [
  "GVA", "LYS", "CMF", "GNB", "ZRH", "SIR", "MXP", "BGY", "TRN", "INN", "FDH", "SZG", "MUC", "VCE",
  "TSF", "BZO", "VRN", "TLS", "BCN", "LEU", "GRX", "AGP", "OSD", "OSL", "KTT", "KRK", "TAT", "SOF"
];
const ORIGIN = "LON";
const DAYS = 7;

const isoDate = d => d.toISOString().slice(0, 10);

async function cheapest(token, destination, months, from, to) {
  let best = null;
  for (const month of months) {
    const q = new URLSearchParams({
      origin: ORIGIN,
      destination,
      departure_at: month,
      one_way: "true",
      currency: "gbp",
      sorting: "price",
      limit: "100"
    });
    const res = await fetch(`https://api.travelpayouts.com/aviasales/v3/prices_for_dates?${q}`, {
      headers: { "X-Access-Token": token }
    });
    if (!res.ok) throw new Error(`Travelpayouts ${res.status}`);
    const body = await res.json();
    for (const f of body.data || []) {
      const day = (f.departure_at || "").slice(0, 10);
      if (day < from || day > to) continue;
      if (!best || f.price < best.price) best = f;
    }
  }
  return best && {
    price: best.price,
    departure_at: best.departure_at,
    airline: best.airline,
    flight_number: best.flight_number,
    transfers: best.transfers,
    origin_airport: best.origin_airport,
    link: best.link ? `https://www.aviasales.com${best.link}` : null
  };
}

module.exports = async (req, res) => {
  const token = process.env.TRAVELPAYOUTS_TOKEN;
  if (!token) {
    res.status(500).json({ error: "TRAVELPAYOUTS_TOKEN is not set in Vercel" });
    return;
  }

  const start = new Date();
  const end = new Date(start.getTime() + (DAYS - 1) * 86400000);
  const from = isoDate(start), to = isoDate(end);
  const months = [...new Set([from.slice(0, 7), to.slice(0, 7)])];

  const fares = {};
  const errors = [];
  // A few airports at a time to stay well inside the API's rate limit
  for (let i = 0; i < AIRPORTS.length; i += 6) {
    await Promise.all(AIRPORTS.slice(i, i + 6).map(async code => {
      try {
        fares[code] = await cheapest(token, code, months, from, to);
      } catch (err) {
        fares[code] = null;
        errors.push(`${code}: ${err.message}`);
      }
    }));
  }

  // Let Vercel's CDN serve the same answer for 6 hours
  res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=3600");
  res.status(200).json({ updated: start.toISOString(), origin: ORIGIN, currency: "GBP", from, to, fares, errors });
};
