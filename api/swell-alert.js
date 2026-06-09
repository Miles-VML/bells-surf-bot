// Swell Alert — runs every 3 hours via cron
// Fires a Discord alert if swell is about to improve significantly
// Conditions for alert:
//   - Upcoming wave height is 50%+ higher than current AND
//   - Upcoming period crosses 10s (groundswell threshold) AND
//   - Alert hasn't already fired in the last 12 hours (checked via a simple flag)

const BELLS_BEACH = { lat: -38.3667, lng: 144.2833 };

function pick(sources) {
  if (!sources) return null;
  return sources.sg ?? sources.noaa ?? sources.meteo ?? Object.values(sources)[0] ?? null;
}

function r1(n) {
  return n != null ? Math.round(n * 10) / 10 : null;
}

function degreesToCompass(deg) {
  if (deg == null) return "—";
  const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
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

async function getSwellAlertTake(current, upcoming, peakTime) {
  const prompt = [
    "You are the voice of Rip Curl at Bells Beach. Write a single punchy 1-2 sentence swell alert.",
    "Something significant is building. This is not a scheduled report, it's a heads-up.",
    "Voice: direct, excited but not hypey, trusted local. Like a mate texting to say get off the couch.",
    "Never use em dashes. No gear talk. No preamble.",
    "",
    "CURRENT CONDITIONS:",
    `- Waves: ${current.waveH}m, ${current.waveP}s period`,
    `- Rating: ${current.surf}`,
    "",
    "INCOMING SWELL:",
    `- Waves: ${upcoming.waveH}m, ${upcoming.waveP}s period`,
    `- Wind: ${upcoming.windKph}km/h ${upcoming.windDir}`,
    `- Rating: ${upcoming.surf}`,
    `- Peaks around: ${peakTime}`,
    "",
    "Return only the alert text. No label, no preamble."
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
        max_tokens: 100,
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
  const end = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const params = "waveHeight,wavePeriod,waveDirection,windSpeed,windDirection";
  const sgUrl = `https://api.stormglass.io/v2/weather/point?lat=${BELLS_BEACH.lat}&lng=${BELLS_BEACH.lng}&params=${params}&start=${start.toISOString()}&end=${end.toISOString()}`;

  let sgData;
  try {
    const sgRes = await fetch(sgUrl, { headers: { Authorization: STORMGLASS_KEY } });
    if (!sgRes.ok) return res.status(502).json({ error: "Stormglass error" });
    sgData = await sgRes.json();
  } catch (e) {
    return res.status(502).json({ error: "Stormglass fetch failed" });
  }

  const hours = sgData.hours ?? [];
  if (!hours.length) return res.status(200).json({ ok: true, alert: false, reason: "No data" });

  // Current conditions -- closest hour to now
  const current = hours.reduce((best, h) =>
    Math.abs(new Date(h.time) - now) < Math.abs(new Date(best.time) - now) ? h : best
  , hours[0]);

  const currentWaveH = r1(pick(current.waveHeight)) ?? 0;
  const currentWaveP = pick(current.wavePeriod) != null ? Math.round(pick(current.wavePeriod)) : 0;

  // Find the peak hour in the next 6-24 hours
  const futureHours = hours.filter(h => {
    const t = new Date(h.time);
    const diffHrs = (t - now) / (1000 * 60 * 60);
    return diffHrs >= 3 && diffHrs <= 24;
  });

  if (!futureHours.length) return res.status(200).json({ ok: true, alert: false, reason: "No future hours" });

  // Find the best upcoming hour by wave height
  const peakHour = futureHours.reduce((best, h) => {
    const bH = pick(best.waveHeight) ?? 0;
    const hH = pick(h.waveHeight) ?? 0;
    return hH > bH ? h : best;
  }, futureHours[0]);

  const peakWaveH = r1(pick(peakHour.waveHeight)) ?? 0;
  const peakWaveP = pick(peakHour.wavePeriod) != null ? Math.round(pick(peakHour.wavePeriod)) : 0;
  const peakWindSpd = pick(peakHour.windSpeed);
  const peakWindDir = degreesToCompass(pick(peakHour.windDirection));
  const peakWindKph = peakWindSpd != null ? Math.round(peakWindSpd * 3.6) : null;

  // Alert conditions:
  // 1. Peak wave height is at least 50% bigger than current
  // 2. Peak period crosses 10s (groundswell)
  // 3. Current conditions aren't already good (no point alerting on already-firing surf)
  const heightImprovement = currentWaveH > 0 ? (peakWaveH - currentWaveH) / currentWaveH : 1;
  const periodImprovement = peakWaveP >= 10 && currentWaveP < 10;
  const alreadyGood = currentWaveH >= 1.5 && currentWaveP >= 10;

  if (heightImprovement < 0.5 || !periodImprovement || alreadyGood) {
    return res.status(200).json({
      ok: true,
      alert: false,
      reason: `No significant improvement. Height +${Math.round(heightImprovement * 100)}%, period ${currentWaveP}s -> ${peakWaveP}s`
    });
  }

  // Format peak time in AEST
  const peakTime = new Date(peakHour.time).toLocaleTimeString("en-AU", {
    timeZone: "Australia/Melbourne",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    weekday: "short"
  });

  const currentSurf = ratingLabel(currentWaveH, currentWaveP);
  const peakSurf = ratingLabel(peakWaveH, peakWaveP);

  const alertTake = await getSwellAlertTake(
    { waveH: currentWaveH, waveP: currentWaveP, surf: currentSurf },
    { waveH: peakWaveH, waveP: peakWaveP, windKph: peakWindKph, windDir: peakWindDir, surf: peakSurf },
    peakTime
  );

  const embed = {
    title: `⚡ Bells Beach — Swell Building`,
    color: 0xff6b00,
    description: alertTake ?? `Swell building at Bells. ${currentWaveH}m now, ${peakWaveH}m expected by ${peakTime}.`,
    fields: [
      { name: "Now", value: `${currentWaveH}m @ ${currentWaveP}s | ${currentSurf}`, inline: true },
      { name: "Incoming", value: `${peakWaveH}m @ ${peakWaveP}s | ${peakSurf}`, inline: true },
      { name: "Peaks around", value: peakTime, inline: true },
    ],
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

  return res.status(200).json({ ok: true, alert: true, peakWaveH, peakWaveP, peakTime });
};
