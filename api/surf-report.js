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

// ─── Bells-specific conditions rating ───────────────────────────────────────
// Scores Bells Beach on its own terms. Max 10 points.

function bellsRating({ swellDir, swellP, waveH, windDir, windKph, gustKph, tideHeight, tideDirection }) {
  let score = 0;

  // 1. Swell direction (0-2.5pts) -- SW groundswell is the money direction
  const swellDegrees = compassToDeg(swellDir);
  if (swellDegrees !== null) {
    if (isBetween(swellDegrees, 157, 202)) score += 2.5;      // S to SSW -- perfect
    else if (isBetween(swellDegrees, 202, 270)) score += 2.0; // SW to WSW -- good
    else if (isBetween(swellDegrees, 112, 157)) score += 1.0; // SE to SSE -- workable
    else score += 0;                                           // Everything else -- wrong direction
  }

  // 2. Swell period (0-2pts) -- groundswell vs wind swell is everything
  if (swellP != null) {
    if (swellP >= 14)      score += 2.0;
    else if (swellP >= 10) score += 1.5;
    else if (swellP >= 8)  score += 1.0;
    else                   score += 0;
  }

  // 3. Wave height (0-2pts) -- Bells has a sweet spot, closes out above 3.5m
  if (waveH != null) {
    if (waveH >= 1.5 && waveH <= 2.5)      score += 2.0; // ideal range
    else if (waveH >= 1.0 && waveH < 1.5)  score += 1.0; // small but workable
    else if (waveH > 2.5 && waveH <= 3.5)  score += 1.0; // solid but getting big
    else                                    score += 0;   // too small or closing out
  }

  // 4. Wind (0-2pts) -- N/NE offshore grooms it, onshore ruins it
  const windDegrees = compassToDeg(windDir);
  if (windDegrees !== null && windKph != null) {
    if (isBetween(windDegrees, 0, 67) && windKph <= 20)       score += 2.0; // offshore light
    else if (isBetween(windDegrees, 0, 67) && windKph <= 35)  score += 1.0; // offshore strong
    else if (isBetween(windDegrees, 67, 157))                  score += 0.5; // cross-shore
    else                                                        score += 0;   // onshore
  }

  // Gust penalty -- messy conditions regardless of average wind
  if (gustKph != null && windKph != null && (gustKph - windKph) >= 20) {
    score = Math.max(0, score - 0.5);
  }

  // 5. Tide (0-1.5pts) -- mid to high incoming is ideal, low tide exposes the reef
  if (tideHeight != null) {
    if (tideDirection === "Incoming" && tideHeight >= 0.8) score += 1.5;
    else if (tideHeight >= 1.0 || tideDirection === "Incoming") score += 1.0;
    else if (tideHeight >= 0.5) score += 0.5;
    else score += 0; // low tide -- reef showing
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

// Convert compass string to degrees for range checks
function compassToDeg(compass) {
  const map = {
    "N": 0, "NNE": 22, "NE": 45, "ENE": 67,
    "E": 90, "ESE": 112, "SE": 135, "SSE": 157,
    "S": 180, "SSW": 202, "SW": 225, "WSW": 247,
    "W": 270, "WNW": 292, "NW": 315, "NNW": 337
  };
  return map[compass] ?? null;
}

// Check if degrees falls in a range (handles wrap-around for N)
function isBetween(deg, min, max) {
  if (min <= max) return deg >= min && deg <= max;
  return deg >= min || deg <= max;
}

// ─── Legacy rating (used for 3-day forecast emojis only) ────────────────────
function rating(waveHeight, wavePeriod) {
  const h = waveHeight ?? 0;
  const p = wavePeriod ?? 0;
  if (h >= 2.0 && p >= 12) return "🔥";
  if (h >= 1.5 && p >= 10) return "✅";
  if (h >= 1.0 && p >= 8)  return "👌";
  if (h >= 0.5)             return "😐";
  return "🪨";
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
  const url = `https://www.worldtides.info/api/v3?extremes&lat=${BELLS_BEACH.lat}&lon=${BELLS_BEACH.lng}&datum=LAT&days=2&timezone=Australia/Melbourne&key=${key}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data.extremes ?? null;
  } catch (e) {
    return null;
  }
}

function buildTideSummary(extremes, now) {
  if (!extremes || !extremes.length) return null;
  const getTime = (e) => e.dt ? new Date(e.dt * 1000) : new Date(e.date);
  const getType = (e) => e.type === "High" ? "High" : "Low";
  const upcoming = extremes
    .filter(e => getTime(e) > now)
    .sort((a, b) => getTime(a) - getTime(b))
    .slice(0, 2);
  if (!upcoming.length) return null;
  const nextExtreme = upcoming[0];
  const direction = getType(nextExtreme) === "High" ? "Incoming" : "Outgoing";
  const formatTime = (e) => getTime(e).toLocaleTimeString("en-AU", {
    timeZone: "Australia/Melbourne",
    hour: "2-digit", minute: "2-digit", hour12: true
  });
  let tideStr = `${direction}, ${getType(nextExtreme)} ${r1(nextExtreme.height)}m at ${formatTime(nextExtreme)}`;
  if (upcoming[1]) {
    const hoursDiff = (getTime(upcoming[1]) - now) / (1000 * 60 * 60);
    if (hoursDiff <= 12) {
      tideStr += `, then ${getType(upcoming[1])} ${r1(upcoming[1].height)}m at ${formatTime(upcoming[1])}`;
    }
  }
  return { text: tideStr, direction, height: r1(upcoming[0].height) };
}

async function getRipCurlSummary(conditions) {
  const { waveH, waveP, waveDir, swellH, swellP, swellDir, swell2H, swell2P, swell2Dir, windKph, gustKph, windDir, waterT, airT, bellsScore, localTime, forecast, tide } = conditions;

  const secondarySwellLine = swell2H
    ? `- Secondary swell: ${swell2H}m @ ${swell2P}s | ${swell2Dir}`
    : "";

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
    `- Waves: ${waveH}m @ ${waveP}s | ${waveDir}`,
    `- Primary swell: ${swellH}m @ ${swellP}s | ${swellDir}`,
    secondarySwellLine,
    `- Wind: ${windKph}km/h | ${windDir} (gusting ${gustKph}km/h)`,
    `- Water temp: ${waterT}C`,
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
    "3. Always include units with numbers: km/h for wind, m for wave height, degrees C for temp. Never reference period as a raw number in prose - say good period, long period, short-period chop etc.",
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
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Discord error: ${err}`);
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

  const params = "waveHeight,wavePeriod,waveDirection,swellHeight,swellPeriod,swellDirection,secondarySwellHeight,secondarySwellPeriod,secondarySwellDirection,windSpeed,windDirection,gust,waterTemperature,airTemperature";
  const sgUrl = `https://api.stormglass.io/v2/weather/point?lat=${BELLS_BEACH.lat}&lng=${BELLS_BEACH.lng}&params=${params}&start=${start.toISOString()}&end=${end.toISOString()}`;

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
  const swell2H  = r1(pick(closest.secondarySwellHeight));
  const swell2P  = pick(closest.secondarySwellPeriod) != null ? Math.round(pick(closest.secondarySwellPeriod)) : null;
  const swell2Dir = degreesToCompass(pick(closest.secondarySwellDirection));
  const windSpd  = pick(closest.windSpeed);
  const windDir  = degreesToCompass(pick(closest.windDirection));
  const gustSpd  = pick(closest.gust);
  const waterT   = r1(pick(closest.waterTemperature));
  const airT     = r1(pick(closest.airTemperature));
  const windKph  = windSpd != null ? Math.round(windSpd * 3.6) : null;
  const gustKph  = gustSpd != null ? Math.round(gustSpd * 3.6) : null;

  const localTime = new Date(now).toLocaleString("en-AU", {
    timeZone: "Australia/Melbourne",
    hour: "2-digit", minute: "2-digit",
    weekday: "short", day: "numeric", month: "short"
  });

  const forecastSummary = buildThreeDaySummary(hours, now);
  const tideData = buildTideSummary(tideExtremes, now);

  // Calculate Bells-specific rating
  const bellsScore = bellsRating({
    swellDir,
    swellP,
    waveH,
    windDir,
    windKph,
    gustKph,
    tideHeight: tideData?.height ?? null,
    tideDirection: tideData?.direction ?? null
  });

  const ripCurlTake = await getRipCurlSummary({
    waveH, waveP, waveDir, swellH, swellP, swellDir,
    swell2H, swell2P, swell2Dir,
    windKph, gustKph, windDir, waterT, airT,
    bellsScore, localTime,
    forecast: forecastSummary,
    tide: tideData
  });

  const conditionsLines = [
    `🌊 **Waves** — ${waveH ?? "—"}m @ ${waveP ?? "—"}s | ${waveDir}`,
    `🌀 **Swell** — ${swellH ?? "—"}m @ ${swellP ?? "—"}s | ${swellDir}`,
    swell2H ? `↳ **Secondary** — ${swell2H}m @ ${swell2P ?? "—"}s | ${swell2Dir}` : null,
    `💨 **Wind** — ${windKph ?? "—"}km/h | ${windDir} (gusts ${gustKph ?? "—"}km/h)`,
    `🌡️ **Water** — ${waterT ?? "—"}°C`,
    `🌤️ **Air** — ${airT ?? "—"}°C`,
    tideData ? `🌊 **Tide** — ${tideData.text}` : null,
  ].filter(Boolean).join("\n");

  const fields = [];
  if (ripCurlTake) fields.push({ name: "The Rip Curl Take", value: ripCurlTake, inline: false });

  const embed = {
    title: `Bells Beach — ${bellsScore.display}`,
    color: 0x00b4d8,
    description: `Conditions at ${localTime} (AEST)\n\n${conditionsLines}`,
    fields,
    footer: { text: "Stormglass API • WorldTides • Bells Beach, VIC" },
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

  return res.status(200).json({ ok: true, bellsScore: bellsScore.display, dataTime: closest.time });
};
