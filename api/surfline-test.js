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
    try { data = JSON.parse(text); } catch (e) { return { status: res.status, parseError: e.message }; }
    return { status: res.status, data };
  } catch (e) {
    return { error: e.message };
  }
}

function safeSlice(obj) {
  // Return first 2 items of any array, full objects up to depth 3
  if (Array.isArray(obj)) return obj.slice(0, 2).map(safeSlice);
  if (obj && typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = safeSlice(v);
    }
    return out;
  }
  return obj;
}

module.exports = async function handler(req, res) {
  const [wave, wind, weather, tides] = await Promise.all([
    fetchEndpoint("/spots/forecasts/wave"),
    fetchEndpoint("/spots/forecasts/wind"),
    fetchEndpoint("/spots/forecasts/weather"),
    fetchEndpoint("/spots/forecasts/tides"),
  ]);

  return res.status(200).json({
    wave:    { status: wave.status,    sample: safeSlice(wave.data) },
    wind:    { status: wind.status,    sample: safeSlice(wind.data) },
    weather: { status: weather.status, sample: safeSlice(weather.data) },
    tides:   { status: tides.status,   sample: safeSlice(tides.data) },
  });
};
