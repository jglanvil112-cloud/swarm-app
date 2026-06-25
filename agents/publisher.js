// agents/publisher.js — SWARM OS
// KWAME — the gate. Activates ONLY publish_queue rows a human flipped to 'approved'.
// Claims each row (approved->publishing) so two workers can't double-publish, then
// flips the Etsy listing to active with when_made re-asserted as 2020_2026.

import { supabase, saveAgentOutput, logAgent } from "../lib/supabase.js";
import { activateListing } from "../lib/etsyDraft.js";

export async function drainPublishQueue(batch = 5) {
  let due;
  try {
    const { data, error } = await supabase.from("publish_queue")
      .select("*").eq("status", "approved").limit(batch);
    if (error) { if (/relation .* does not exist/i.test(error.message)) return { processed: 0, note: "publish_queue table missing — run migration" }; throw error; }
    due = data || [];
  } catch (e) { console.error("[publisher] queue read:", e.message); return { processed: 0, error: e.message }; }

  let processed = 0;
  for (const row of due) {
    // Atomic claim.
    const { data: claimed } = await supabase.from("publish_queue")
      .update({ status: "publishing" }).eq("id", row.id).eq("status", "approved").select().single();
    if (!claimed) continue;

    try {
      await activateListing(row.listing_id);
      await supabase.from("publish_queue").update({ status: "published" }).eq("id", row.id);
      await saveAgentOutput("KWAME", "publish", { listing_id: row.listing_id, queue_id: row.id, state: "active" });
      await logAgent("KWAME", `Published listing #${row.listing_id} (queue #${row.id})`, "success");
      processed++;
    } catch (e) {
      await supabase.from("publish_queue").update({ status: "failed", error: e.message }).eq("id", row.id);
      await logAgent("KWAME", `Publish failed for #${row.listing_id}: ${e.message}`, "error");
    }
  }
  return { processed, candidates: due.length };
}
