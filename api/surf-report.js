const BELLS_BEACH = { lat: -38.3667, lng: 144.2833 };

function degreesToCompass(deg) {
  if (deg == null) return "—";
  const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}

function pick(sources) {
  if (!sources) return null;
  return sources.sg ?? sources.noaa ?? sources.meteo ?? Object.values(sources)[0] ?? null;
}

function r1(n) {
  return n != null ? Math.round(n * 10) / 10 : null;
}

function rating(waveHeight, wavePeriod) {
  const h = waveHeight ?? 0;
  const p = wavePeriod ?? 0;
  if (h >= 2.0 && p >= 12) return "🔥 Firing";
  if (h >= 1.5 && p >= 10) return "✅ Good";
  if (h >= 1.0 && p >= 8)  return "👌 Decent";
  if (h >= 0.5)             return "😐 Small";
  return "🪨 Flat";
}

async function getRipCurlSummary(conditions) {
  const { waveH, waveP, waveDir, swellH, swellP, swellDir, windKts, windDir, waterT, surf, localTime } = conditions;

  const prompt = `You are the voice of Rip Curl at Bells Beach. Rip Curl was founded at Bells Beach. This is home. You know Bells better than anyone on earth.

Write a short, punchy surf conditions summary for this morning's report. 2-4 sentences max.

Voice: irreverent, knowledgeable, trusted local. Dry humour. Never corporate. Surf-native language. Like a mate who's surfed Bells for 30 years texting you whether to bother paddling out.

You know the break intimately:
- Rincon is the long right-hander on the south end, works best on a solid SW swell with light NE winds
- Bells Bowl is the main peak, the iconic one, needs good S-SW groundswell and period to really fire
- Winki Pop is around the headland to the north, a punchy left-hander that works on smaller swells and different wind angles — worth the walk when Bells is blown out
- Water temps at Bells sit around 13-17°C year round. Under 15°C means a good steamer (4/3 minimum). Under 13°C means booties, gloves, hood — the works.
- SW swells are the money direction for Bells. NNE waves with short period (under 8s) means wind swell — usually bumpy and ordinary.
- Light N or NE winds are offshore at Bells and groom it beautifully. S or SW winds are onshore and rough it up.

Current conditions:
- Waves: ${waveH}m @ ${waveP}s | ${waveDir}
- Swell: ${swellH}m @ ${swellP}s | ${swellDir}
- Wind: ${windKts}kts | ${windDir}
- Water temp: ${waterT}°C
- Time: ${localTime}
- Overall rating: ${surf}

Be specific to these actual conditions. Call out which part of the break might be working (or not). Recommend gear if water temp warrants it. If it's worth paddling out, say where. If it's not worth it, be honest but still Bells-proud about it. Never make up conditions that aren't there.

Return only the summary text. No labels, no preamble.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }]
      })
    });
    const data = await res.json();
    return data.content?.[0]?.text ?? null;
  } catch (e) {
    return null;
  }
}

module.exports = async function handler(req, res) {
  const STORMGLASS_KEY = process.env.STORMGLASS_API_KEY;
  const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;

  if (!STORMGLASS_KEY || !DISCORD_WEBHOOK) {
    return res.status(500).json({ error: "Missing environment variables" });
  }

  const now = new Date();
  const start = new Date(now.getTime() - 60 * 60 * 1000);
  const end = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const params = "waveHeight,wavePeriod,waveDirection,swellHeight,swellPeriod,swellDirection,windSpeed,windDirection,waterTemperature";
  const sgUrl = `https://api.stormglass.io/v2/weather/point?lat=${BELLS_BEACH.lat}&lng=${BELLS_BEACH.lng}&params=${params}&start=${start.toISOString()}&end=${end.toISOString()}`;

  let sgData;
  try {
    const sgRes = await fetch(sgUrl, { headers: { Authorization: STORMGLASS_KEY } });
    if (!sgRes.ok) {
      const err = await sgRes.text();
      return res.status(502).json({ error: `Stormglass error: ${sgRes.status}`, detail: err });
    }
    sgData = await sgRes.json();
  } catch (e) {
    return res.status(502).json({ error: "Failed to fetch Stormglass", detail: e.message });
  }

  const hours = sgData.hours ?? [];
  if (!hours.length) return res.status(502).json({ error: "No data from Stormglass" });

  const closest = hours.reduce((best, h) =>
    Math.abs(new Date(h.time) - now) < Math.abs(new Date(best.time) - now) ? h : best
  , hours[0]);

  const waveH    = r1(pick(closest.waveHeight));
  const waveP    = r1(pick(closest.wavePeriod));
  const waveDir  = degreesToCompass(pick(closest.waveDirection));
  const swellH   = r1(pick(closest.swellHeight));
  const swellP   = r1(pick(closest.swellPeriod));
  const swellDir = degreesToCompass(pick(closest.swellDirection));
  const windSpd  = r1(pick(closest.windSpeed));
  const windDir  = degreesToCompass(pick(closest.windDirection));
  const waterT   = r1(pick(closest.waterTemperature));
  const windKts  = windSpd != null ? r1(windSpd * 1.944) : null;
  const surf     = rating(waveH, waveP);

  const localTime = new Date(now).toLocaleString("en-AU", {
    timeZone: "Australia/Melbourne",
    hour: "2-digit", minute: "2-digit",
    weekday: "short", day: "numeric", month: "short"
  });

  // Get Rip Curl AI summary
  const ripCurlTake = await getRipCurlSummary({
    waveH, waveP, waveDir, swellH, swellP, swellDir,
    windKts, windDir, waterT, surf, localTime
  });

  const fields = [
    { name: "🌊 Waves",        value: `**${waveH ?? "—"}m** @ ${waveP ?? "—"}s | ${waveDir}`, inline: true },
    { name: "🌀 Swell",        value: `**${swellH ?? "—"}m** @ ${swellP ?? "—"}s | ${swellDir}`, inline: true },
    { name: "💨 Wind",         value: `**${windKts ?? "—"}kts** | ${windDir}`, inline: true },
    { name: "🌡️ Water Temp",  value: waterT != null ? `${waterT}°C` : "—", inline: true },
  ];

  if (ripCurlTake) {
    fields.push({ name: "🤙 The Rip Curl Take", value: ripCurlTake, inline: false });
  }

  const embed = {
    title: `🌊 Bells Beach — ${surf}`,
    color: 0x00b4d8,
    description: `Conditions at ${localTime} (AEST)`,
    fields,
    footer: { text: "Stormglass API • Bells Beach, VIC 🤙" },
    timestamp: new Date().toISOString()
  };

  try {
    const discordRes = await fetch(DISCORD_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] })
    });
    if (!discordRes.ok) {
      const err = await discordRes.text();
      return res.status(502).json({ error: "Discord webhook failed", detail: err });
    }
  } catch (e) {
    return res.status(502).json({ error: "Failed to post to Discord", detail: e.message });
  }

  return res.status(200).json({ ok: true, surfRating: surf, dataTime: closest.time });
};
