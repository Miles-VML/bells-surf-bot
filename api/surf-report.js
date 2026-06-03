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

function uvLabel(uv) {
  if (uv == null) return "—";
  if (uv <= 2)  return `${uv} Low`;
  if (uv <= 5)  return `${uv} Moderate`;
  if (uv <= 7)  return `${uv} High`;
  if (uv <= 10) return `${uv} Very High`;
  return `${uv} Extreme`;
}

function rating(waveHeight, wavePeriod) {
  const h = waveHeight ?? 0;
  const p = wavePeriod ?? 0;
  if (h >= 2.0 && p >= 12) return "🔥";
  if (h >= 1.5 && p >= 10) return "✅";
  if (h >= 1.0 && p >= 8)  return "👌";
  if (h >= 0.5)             return "😐";
  return "🪨";
}

function ratingLabel(waveHeight, wavePeriod) {
  const h = waveHeight ?? 0;
  const p = wavePeriod ?? 0;
  if (h >= 2.0 && p >= 12) return "🔥 Firing";
  if (h >= 1.5 && p >= 10) return "✅ Good";
  if (h >= 1.0 && p >= 8)  return "👌 Decent";
  if (h >= 0.5)             return "😐 Small";
  return "🪨 Flat";
}

function getMorningHour(hours, targetDate) {
  const target = new Date(targetDate);
  target.setUTCHours(21, 0, 0, 0);
  target.setDate(target.getDate() - 1);
  return hours.reduce((best, h) => {
    const diff = Math.abs(new Date(h.time) - target);
    return diff < Math.abs(new Date(best.time) - target) ? h : best;
  }, hours[0]);
}

function buildThreeDaySummary(hours, now) {
  const lines = [];
  for (let d = 1; d <= 3; d++) {
    const targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + d);
    const h = getMorningHour(hours, targetDate);
    if (!h) continue;

    const wH = r1(pick(h.waveHeight));
    const wP = pick(h.wavePeriod) != null ? Math.round(pick(h.wavePeriod)) : null;
    const wKts = pick(h.windSpeed) != null ? Math.round(pick(h.windSpeed) * 1.944) : null;
    const wWindDir = degreesToCompass(pick(h.windDirection));
    const emoji = rating(wH, wP);

    const dayLabel = new Date(h.time).toLocaleDateString("en-AU", {
      timeZone: "Australia/Melbourne",
      weekday: "short", day: "numeric", month: "short"
    });

    lines.push(`${emoji} ${dayLabel} — ${wH ?? "—"}m @ ${wP ?? "—"}s | Wind: ${wKts ?? "—"}kts ${wWindDir}`);
  }
  return lines.join("\n");
}

