/** Публичный VAPID-ключ для подписки на push (только GET). */
module.exports = (req, res) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) {
    const missing = [];
    if (!process.env.VAPID_PUBLIC_KEY) missing.push("VAPID_PUBLIC_KEY");
    if (!process.env.VAPID_PRIVATE_KEY) missing.push("VAPID_PRIVATE_KEY");
    if (!process.env.VAPID_SUBJECT) missing.push("VAPID_SUBJECT");
    if (!process.env.PUSH_WEBHOOK_SECRET) missing.push("PUSH_WEBHOOK_SECRET");
    return res.status(503).json({
      message: "Push not configured",
      code: "not_configured",
      missing,
      hint: "Добавьте переменные в Vercel → Settings → Environment Variables → отметьте Production → Redeploy",
    });
  }

  res.setHeader("Cache-Control", "public, max-age=3600");
  return res.status(200).json({ publicKey });
};
