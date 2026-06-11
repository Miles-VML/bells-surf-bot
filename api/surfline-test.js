// Surfline API diagnostic -- call this once to see raw response structure
// Visit: https://bells-surf-bot.vercel.app/api/surfline-test
// DELETE this file once we've confirmed the field mapping

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
  if (!auth) return { error: "Missing SURFLINE_USERNAME or SURFLINE_PASSWORD" };

  try {
    const res = await fetch(`${BASE_URL}${path}?spotId=${SPOT_ID}`, {
      headers: {
        "Authorization": auth,
        "Accept": "application/json"
      }
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = text.slice(0, 500); }

    return { status: res.status, data };
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

  // Return truncated responses so we can see structure without overwhelming output
  const truncate = (obj) => {
    const str = JSON.stringify(obj, null, 2);
    return str.length > 3000 ? str.slice(0, 3000) + "\n... [truncated]" : str;
  };

  res.setHeader("Content-Type", "application/json");
  return res.status(200).json({
    wave:    { status: wave.status,    preview: JSON.parse(truncate(wave.data    ?? wave))    },
    wind:    { status: wind.status,    preview: JSON.parse(truncate(wind.data    ?? wind))    },
    weather: { status: weather.status, preview: JSON.parse(truncate(weather.data ?? weather)) },
    tides:   { status: tides.status,   preview: JSON.parse(truncate(tides.data   ?? tides))   },
  });
};
