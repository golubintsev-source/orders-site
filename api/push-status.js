/** Диагностика: какие env-переменные для push заданы (без значений). Только GET. */
module.exports = (req, res) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  const vars = {
    SUPABASE_URL: Boolean(process.env.SUPABASE_URL),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    VAPID_PUBLIC_KEY: Boolean(process.env.VAPID_PUBLIC_KEY),
    VAPID_PRIVATE_KEY: Boolean(process.env.VAPID_PRIVATE_KEY),
    VAPID_SUBJECT: Boolean(process.env.VAPID_SUBJECT),
    PUSH_WEBHOOK_SECRET: Boolean(process.env.PUSH_WEBHOOK_SECRET),
  };

  const missing = Object.entries(vars)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);

  const sendTaskPushReady =
    vars.SUPABASE_URL &&
    vars.SUPABASE_SERVICE_ROLE_KEY &&
    vars.VAPID_PUBLIC_KEY &&
    vars.VAPID_PRIVATE_KEY &&
    vars.PUSH_WEBHOOK_SECRET;

  return res.status(200).json({
    sendTaskPushReady,
    missing,
    vars,
  });
};