async function getRipCurlSummary(conditions) {
  const { waveH, waveP, waveDir, swellH, swellP, swellDir, windKts, gustKts, windDir, waterT, airT, surf, localTime, forecast } = conditions;

  const prompt = `You are the voice of Rip Curl at Bells Beach. Rip Curl was founded at Bells Beach. This is home. You know Bells better than anyone on earth.

Write a short, punchy surf conditions summary. 2-4 sentences max.

Voice: irreverent, knowledgeable, trusted local. Dry humour. Never corporate. Surf-native language. Like a mate who's surfed Bells for 30 years texting you whether to bother paddling out.

You know the break intimately:
- Rincon is the long right-hander on the south end, works best on a solid SW swell with light NE winds
- Bells Bowl is the main peak, the iconic one, needs good S-SW groundswell and period to really fire
- Winki Pop is around the headland to the north, a punchy left-hander that works on smaller swells and different wind angles — worth the walk when Bells is blown out
- Water temps at Bells sit around 13-17°C year round. Under 15°C means a good steamer (4/3 minimum). Under 13°C means booties, gloves, hood — the works.
- SW swells are the money direction for Bells. NNE waves with short period (under 8s) means wind swell — usually bumpy and ordinary.
- Light N or NE winds are offshore at Bells and groom it beautifully. S or SW winds are onshore and rough it up.
- High gusts (20kts+) relative to average wind speed mean gusty, unpredictable conditions even if the average looks manageable.

Current conditions:
- Waves: ${waveH}m @ ${waveP}s | ${waveDir}
- Swell: ${swellH}m @ ${swellP}s | ${swellDir}
- Wind: ${windKts}kts | ${windDir} (gusting ${gustKts}kts)
- Water temp: ${waterT}°C
- Air temp: ${airT}°C
- Time: ${localTime}
- Overall rating: ${surf}

3-day morning outlook (for context only — do not display the raw data, just weave the trend into your take naturally):
${forecast}

Be specific to these actual conditions. Call out which part of the break might be working (or not). Only mention gear if you're recommending someone actually paddle out — never suggest what to wear in the same breath as telling them to stay home. If gusts are significantly higher than average wind, mention it. If the forecast shows better surf coming, mention it naturally in one sentence — give people a reason to stay tuned. If it's all downhill from here, be honest about it. Never make up conditions that aren't there.

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
        max_tokens: 250,
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
  const end = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000);

  const params = "waveHeight,wavePeriod,waveDirection,swellHeight,swellPeriod,swellDirection,windSpeed,windDirection,windGust,waterTemperature,airTemperature,uvIndex";
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
  const waveP    = pick(closest.wavePeriod) != null ? Math.round(pick(closest.wavePeriod)) : null;
  const waveDir  = degreesToCompass(pick(closest.waveDirection));
  const swellH   = r1(pick(closest.swellHeight));
  const swellP   = pick(closest.swellPeriod) != null ? Math.round(pick(closest.swellPeriod)) : null;
  const swellDir = degreesToCompass(pick(closest.swellDirection));
  const windSpd  = r1(pick(closest.windSpeed));
  const windDir  = degreesToCompass(pick(closest.windDirection));
  const gustSpd  = pick(closest.windGust);
  const waterT   = r1(pick(closest.waterTemperature));
  const airT     = r1(pick(closest.airTemperature));
  const uvRaw    = pick(closest.uvIndex);
  const uv       = uvRaw != null ? Math.round(uvRaw) : null;
  const windKts  = windSpd != null ? r1(windSpd * 1.944) : null;
  const gustKts  = gustSpd != null ? r1(gustSpd * 1.944) : null;
  const surf     = ratingLabel(waveH, waveP);

  const localTime = new Date(now).toLocaleString("en-AU", {
    timeZone: "Australia/Melbourne",
    hour: "2-digit", minute: "2-digit",
    weekday: "short", day: "numeric", month: "short"
  });

  const forecastSummary = buildThreeDaySummary(hours, now);

  const ripCurlTake = await getRipCurlSummary({
    waveH, waveP, waveDir, swellH, swellP, swellDir,
    windKts, gustKts, windDir, waterT, airT, surf, localTime,
    forecast: forecastSummary
  });

  const conditionsBlock = [
    `🌊 **Waves** — ${waveH ?? "—"}m @ ${waveP ?? "—"}s | ${waveDir}`,
    `🌀 **Swell** — ${swellH ?? "—"}m @ ${swellP ?? "—"}s | ${swellDir}`,
    `💨 **Wind** — ${windKts ?? "—"}kts | ${windDir} (gusts ${gustKts ?? "—"}kts)`,
    `🌡️ **Water** — ${waterT ?? "—"}°C`,
    `🌤️ **Air** — ${airT ?? "—"}°C`,
    `☀️ **UV** — ${uvLabel(uv)}`,
  ].join("\n");

  const fields = [];

  if (ripCurlTake) {
    fields.push({ name: "The Rip Curl Take", value: ripCurlTake, inline: false });
  }

  const embed = {
    title: `Bells Beach — ${surf}`,
    color: 0x00b4d8,
    description: `Conditions at ${localTime} (AEST)\n\n${conditionsBlock}`,
    fields,
    footer: { text: "Stormglass API • Bells Beach, VIC" },
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
