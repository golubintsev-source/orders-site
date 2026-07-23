/**
 * Озвучка ответа ассистента через OpenAI TTS (женский голос).
 *
 * Env (Vercel):
 *   OPENAI_API_KEY  — тот же ключ, что у voice-assistant
 *   OPENAI_TTS_MODEL — опционально, по умолчанию gpt-4o-mini-tts
 *   OPENAI_TTS_VOICE — опционально: nova | shimmer | coral | sage | … (по умолчанию nova)
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_TTS_MODEL = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
const OPENAI_TTS_VOICE = process.env.OPENAI_TTS_VOICE || "nova";

const FEMALE_VOICES = new Set([
  "nova",
  "shimmer",
  "coral",
  "sage",
  "alloy",
  "verse",
  "marin",
  "ballad",
  "fable",
  "ash",
  "echo",
  "onyx",
  "cedar",
]);

function readJsonBody(req) {
  if (req.body != null && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return Promise.resolve(req.body);
  }
  if (typeof req.body === "string") {
    return Promise.resolve(JSON.parse(req.body || "{}"));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks);
        resolve(JSON.parse(raw.length ? raw.toString("utf8") : "{}"));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  if (!OPENAI_API_KEY) {
    return res.status(503).json({
      message: "TTS не настроен: добавьте OPENAI_API_KEY.",
      code: "not_configured",
    });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return res.status(400).json({ message: "Invalid JSON body" });
  }

  const text = String(body?.text || "").trim().slice(0, 2000);
  if (!text) {
    return res.status(400).json({ message: "Пустой текст" });
  }

  const requested = String(body?.voice || OPENAI_TTS_VOICE).trim().toLowerCase();
  const voice = FEMALE_VOICES.has(requested) ? requested : "nova";

  const payload = {
    model: OPENAI_TTS_MODEL,
    voice,
    input: text,
    response_format: "mp3",
  };

  // Инструкция тона — поддерживается gpt-4o-mini-tts
  if (String(OPENAI_TTS_MODEL).includes("gpt-4o-mini-tts")) {
    payload.instructions =
      "Speak in natural, clear Russian. Warm friendly young woman voice, calm and professional, not robotic.";
  }

  try {
    const upstream = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      let detail = errText.slice(0, 400);
      try {
        detail = JSON.parse(errText)?.error?.message || detail;
      } catch {
        /* keep */
      }
      return res.status(502).json({ message: `Ошибка TTS: ${detail || upstream.status}` });
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(buf);
  } catch (e) {
    console.error("voice-tts:", e);
    return res.status(500).json({ message: e?.message || "Ошибка озвучки" });
  }
};
