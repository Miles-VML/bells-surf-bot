const SPOT_ID = "584204204e65fad6a77099c7";
const BASE_URL = "https://platform.surfline.com";

// ─── Auth ────────────────────────────────────────────────────────────────────
function getAuthHeader() {
  const username = process.env.SURFLINE_USERNAME;
  const password = process.env.SURFLINE_PASSWORD;
  if (!username || !password) return null;
  const encoded = Buffer.from(`${username}:${password}`).toString("base64");
  return `Basic ${encoded}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function r1(n) { return n != null ? Math.round(n * 10) / 10 : null; }
function feetToMetres(ft) { return ft != null ? r1(ft / 3.281) : null; }
function degToCompass(deg) {
  if (deg == null) return "—";
  const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}

// Find the array item closest to now by unix timestamp
function closestToNow(arr, now) {
  if (!arr || !arr.length) return null;
  const nowSec = now.getTime() / 1000;
  return arr.reduce((best, h) =>
    Math.abs(h.timestamp - nowSec) < Math.abs(best.timestamp - nowSec) ? h : best
  , arr[0]);
}

// ─── Surfline fetch ───────────────────────────────────────────────────────────
async function fetchSurfline(path) {
  const auth = getAuthHeader();
  if (!auth) return null;
  try {
    const res = await fetch(`${BASE_URL}${path}?spotId=${SPOT_ID}`, {
      headers: { "Authorization": auth, "Accept": "application/json" }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data;
  } catch (e) {
    return null;
  }
}

// ─── Bells-specific rating ────────────────────────────────────────────────────
function compassToDeg(compass) {
  const map = { "N":0,"NNE":22,"NE":45,"ENE":67,"E":90,"ESE":112,"SE":135,"SSE":157,"S":180,"SSW":202,"SW":225,"WSW":247,"W":270,"WNW":292,"NW":315,"NNW":337 };
  return map[compass] ?? null;
}
function isBetween(deg, min, max) {
  if (min <= max) return deg >= min && deg <= max;
  return deg >= min || deg <= max;
}

function bellsRating({ swellDir, swellP, waveH, windDir, windKph, gustKph, tideHeight, tideDirection, windDirType }) {
  let score = 0;

  // 1. Swell direction (0-2.5pts)
  const swellDeg = compassToDeg(swellDir);
  if (swellDeg !== null) {
    if (isBetween(swellDeg, 157, 202))      score += 2.5;
    else if (isBetween(swellDeg, 202, 270)) score += 2.0;
    else if (isBetween(swellDeg, 112, 157)) score += 1.0;
  }

  // 2. Swell period (0-2pts)
  if (swellP != null) {
    if (swellP >= 14)      score += 2.0;
    else if (swellP >= 10) score += 1.5;
    else if (swellP >= 8)  score += 1.0;
  }

  // 3. Wave height (0-2pts)
  if (waveH != null) {
    if (waveH >= 1.5 && waveH <= 2.5)     score += 2.0;
    else if (waveH >= 1.0 && waveH < 1.5) score += 1.0;
    else if (waveH > 2.5 && waveH <= 3.5) score += 1.0;
  }

  // 4. Wind (0-2pts) -- use Surfline's directionType if available
  if (windDirType === "Offshore") {
    score += windKph != null && windKph <= 20 ? 2.0 : 1.0;
  } else if (windDirType === "Cross-shore") {
    score += 0.5;
  } else {
    // Fall back to degree calculation
    const windDeg = compassToDeg(windDir);
    if (windDeg !== null && windKph != null) {
      if (isBetween(windDeg, 0, 67) && windKph <= 20)      score += 2.0;
      else if (isBetween(windDeg, 0, 67) && windKph <= 35) score += 1.0;
      else if (isBetween(windDeg, 67, 157))                 score += 0.5;
    }
  }
  if (gustKph != null && windKph != null && (gustKph - windKph) >= 20) {
    score = Math.max(0, score - 0.5);
  }

  // 5. Tide (0-1.5pts)
  if (tideHeight != null) {
    if (tideDirection === "Incoming" && tideHeight >= 0.8) score += 1.5;
    else if (tideHeight >= 1.0 || tideDirection === "Incoming") score += 1.0;
    else if (tideHeight >= 0.5) score += 0.5;
  }

  const total = Math.min(10, Math.round(score * 10) / 10);
  let label, emoji;
  if (total >= 9)      { label = "Firing";       emoji = "🔥"; }
  else if (total >= 7) { label = "Epic";         emoji = "🟢"; }
  else if (total >= 5) { label = "Worth It";     emoji = "👌"; }
  else if (total >= 3) { label = "Marginal";     emoji = "😐"; }
  else if (total >= 1) { label = "Don't Bother"; emoji = "👎"; }
  else                 { label = "Stay Home";    emoji = "🪨"; }

  return { score: total, label, emoji, display: `${emoji} ${label} (${total}/10)` };
}

// ─── Tide summary ─────────────────────────────────────────────────────────────
function buildTideSummary(tides, now) {
  if (!tides || !tides.length) return null;
  const nowSec = now.getTime() / 1000;

  // Only extremes (HIGH and LOW), not NORMAL interpolated points
  const extremes = tides.filter(t => t.type === "HIGH" || t.type === "LOW");
  const upcoming = extremes
    .filter(t => t.timestamp > nowSec)
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(0, 2);

  if (!upcoming.length) return null;

  const nextExtreme = upcoming[0];
  const direction = nextExtreme.type === "HIGH" ? "Incoming" : "Outgoing";

  const formatTime = (ts) => new Date(ts * 1000).toLocaleTimeString("en-AU", {
    timeZone: "Australia/Melbourne",
    hour: "2-digit", minute: "2-digit", hour12: true
  });

  let tideStr = `${direction}, ${nextExtreme.type === "HIGH" ? "High" : "Low"} ${r1(nextExtreme.height)}m at ${formatTime(nextExtreme.timestamp)}`;

  if (upcoming[1]) {
    const hoursDiff = (upcoming[1].timestamp - nowSec) / 3600;
    if (hoursDiff <= 12) {
      tideStr += `, then ${upcoming[1].type === "HIGH" ? "High" : "Low"} ${r1(upcoming[1].height)}m at ${formatTime(upcoming[1].timestamp)}`;
    }
  }

  return { text: tideStr, direction, height: r1(nextExtreme.height) };
}

// ─── 3-day forecast summary ───────────────────────────────────────────────────
function buildThreeDaySummary(waveArr, windArr, now) {
  if (!waveArr || !windArr) return "";
  const nowSec = now.getTime() / 1000;
  const lines = [];

  for (let d = 1; d <= 3; d++) {
    // Target 7am AEST for each day
    const target = new Date(now);
    target.setDate(target.getDate() + d);
    target.setHours(7, 0, 0, 0);
    const targetSec = target.getTime() / 1000;

    const waveH = waveArr.reduce((best, h) =>
      Math.abs(h.timestamp - targetSec) < Math.abs(best.timestamp - targetSec) ? h : best
    , waveArr[0]);

    const windH = windArr.reduce((best, h) =>
      Math.abs(h.timestamp - targetSec) < Math.abs(best.timestamp - targetSec) ? h : best
    , windArr[0]);

    const height = feetToMetres((waveH.surf?.min + waveH.surf?.max) / 2);
    const period = waveH.swells?.[0]?.period ?? null;
    const windKph = Math.round(windH.speed ?? 0);
    const windDir = degToCompass(windH.direction);

    const h = height ?? 0;
    const p = period ?? 0;
    let emoji;
    if (h >= 2.0 && p >= 12)      emoji = "🔥";
    else if (h >= 1.5 && p >= 10) emoji = "✅";
    else if (h >= 1.0 && p >= 8)  emoji = "👌";
    else if (h >= 0.5)             emoji = "😐";
    else                           emoji = "🪨";

    const dayLabel = target.toLocaleDateString("en-AU", {
      timeZone: "Australia/Melbourne",
      weekday: "short", day: "numeric", month: "short"
    });

    lines.push(`${emoji} ${dayLabel} — ${height ?? "—"}m @ ${period ?? "—"}s | Wind: ${windKph}km/h ${windDir}`);
  }
  return lines.join("\n");
}

// ─── Rip Curl AI Take ─────────────────────────────────────────────────────────
async function getRipCurlSummary(conditions) {
  const { waveH, waveP, swellDir, swell2H, swell2P, swell2Dir, windKph, gustKph, windDir, windDirType, waterT: waterTDisplay, airT, bellsScore, localTime, forecast, tide } = conditions;

  const secondaryLine = swell2H ? `- Secondary swell: ${swell2H}m @ ${swell2P}s | ${swell2Dir}` : "";

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
    "- When there are two swells, consider how they interact -- a solid SW groundswell with a small NNE wind swell on top is messy. Two swells from similar directions can stack nicely.",
    "- Water is 13-17C year round. Cold but not unusual. Locals know.",
    "",
    "CURRENT CONDITIONS:",
    `- Waves: ${waveH}m @ ${waveP}s | ${swellDir}`,
    `- Wind: ${windKph}km/h | ${windDir} (${windDirType}) (gusting ${gustKph}km/h)`,
    secondaryLine,
    `- Water temp: ${waterTDisplay ?? "not available"}C`,
    `- Air temp: ${airT}C`,
    `- Tide: ${tide?.text ?? "unknown"}`,
    `- Time: ${localTime}`,
    `- Bells rating: ${bellsScore.display}`,
    "",
    "3-DAY OUTLOOK (weave naturally into your take if relevant, one sentence max, no raw data):",
    forecast,
    "",
    "RULES - non-negotiable:",
    "1. Never mention wetsuits, steamers, or gear unless you are telling someone to paddle out right now. Telling someone to wait = no gear talk. Ever.",
    "2. Never use em dashes. Use commas or full stops instead.",
    "3. Always include units with numbers: km/h for wind, m for wave height, degrees C for temp. Never reference period as a raw number in prose.",
    "4. Never invent conditions. Stick to what the data shows.",
    "5. Reefs and points are the frame of reference, not beaches.",
    "6. Only reference tide if it meaningfully affects the session.",
    "7. If secondary swell is present and relevant, mention how the two swells interact.",
    "",
    "Return only the summary. No label, no preamble."
  ].filter(Boolean).join("\n");

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

async function postToDiscord(webhook, payload) {
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`Discord error: ${await res.text()}`);
}

// ─── Main handler ─────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
  if (!DISCORD_WEBHOOK) return res.status(500).json({ error: "Missing DISCORD_WEBHOOK_URL" });
  if (!process.env.SURFLINE_USERNAME || !process.env.SURFLINE_PASSWORD) {
    return res.status(500).json({ error: "Missing Surfline credentials" });
  }

  const now = new Date();

  // Fetch Surfline endpoints + Stormglass water temp in parallel
  const sgStart = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const sgEnd   = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
  const sgUrl   = `https://api.stormglass.io/v2/weather/point?lat=-38.3667&lng=144.2833&params=waterTemperature&start=${sgStart}&end=${sgEnd}`;

  const [waveData, windData, weatherData, tideData, sgData] = await Promise.all([
    fetchSurfline("/spots/forecasts/wave"),
    fetchSurfline("/spots/forecasts/wind"),
    fetchSurfline("/spots/forecasts/weather"),
    fetchSurfline("/spots/forecasts/tides"),
    process.env.STORMGLASS_API_KEY
      ? fetch(sgUrl, { headers: { Authorization: process.env.STORMGLASS_API_KEY } }).then(r => r.ok ? r.json() : null).catch(() => null)
      : Promise.resolve(null),
  ]);

  if (!waveData || !windData) {
    return res.status(502).json({ error: "Failed to fetch Surfline data" });
  }

  const waveArr    = waveData.data?.wave ?? [];
  const windArr    = windData.data?.wind ?? [];
  const weatherArr = weatherData?.data?.weather ?? [];
  const tidesArr   = tideData?.data?.tides ?? [];

  // Current conditions
  const wave    = closestToNow(waveArr, now);
  const wind    = closestToNow(windArr, now);
  const weather = closestToNow(weatherArr, now);

  if (!wave || !wind) return res.status(502).json({ error: "No current conditions data" });

  // Wave height -- Surfline returns feet, convert to metres
  const surfMinM = feetToMetres(wave.surf?.min ?? 0);
  const surfMaxM = feetToMetres(wave.surf?.max ?? 0);
  const waveH    = r1((surfMinM + surfMaxM) / 2);

  // Primary swell (highest optimalScore or first)
  const swells = wave.swells ?? [];
  const primary = swells.reduce((best, s) => (s.optimalScore > (best?.optimalScore ?? -1) ? s : best), swells[0] ?? null);
  const secondary = swells.find(s => s !== primary && s.height > 0) ?? null;

  const swellH   = primary ? feetToMetres(primary.height) : null;
  const swellP   = primary?.period ?? null;
  const swellDir = primary ? degToCompass(primary.direction) : "—";

  const swell2H   = secondary ? feetToMetres(secondary.height) : null;
  const swell2P   = secondary?.period ?? null;
  const swell2Dir = secondary ? degToCompass(secondary.direction) : null;

  // Wind -- already in km/h
  const windKph     = wind.speed != null ? Math.round(wind.speed) : null;
  const gustKph     = wind.gust != null ? Math.round(wind.gust) : null;
  const windDir     = degToCompass(wind.direction);
  const windDirType = wind.directionType ?? null;

  // Weather
  const airT = weather?.temperature != null ? r1(weather.temperature) : null;
  // Water temp from Stormglass
  const sgHours = sgData?.hours ?? [];
  const sgClosest = sgHours.length ? sgHours.reduce((best, h) =>
    Math.abs(new Date(h.time) - now) < Math.abs(new Date(best.time) - now) ? h : best
  , sgHours[0]) : null;
  const sgWaterT = sgClosest?.waterTemperature;
  const waterT = sgWaterT ? (sgWaterT.sg ?? sgWaterT.noaa ?? sgWaterT.meteo ?? Object.values(sgWaterT)[0] ?? null) : null;
  const waterTDisplay = waterT != null ? Math.round(waterT * 10) / 10 : null;

  // Tide
  const tideSummary = buildTideSummary(tidesArr, now);

  // Current tide height for Bells rating
  const currentTide = closestToNow(tidesArr.filter(t => t.type === "NORMAL" || t.type === "HIGH" || t.type === "LOW"), now);

  const bellsScore = bellsRating({
    swellDir,
    swellP,
    waveH,
    windDir,
    windKph,
    gustKph,
    windDirType,
    tideHeight: currentTide?.height ?? null,
    tideDirection: tideSummary?.direction ?? null
  });

  const localTime = now.toLocaleString("en-AU", {
    timeZone: "Australia/Melbourne",
    hour: "2-digit", minute: "2-digit",
    weekday: "short", day: "numeric", month: "short"
  });

  const forecastSummary = buildThreeDaySummary(waveArr, windArr, now);

  const ripCurlTake = await getRipCurlSummary({
    waveH, waveP: swellP, swellDir,
    swell2H, swell2P, swell2Dir,
    windKph, gustKph, windDir, windDirType,
    waterT: waterTDisplay, airT, bellsScore, localTime,
    forecast: forecastSummary,
    tide: tideSummary
  });

  const conditionsLines = [
    `🌊 **Waves** — ${waveH ?? "—"}m @ ${swellP ?? "—"}s | ${swellDir}`,
    swellH ? `🌀 **Swell** — ${swellH}m @ ${swellP ?? "—"}s | ${swellDir}` : null,
    swell2H ? `↳ **Secondary** — ${swell2H}m @ ${swell2P ?? "—"}s | ${swell2Dir}` : null,
    `💨 **Wind** — ${windKph ?? "—"}km/h | ${windDir}${windDirType ? ` (${windDirType})` : ""} (gusts ${gustKph ?? "—"}km/h)`,
    `🌡️ **Water** — ${waterTDisplay ?? "—"}°C`,
    `🌤️ **Air** — ${airT ?? "—"}°C`,
    tideSummary ? `🌊 **Tide** — ${tideSummary.text}` : null,
  ].filter(Boolean).join("\n");

  const fields = [];
  if (ripCurlTake) fields.push({ name: "The Rip Curl Take", value: ripCurlTake, inline: false });

  const embed = {
    title: `Bells Beach — ${bellsScore.display}`,
    color: 0x00b4d8,
    description: `Conditions at ${localTime} (AEST)\n\n${conditionsLines}`,
    fields,
    footer: { text: "Surfline • Bells Beach, VIC" },
    timestamp: new Date().toISOString()
  };

  try {
    await postToDiscord(DISCORD_WEBHOOK, { embeds: [embed] });
    await postToDiscord(DISCORD_WEBHOOK, {
      content: "**Worth the paddle?** React below 👇\n🤙 = Worth it   🤦 = Don't bother   📸 = Drop your shots"
    });
  } catch (e) {
    return res.status(502).json({ error: "Discord post failed", detail: e.message });
  }

  return res.status(200).json({ ok: true, bellsScore: bellsScore.display, dataTime: wave.timestamp });
};
