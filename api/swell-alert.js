// Swell Alert — runs every 3 hours via cron
// Only fires when conditions are about to improve significantly WITHIN THE NEXT 6 HOURS
// Designed to feel urgent and actionable -- not a report, a call to arms
// Data source: Surfline Platform API (matches surf-report.js)

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

function ratingLabel(waveHeight, wavePeriod) {
  const h = waveHeight ?? 0;
  const p = wavePeriod ?? 0;
  if (h >= 2.0 && p >= 12) return "🔥 Firing";
  if (h >= 1.5 && p >= 10) return "✅ Good";
  if (h >= 1.0 && p >= 8)  return "👌 Decent";
  if (h >= 0.5)             return "😐 Small";
  return "🪨 Flat";
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
    return await res.json();
  } catch (e) {
    return null;
  }
}

// Pull a clean conditions snapshot from a Surfline wave entry + matching wind entry
function waveSnapshot(waveEntry) {
  if (!waveEntry) return null;
  const surfMinM = feetToMetres(waveEntry.surf?.min ?? 0);
  const surfMaxM = feetToMetres(waveEntry.surf?.max ?? 0);
  const waveH = r1((surfMinM + surfMaxM) / 2);

  // Primary swell = highest optimalScore, else first with height
  const swells = waveEntry.swells ?? [];
  const primary = swells.reduce(
    (best, s) => (s.optimalScore > (best?.optimalScore ?? -1) ? s : best),
    swells[0] ?? null
  );
  const waveP = primary?.period ?? 0;
  const swellDir = primary ? degToCompass(primary.direction) : "—";

  return { waveH: waveH ?? 0, waveP: Math.round(waveP), swellDir };
}

// Find array item closest to a target unix-seconds time
function closestTo(arr, targetSec) {
  if (!arr || !arr.length) return null;
  return arr.reduce((best, h) =>
    Math.abs(h.timestamp - targetSec) < Math.abs(best.timestamp - targetSec) ? h : best
  , arr[0]);
}

