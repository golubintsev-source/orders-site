const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || "https://yizwpogwabosuguakyzt.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_e1pJB18UsEV-o_M43ROi9w_4mS--LrF";
const MAX_IMAGE_LENGTH = 2_800_000;
const { calculateImageCostRub, getUsdRubRate } = require("./image-cost.js");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  const token = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return res.status(401).json({ error: "unauthorized" });
  try {
    const auth = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (!auth.ok || !(await auth.json()).id) return res.status(401).json({ error: "unauthorized" });
  } catch (error) {
    console.error("Image edit auth failed:", error);
    return res.status(503).json({ error: "auth_unavailable" });
  }

  const { image, prompt } = req.body || {};
  if (typeof image !== "string" || image.length > MAX_IMAGE_LENGTH ||
      !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(image) ||
      typeof prompt !== "string" || !prompt.trim() || prompt.length > 4000) {
    return res.status(400).json({ error: "invalid_input" });
  }
  if (!OPENAI_API_KEY) return res.status(503).json({ error: "not_configured" });

  try {
    const model = process.env.OPENAI_IMAGE_EDIT_MODEL || "gpt-image-2.5-sunburst";
    const response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        images: [{ image_url: image }],
        prompt: `Отредактируй загруженное фото по запросу пользователя. Сохрани содержимое и композицию исходного фото там, где изменения не запрошены. Запрос пользователя: ${prompt.trim()}`,
        n: 1,
        quality: "high",
        output_format: "jpeg",
        output_compression: 85,
      }),
      signal: AbortSignal.timeout(105_000),
    });
    if (!response.ok) {
      console.error("OpenAI image edit:", response.status, (await response.text()).slice(0, 500));
      return res.status(502).json({ error: "generation_failed" });
    }
    const result = await response.json();
    const base64 = result?.data?.[0]?.b64_json;
    if (typeof base64 !== "string" || !base64) throw new Error("empty_image_response");
    let costRub = null;
    try {
      const rate = await getUsdRubRate();
      costRub = calculateImageCostRub(result.usage, rate, model);
    } catch (error) {
      console.warn("Image edit exchange rate unavailable:", error);
    }
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ image: `data:image/jpeg;base64,${base64}`, costRub });
  } catch (error) {
    console.error("Image edit failed:", error);
    return res.status(502).json({ error: "generation_failed" });
  }
};
