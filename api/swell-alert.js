// Swell Alert — runs every 3 hours via cron
// Only fires when conditions are about to improve significantly
// Designed to feel urgent and actionable -- not a report, a call to arms

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

async function getAlertTake(current, incoming, peakTime, changeType) {
  const prompt = [
    "You are the voice of Rip Curl at Bells Beach. Something is changing at the break and surfers nearby need to know RIGHT NOW.",
    "",
    "Write a swell alert of exactly 2-3 sentences. This is NOT a conditions report. It is an urgent, specific call to action.",
    "",
    "STRUCTURE -- follow this exactly:",
    "Sentence 1: What just changed or is about to change, and why it matters at Bells specifically.",
    "Sentence 2: What a surfer near Bells should do right now -- paddle out, leave work, check it at lunch, wait for X time.",
    "Sentence 3 (optional): One specific detail about which part of the break will benefit most.",
    "",
    "VOICE:",
    "- Urgent but not panicked. Like a mate who just checked the cams and is calling you.",
    "- Specific to Bells Bowl, Rincon, or Winki -- whichever benefits most from the incoming change.",
    "- Direct. Every word earns its place.",
    "- Never corporate, never vague, never generic.",
    "",
    "WHAT CHANGED:",
    `- Change type: ${changeType}`,
    `- Was: ${current.waveH}m @ ${current.waveP}s | ${current.surf}`,
    `- Becoming: ${incoming.waveH}m @ ${incoming.waveP}s | ${incoming.windKph}km/h ${incoming.windDir} | ${incoming.surf}`,
    `- Peak expected: ${peakTime}`,
    "",
    "RULES:",
    "1. Never use em dashes. Commas and full stops only.",
    "2. Always include units: km/h for wind, m for wave height.",
    "3. Never reference period as a raw number -- say long period, proper groundswell, short-period chop etc.",
    "4. No gear talk unless telling someone to paddle out right now.",
    "5. Never make up conditions.",
    "",
    "Return only the alert text. No label, no preamble, no sign-off."
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
        max_tokens: 150,
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

  // Current conditions
  const current = hours.reduce((best, h) =>
    Math.abs(new Date(h.time) - now) < Math.abs(new Date(best.time) - now) ? h : best
  , hours[0]);

  const currentWaveH = r1(pick(current.waveHeight)) ?? 0;
  const currentWaveP = pick(current.wavePeriod) != null ? Math.round(pick(current.wavePeriod)) : 0;
  const currentSurf  = ratingLabel(currentWaveH, currentWaveP);

  // Future hours -- 3 to 24hrs from now
  const futureHours = hours.filter(h => {
    const diffHrs = (new Date(h.time) - now) / (1000 * 60 * 60);
    return diffHrs >= 3 && diffHrs <= 24;
  });

  if (!futureHours.length) {
    return res.status(200).json({ ok: true, alert: false, reason: "No future hours" });
  }

  // Find the best upcoming hour
  const peakHour = futureHours.reduce((best, h) => {
    const bH = pick(best.waveHeight) ?? 0;
    const hH = pick(h.waveHeight) ?? 0;
    return hH > bH ? h : best;
  }, futureHours[0]);

  const peakWaveH   = r1(pick(peakHour.waveHeight)) ?? 0;
  const peakWaveP   = pick(peakHour.wavePeriod) != null ? Math.round(pick(peakHour.wavePeriod)) : 0;
  const peakWindSpd = pick(peakHour.windSpeed);
  const peakWindDir = degreesToCompass(pick(peakHour.windDirection));
  const peakWindKph = peakWindSpd != null ? Math.round(peakWindSpd * 3.6) : null;
  const peakSurf    = ratingLabel(peakWaveH, peakWaveP);

  // Determine what changed and whether it's worth alerting
  const heightGain     = currentWaveH > 0 ? (peakWaveH - currentWaveH) / currentWaveH : 1;
  const periodCrossing = peakWaveP >= 10 && currentWaveP < 10;
  const alreadyFiring  = currentWaveH >= 1.5 && currentWaveP >= 10;
  const worthAlerting  = !alreadyFiring && (heightGain >= 0.5 || periodCrossing);

  if (!worthAlerting) {
    return res.status(200).json({
      ok: true,
      alert: false,
      reason: `No significant change. Height +${Math.round(heightGain * 100)}%, period ${currentWaveP}s -> ${peakWaveP}s, already firing: ${alreadyFiring}`
    });
  }

  // Describe what changed
  let changeType = "";
  if (heightGain >= 0.5 && periodCrossing) {
    changeType = "Swell height jumping significantly AND period crossing into proper groundswell territory";
  } else if (periodCrossing) {
    changeType = "Period crossing from wind swell into proper groundswell -- the quality jump surfers actually care about";
  } else {
    changeType = `Swell height lifting ${Math.round(heightGain * 100)}% within the next 24 hours`;
  }

  // Format peak time
  const peakTime = new Date(peakHour.time).toLocaleString("en-AU", {
    timeZone: "Australia/Melbourne",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    weekday: "short",
    day: "numeric",
    month: "short"
  });

  const alertTake = await getAlertTake(
    { waveH: currentWaveH, waveP: currentWaveP, surf: currentSurf },
    { waveH: peakWaveH, waveP: peakWaveP, windKph: peakWindKph, windDir: peakWindDir, surf: peakSurf },
    peakTime,
    changeType
  );

  // Alert embed -- orange, distinct from the teal report, no conditions data dump
  const embed = {
    title: `🚨 Swell Alert — Bells Beach`,
    color: 0xff6b00,
    description: alertTake ?? `Conditions improving at Bells. ${currentWaveH}m now, ${peakWaveH}m @ ${peakWaveP}s expected by ${peakTime}.`,
    fields: [
      {
        name: "Right now",
        value: `${currentWaveH}m @ ${currentWaveP}s | ${currentSurf}`,
        inline: true
      },
      {
        name: "Incoming",
        value: `${peakWaveH}m @ ${peakWaveP}s | ${peakSurf}`,
        inline: true
      },
      {
        name: "Peaks",
        value: peakTime,
        inline: true
      }
    ],
    footer: { text: "Stormglass API • Bells Beach, VIC • Swell Alert" },
    timestamp: new Date().toISOString()
  };

  try {
    // Post the alert embed
    await fetch(DISCORD_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] })
    });

    // Follow-up action prompt -- different tone to the report's reaction prompt
    await fetch(DISCORD_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "**Are you going?** 🏄 = Heading out   👀 = Watching first   😭 = Can't make it"
      })
    });
  } catch (e) {
    return res.status(502).json({ error: "Discord post failed", detail: e.message });
  }

  return res.status(200).json({
    ok: true,
    alert: true,
    changeType,
    currentWaveH,
    currentWaveP,
    peakWaveH,
    peakWaveP,
    peakTime
  });
};
