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
    const wKph = pick(h.windSpeed) != null ? Math.round(pick(h.windSpeed) * 3.6) : null;
    const wWindDir = degreesToCompass(pick(h.windDirection));
    const emoji = rating(wH, wP);
    const dayLabel = new Date(h.time).toLocaleDateString("en-AU", {
      timeZone: "Australia/Melbourne",
      weekday: "short", day: "numeric", month: "short"
    });
    lines.push(`${emoji} ${dayLabel} — ${wH ?? "—"}m @ ${wP ?? "—"}s | Wind: ${wKph ?? "—"}km/h ${wWindDir}`);
  }
  return lines.join("\n");
}

async function fetchWorldTides(now) {
  const key = process.env.WORLDTIDES_API_KEY;
  if (!key) return null;

  // Request extremes for next 24 hours using LAT datum to match BOM published tables
  const url = `https://www.worldtides.info/api/v3?extremes&lat=${BELLS_BEACH.lat}&lon=${BELLS_BEACH.lng}&datum=LAT&days=2&timezone=Australia/Melbourne&key=${key}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    console.log("WorldTides raw:", JSON.stringify(data).slice(0, 600));
    return data.extremes ?? null;
  } catch (e) {
    return null;
  }
}

function buildTideSummary(extremes, now) {
  if (!extremes || !extremes.length) return null;

  // WorldTides returns dt (Unix seconds) and date (ISO string) -- use dt if available
  const getTime = (e) => e.dt ? new Date(e.dt * 1000) : new Date(e.date);
  // WorldTides type field is "High" or "Low"
  const getType = (e) => e.type === "High" ? "High" : "Low";

  // Find upcoming extremes
  const upcoming = extremes
    .filter(e => getTime(e) > now)
    .sort((a, b) => getTime(a) - getTime(b))
    .slice(0, 2);

  if (!upcoming.length) return null;

  const nextExtreme = upcoming[0];
  const direction = getType(nextExtreme) === "High" ? "Incoming" : "Outgoing";

  const formatTime = (e) => getTime(e).toLocaleTimeString("en-AU", {
    timeZone: "Australia/Melbourne",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  });

  const firstType = getType(nextExtreme);
  const firstHeight = r1(nextExtreme.height);
  let tideStr = `${direction}, ${firstType} ${firstHeight}m at ${formatTime(nextExtreme)}`;

  // Add second extreme if within 12 hours
  if (upcoming[1]) {
    const hoursDiff = (getTime(upcoming[1]) - now) / (1000 * 60 * 60);
    if (hoursDiff <= 12) {
      const secondType = getType(upcoming[1]);
      const secondHeight = r1(upcoming[1].height);
      tideStr += `, then ${secondType} ${secondHeight}m at ${formatTime(upcoming[1])}`;
    }
  }

  return tideStr;
}

async function getRipCurlSummary(conditions) {
  const { waveH, waveP, waveDir, swellH, swellP, swellDir, windKph, gustKph, windDir, waterT, airT, surf, localTime, forecast, tide } = conditions;

  const prompt = [
    "You are the voice of Rip Curl at Bells Beach. Rip Curl was born here in 1969. This is home turf. You have more sessions at Bells than anyone alive.",
    "",
    "Write a surf conditions summary of 2-4 sentences. Be the trusted local expert, not the hype merchant. Practical, specific, and worth reading. A dry wit is welcome but never at the expense of useful information.",
    "",
    "VOICE:",
    "- Knowledgeable coach who surfs here every day, not a pub storyteller",
    "- Rip Curl irreverence: direct, confident, occasionally sardonic, never corporate",
    "- Honest about bad conditions without being dramatic",
    "- Specific about which part of the break is working and why",
    "- Never performative, never try-hard",
    "",
    "YOU KNOW THIS BREAK:",
    "- Bells Bowl is the main peak. Needs solid S-SW groundswell with good period to fire. Offshore on N-NE winds.",
    "- Rincon is the long right on the south end. Works best on SW swell with light NE winds, more protected from westerlies.",
    "- Winki Pop is around the headland to the north. Punchy left-hander, works on smaller swells, different wind angles. Worth the walk when Bells is maxing out or blown out.",
    "- SW groundswell is the money direction. Short period NNE or NW chop is just wind swell, ordinary.",
    "- N or NE winds are offshore and groom it. W or SW winds are onshore and rough it up. Gusty winds (35km/h+ gusts over a 20km/h average) make even decent swell scrappy.",
    "- Bells Bowl surfs best from mid to high tide. Low tide exposes the reef and gets shallow and unpleasant. An incoming tide through a session is ideal.",
    "- Water is 13-17C year round. Cold but not unusual. Locals know.",
    "",
    "CURRENT CONDITIONS:",
    `- Waves: ${waveH}m @ ${waveP}s | ${waveDir}`,
    `- Swell: ${swellH}m @ ${swellP}s | ${swellDir}`,
    `- Wind: ${windKph}km/h | ${windDir} (gusting ${gustKph}km/h)`,
    `- Water temp: ${waterT}C`,
    `- Air temp: ${airT}C`,
    `- Tide: ${tide ?? "unknown"}`,
    `- Time: ${localTime}`,
    `- Overall rating: ${surf}`,
    "",
    "3-DAY OUTLOOK (weave naturally into your take if relevant, one sentence max, no raw data):",
    forecast,
    "",
    "RULES - non-negotiable:",
    "1. Never mention wetsuits, steamers, or gear unless you are telling someone to paddle out right now. Telling someone to wait = no gear talk. Ever.",
    "2. Never use em dashes. Use commas or full stops instead.",
    "3. Always include units with numbers: km/h for wind, m for wave height, degrees C for temp. Never reference period as a raw number in prose - say good period, long period, short-period chop etc.",
    "4. Never invent conditions. Stick to what the data shows.",
    "5. Reefs and points are the frame of reference, not beaches.",
    "6. Only reference tide if it meaningfully affects the session - e.g. low tide on the Bowl, or a rising tide that will improve things. Do not force a tide reference into every summary.",
    "",
    "Return only the summary. No label, no preamble."
  ].join("\n");

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

  const params = "waveHeight,wavePeriod,waveDirection,swellHeight,swellPeriod,swellDirection,windSpeed,windDirection,gust,waterTemperature,airTemperature";
  const sgUrl = `https://api.stormglass.io/v2/weather/point?lat=${BELLS_BEACH.lat}&lng=${BELLS_BEACH.lng}&params=${params}&start=${start.toISOString()}&end=${end.toISOString()}`;

  // Fetch weather and tides in parallel
  const [sgRes, tideExtremes] = await Promise.all([
    fetch(sgUrl, { headers: { Authorization: STORMGLASS_KEY } }).catch(() => null),
    fetchWorldTides(now)
  ]);

  if (!sgRes || !sgRes.ok) {
    const err = sgRes ? await sgRes.text() : "fetch failed";
    return res.status(502).json({ error: "Stormglass error", detail: err });
  }

  const sgData = await sgRes.json();
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
  const windSpd  = pick(closest.windSpeed);
  const windDir  = degreesToCompass(pick(closest.windDirection));
  const gustSpd  = pick(closest.gust);
  const waterT   = r1(pick(closest.waterTemperature));
  const airT     = r1(pick(closest.airTemperature));
  const windKph  = windSpd != null ? Math.round(windSpd * 3.6) : null;
  const gustKph  = gustSpd != null ? Math.round(gustSpd * 3.6) : null;
  const surf     = ratingLabel(waveH, waveP);

  const localTime = new Date(now).toLocaleString("en-AU", {
    timeZone: "Australia/Melbourne",
    hour: "2-digit", minute: "2-digit",
    weekday: "short", day: "numeric", month: "short"
  });

  const forecastSummary = buildThreeDaySummary(hours, now);
  const tideSummary = buildTideSummary(tideExtremes, now);

  const ripCurlTake = await getRipCurlSummary({
    waveH, waveP, waveDir, swellH, swellP, swellDir,
    windKph, gustKph, windDir, waterT, airT, surf, localTime,
    forecast: forecastSummary,
    tide: tideSummary
  });

  const conditionsLines = [
    `🌊 **Waves** — ${waveH ?? "—"}m @ ${waveP ?? "—"}s | ${waveDir}`,
    `🌀 **Swell** — ${swellH ?? "—"}m @ ${swellP ?? "—"}s | ${swellDir}`,
    `💨 **Wind** — ${windKph ?? "—"}km/h | ${windDir} (gusts ${gustKph ?? "—"}km/h)`,
    `🌡️ **Water** — ${waterT ?? "—"}°C`,
    `🌤️ **Air** — ${airT ?? "—"}°C`,
  ];

  if (tideSummary) {
    conditionsLines.push(`🌊 **Tide** — ${tideSummary}`);
  }

  const conditionsBlock = conditionsLines.join("\n");

  const fields = [];
  if (ripCurlTake) {
    fields.push({ name: "The Rip Curl Take", value: ripCurlTake, inline: false });
  }

  const embed = {
    title: `Bells Beach — ${surf}`,
    color: 0x00b4d8,
    description: `Conditions at ${localTime} (AEST)\n\n${conditionsBlock}`,
    fields,
    footer: { text: "Stormglass API • WorldTides • Bells Beach, VIC" },
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
