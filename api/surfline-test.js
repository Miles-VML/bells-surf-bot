// Surfline API diagnostic -- call this once to see raw response structure
// Visit: https://bells-surf-bot.vercel.app/api/surfline-test

const SPOT_ID = "584204204e65fad6a77099c7";
const BASE_URL = "https://platform.surfline.com";

function getAuthHeader() {
  const username = process.env.SURFLINE_USERNAME;
  const password = process.env.SURFLINE_PASSWORD;
  if (!username || !password) return null;
  const encoded = Buffer.from(`${username}:${password}`).toString("base64");
  return `Basic ${encoded}`;
}

async function fetchEndpoint(path) {
  const auth = getAuthHeader();
  if (!auth) return { error: "Missing credentials" };

  try {
    const res = await fetch(`${BASE_URL}${path}?spotId=${SPOT_ID}`, {
      headers: { "Authorization": auth, "Accept": "application/json" }
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { return { status: res.status, parseError: e.message, raw: text.slice(0, 500) }; }

    // Return just the top-level keys and first item of any arrays so we can see structure
    const preview = {};
    for (const [key, val] of Object.entries(data)) {
      if (Array.isArray(val)) {
        preview[key] = { isArray: true, length: val.length, firstItem: val[0] ?? null };
      } else if (val && typeof val === "object") {
        preview[key] = { isObject: true, keys: Object.keys(val) };
      } else {
        preview[key] = val;
      }
    }

    return { status: res.status, topLevelKeys: Object.keys(data), preview };
  } catch (e) {
    return { error: e.message };
  }
}

module.exports = async function handler(req, res) {
  const [wave, wind, weather, tides] = await Promise.all([
    fetchEndpoint("/spots/forecasts/wave"),
    fetchEndpoint("/spots/forecasts/wind"),
    fetchEndpoint("/spots/forecasts/weather"),
    fetchEndpoint("/spots/forecasts/tides"),
  ]);

  return res.status(200).json({ wave, wind, weather, tides });
};
