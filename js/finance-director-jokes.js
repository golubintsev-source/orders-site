import { supabaseClient } from "./config.js";

export async function checkFinanceDirectorJoke() {
  const { error } = await supabaseClient.rpc("check_finance_director_joke");
  if (error) console.warn("Не удалось проверить шутку финансового директора:", error);
}