async function getAlertTake(current, incoming, peakTime, changeType) {
  const prompt = [
    "You are the voice of Rip Curl at Bells Beach. Something is changing at the break RIGHT NOW and surfers nearby need to know immediately.",
    "",
    "Write a swell alert of exactly 2-3 sentences. This is NOT a conditions report. It is an urgent, specific call to action for something happening within the next few hours.",
    "",
    "STRUCTURE -- follow this exactly:",
    "Sentence 1: What is changing right now or imminently, and why it matters at Bells specifically.",
    "Sentence 2: What a surfer near Bells should do right now -- paddle out, leave work, get there by a specific time.",
    "Sentence 3 (optional): One specific detail about which part of the break will benefit most.",
    "",
    "VOICE:",
    "- Urgent but not panicked. Like a mate who just checked the break and is calling you.",
    "- Specific to Bells Bowl, Rincon, or Winki -- whichever benefits most from the incoming change.",
    "- Direct. Every word earns its place.",
    "- Never corporate, never vague, never generic.",
    "",
    "WHAT CHANGED:",
    `- Change type: ${changeType}`,
    `- Was: ${current.waveH}m @ ${current.waveP}s | ${current.surf}`,
    `- Becoming: ${incoming.waveH}m @ ${incoming.waveP}s | ${incoming.windKph}km/h ${incoming.windDir} (${incoming.windDirType}) | ${incoming.surf}`,
    `- Peak expected: ${peakTime}`,
    "",
    "RULES:",
    "1. Never use em dashes. Commas and full stops only.",
    "2. Always include units: km/h for wind, m for wave height.",
    "3. Never reference period as a raw number -- say long period, proper groundswell, short-period chop etc.",
    "4. No gear talk unless telling someone to paddle out right now.",
    "5. Never make up conditions.",
    "6. This is imminent -- hours away, not days. Write accordingly.",
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
  const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
  if (!DISCORD_WEBHOOK) return res.status(500).json({ error: "Missing DISCORD_WEBHOOK_URL" });
  if (!process.env.SURFLINE_USERNAME || !process.env.SURFLINE_PASSWORD) {
    return res.status(500).json({ error: "Missing Surfline credentials" });
  }

  // Test mode -- ?test=true or ?preview=true returns the decision without posting
  let testMode = false;
  try {
    const parsedUrl = new URL(req.url, `https://${req.headers.host}`);
    testMode = parsedUrl.searchParams.get("preview") === "true" || parsedUrl.searchParams.get("test") === "true";
  } catch (e) {
    testMode = false;
  }

  const now = new Date();
  const nowSec = now.getTime() / 1000;

  // Fetch wave + wind from Surfline in parallel
  const [waveData, windData] = await Promise.all([
    fetchSurfline("/spots/forecasts/wave"),
    fetchSurfline("/spots/forecasts/wind"),
  ]);

  if (!waveData || !windData) {
    return res.status(502).json({ error: "Failed to fetch Surfline data" });
  }

  const waveArr = waveData.data?.wave ?? [];
  const windArr = windData.data?.wind ?? [];
  if (!waveArr.length) return res.status(200).json({ ok: true, alert: false, reason: "No wave data" });

  // Current conditions
  const currentWave = closestTo(waveArr, nowSec);
  const currentSnap = waveSnapshot(currentWave);
  const currentWaveH = currentSnap.waveH;
  const currentWaveP = currentSnap.waveP;
  const currentSurf  = ratingLabel(currentWaveH, currentWaveP);

  // Only look 1-6 hours ahead -- if it's not happening today, it's not an alert
  const futureWave = waveArr.filter(h => {
    const diffHrs = (h.timestamp - nowSec) / 3600;
    return diffHrs >= 1 && diffHrs <= 6;
  });

  if (!futureWave.length) {
    return res.status(200).json({ ok: true, alert: false, reason: "No future hours in window" });
  }

  // Find the biggest upcoming hour by averaged surf height
  const peakWave = futureWave.reduce((best, h) => {
    const bSnap = waveSnapshot(best);
    const hSnap = waveSnapshot(h);
    return hSnap.waveH > bSnap.waveH ? h : best;
  }, futureWave[0]);

  const peakSnap = waveSnapshot(peakWave);
  const peakWaveH = peakSnap.waveH;
  const peakWaveP = peakSnap.waveP;
  const peakSurf  = ratingLabel(peakWaveH, peakWaveP);

  // Matching wind at the peak time
  const peakWind = closestTo(windArr, peakWave.timestamp);
  const peakWindKph = peakWind?.speed != null ? Math.round(peakWind.speed) : null;
  const peakWindDir = peakWind ? degToCompass(peakWind.direction) : "—";
  const peakWindDirType = peakWind?.directionType ?? "";

  // Alert only fires when BOTH conditions are true:
  // 1. Height jumping 75%+ within 6 hours
  // 2. Period crossing into proper groundswell (10s+)
  const heightGain     = currentWaveH > 0 ? (peakWaveH - currentWaveH) / currentWaveH : 1;
  const periodCrossing = peakWaveP >= 10 && currentWaveP < 10;
  const alreadyFiring  = currentWaveH >= 1.5 && currentWaveP >= 10;
  const worthAlerting  = !alreadyFiring && (heightGain >= 0.75 && periodCrossing);

  if (!worthAlerting) {
    return res.status(200).json({
      ok: true,
      alert: false,
      reason: `No significant imminent change. Height +${Math.round(heightGain * 100)}%, period ${currentWaveP}s -> ${peakWaveP}s, already firing: ${alreadyFiring}`
    });
  }

  const changeType = "Swell height jumping significantly AND period crossing into proper groundswell within the next few hours";

  const peakTime = new Date(peakWave.timestamp * 1000).toLocaleString("en-AU", {
    timeZone: "Australia/Melbourne",
    hour: "2-digit", minute: "2-digit", hour12: true,
    weekday: "short", day: "numeric", month: "short"
  });

  const alertTake = await getAlertTake(
    { waveH: currentWaveH, waveP: currentWaveP, surf: currentSurf },
    { waveH: peakWaveH, waveP: peakWaveP, windKph: peakWindKph, windDir: peakWindDir, windDirType: peakWindDirType, surf: peakSurf },
    peakTime,
    changeType
  );

  const embed = {
    title: `🚨 Swell Alert — Bells Beach`,
    color: 0xff6b00,
    description: alertTake ?? `Conditions jumping at Bells within the next few hours. ${currentWaveH}m now, ${peakWaveH}m @ ${peakWaveP}s by ${peakTime}.`,
    fields: [
      { name: "Right now", value: `${currentWaveH}m @ ${currentWaveP}s | ${currentSurf}`, inline: true },
      { name: "Incoming",  value: `${peakWaveH}m @ ${peakWaveP}s | ${peakSurf}`, inline: true },
      { name: "Peaks",     value: peakTime, inline: true }
    ],
    footer: { text: "Surfline • Bells Beach, VIC • Swell Alert" },
    timestamp: new Date().toISOString()
  };

  if (testMode) {
    return res.status(200).json({ testMode: true, alert: true, embed, alertTake });
  }

  try {
    await fetch(DISCORD_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] })
    });
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

  return res.status(200).json({ ok: true, alert: true, changeType, currentWaveH, currentWaveP, peakWaveH, peakWaveP, peakTime });
};
