// api/surf-report.js
// Vercel Serverless Function — called by cron twice daily
// Fetches Bells Beach conditions from Stormglass, posts to Discord webhook

const BELLS_BEACH = {
  lat: -38.3667,
  lng: 144.2833,
  name: "Bells Beach",
};

// Wave direction degrees → compass label
function degreesToCompass(deg) {
  if (deg == null) return "—";
  const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}

// Pick the best source value from Stormglass's multi-model response
function pick(sources) {
  if (!sources) return null;
  return (
    sources.sg ??         // Stormglass combined model (best)
    sources.noaa ??
    sources.meteo ??
    Object.values(sources)[0] ??
    null
  );
}

// Round to 1 decimal
function r1(n) {
  return n != null ? Math.round(n * 10) / 10 : null;
}

// Simple surf rating based on wave height + period
function rating(waveHeight, wavePeriod) {
  const h = waveHeight ?? 0;
  const p = wavePeriod ?? 0;
  if (h >= 2.0 && p >= 12) return "🔥 Firing";
  if (h >= 1.5 && p >= 10) return "✅ Good";
  if (h >= 1.0 && p >= 8)  return "👌 Decent";
  if (h >= 0.5)             return "😐 Small";
  return "🪨 Flat";
}

export default async function handler(req, res) {
  // Vercel cron passes GET requests — allow manual POST too for testing
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const STORMGLASS_KEY = process.env.STORMGLASS_API_KEY;
  const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;

  if (!STORMGLASS_KEY || !DISCORD_WEBHOOK) {
    return res.status(500).json({ error: "Missing environment variables" });
  }

  // Fetch a 3-hour window centered on now so we have the current hour
  const now = new Date();
  const start = new Date(now.getTime() - 60 * 60 * 1000);  // 1hr ago
  const end   = new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2hrs ahead

  const params = [
    "waveHeight",
    "wavePeriod",
    "waveDirection",
    "swellHeight",
    "swellPeriod",
    "swellDirection",
    "windSpeed",
    "windDirection",
    "waterTemperature",
  ].join(",");

  const sgUrl = new URL("https://api.stormglass.io/v2/weather/point");
  sgUrl.searchParams.set("lat",   BELLS_BEACH.lat);
  sgUrl.searchParams.set("lng",   BELLS_BEACH.lng);
  sgUrl.searchParams.set("params", params);
  sgUrl.searchParams.set("start", start.toISOString());
  sgUrl.searchParams.set("end",   end.toISOString());

  let sgData;
  try {
    const sgRes = await fetch(sgUrl.toString(), {
      headers: { Authorization: STORMGLASS_KEY },
    });
    if (!sgRes.ok) {
      const err = await sgRes.text();
      return res.status(502).json({ error: `Stormglass error: ${sgRes.status}`, detail: err });
    }
    sgData = await sgRes.json();
  } catch (e) {
    return res.status(502).json({ error: "Failed to fetch Stormglass", detail: e.message });
  }

  // Grab the closest hour to now
  const hours = sgData.hours ?? [];
  if (!hours.length) {
    return res.status(502).json({ error: "No hourly data returned from Stormglass" });
  }

  const closest = hours.reduce((best, h) => {
    const diff = Math.abs(new Date(h.time) - now);
    return diff < Math.abs(new Date(best.time) - now) ? h : best;
  }, hours[0]);

  // Extract values
  const waveH  = r1(pick(closest.waveHeight));
  const waveP  = r1(pick(closest.wavePeriod));
  const waveDeg = pick(closest.waveDirection);
  const waveDir = degreesToCompass(waveDeg);
  const swellH  = r1(pick(closest.swellHeight));
  const swellP  = r1(pick(closest.swellPeriod));
  const swellDeg = pick(closest.swellDirection);
  const swellDir = degreesToCompass(swellDeg);
  const windSpd = r1(pick(closest.windSpeed));   // m/s from Stormglass
  const windDeg = pick(closest.windDirection);
  const windDir = degreesToCompass(windDeg);
  const waterT  = r1(pick(closest.waterTemperature));

  // Wind speed: convert m/s → knots for surf context
  const windKts = windSpd != null ? r1(windSpd * 1.944) : null;

  const surf = rating(waveH, waveP);

  // Format local time (AEST/AEDT — UTC+10/+11)
  const localTime = new Date(closest.time).toLocaleString("en-AU", {
    timeZone: "Australia/Melbourne",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  // Build the Discord embed
  const embed = {
    title: `🌊 Bells Beach — ${surf}`,
    color: 0x00b4d8,  // teal
    description: `Conditions at ${localTime} (AEST)`,
    fields: [
      {
        name: "🌊 Waves",
        value: `**${waveH ?? "—"}m** @ ${waveP ?? "—"}s | ${waveDir}`,
        inline: true,
      },
      {
        name: "🌀 Swell",
        value: `**${swellH ?? "—"}m** @ ${swellP ?? "—"}s | ${swellDir}`,
        inline: true,
      },
      {
        name: "💨 Wind",
        value: `**${windKts ?? "—"}kts** | ${windDir}`,
        inline: true,
      },
      {
        name: "🌡️ Water Temp",
        value: waterT != null ? `${waterT}°C` : "—",
        inline: true,
      },
    ],
    footer: {
      text: "Stormglass API • Bells Beach, VIC 🤙",
    },
    timestamp: new Date().toISOString(),
  };

  // Post to Discord
  try {
    const discordRes = await fetch(DISCORD_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
    });
    if (!discordRes.ok) {
      const err = await discordRes.text();
      return res.status(502).json({ error: "Discord webhook failed", detail: err });
    }
  } catch (e) {
    return res.status(502).json({ error: "Failed to post to Discord", detail: e.message });
  }

  return res.status(200).json({ ok: true, surfRating: surf, dataTime: closest.time });
}
