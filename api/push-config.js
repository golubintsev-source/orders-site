/** Публичный VAPID-ключ для подписки на push (только GET). */
module.exports = (req, res) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) {
    return res.status(503).json({ message: "Push not configured", code: "not_configured" });
  }

  res.setHeader("Cache-Control", "public, max-age=3600");
  return res.status(200).json({ publicKey });
};
