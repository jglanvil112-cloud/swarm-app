// agents/publisher.js — KWAME human-approval publication gate
import { supabase, saveAgentOutput, logAgent, enqueueTask } from "../lib/supabase.js";
import { activateListing, listListingFiles } from "../lib/etsyDraft.js";

const allowFileless = () => process.env.ALLOW_PUBLISH_WITHOUT_FILE === "true";

export async function drainPublishQueue(batch = 5) {
  const limit = Math.max(1, Math.min(20, Number(batch) || 5));
  let due = [];

  try {
    const { data, error } = await supabase
      .from("publish_queue")
      .select("*")
      .eq("status", "approved")
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) {
      if (/relation .* does not exist/i.test(error.message)) {
        return { processed: 0, note: "publish_queue table missing — run migration" };
      }
      throw error;
    }
    due = data || [];
  } catch (error) {
    console.error("[publisher] queue read:", error.message);
    return { processed: 0, error: error.message };
  }

  let processed = 0;
  let blocked = 0;
  let failed = 0;

  for (const row of due) {
    const { data: claimed, error: claimError } = await supabase
      .from("publish_queue")
      .update({ status: "publishing" })
      .eq("id", row.id)
      .eq("status", "approved")
      .select()
      .single();
    if (claimError || !claimed) continue;

    try {
      const files = await listListingFiles(row.listing_id);
      if (!files.length && !allowFileless()) {
        await supabase
          .from("publish_queue")
          .update({
            status: "blocked_missing_file",
            error: "Approval blocked: digital listing has no attached file",
          })
          .eq("id", row.id);
        await logAgent(
          "KWAME",
          `Blocked listing #${row.listing_id}: no digital file attached`,
          "warn",
          { queue_id: row.id },
        );
        blocked++;
        continue;
      }

      await activateListing(row.listing_id);
      await supabase
        .from("publish_queue")
        .update({ status: "published", error: null })
        .eq("id", row.id);

      await saveAgentOutput("KWAME", "etsy_listing_published", {
        listing_id: row.listing_id,
        queue_id: row.id,
        state: "active",
        file_count: files.length,
        published_at: new Date().toISOString(),
      });
      await logAgent(
        "KWAME",
        `Published approved Etsy listing #${row.listing_id} (queue #${row.id})`,
        "success",
      );

      await enqueueTask({
        agent: "SEUN",
        task_type: "analytics_report",
        payload: { period: "last_hour", trigger: "etsy_listing_published", listing_id: row.listing_id },
        priority: 3,
      }).catch(() => {});
      await enqueueTask({
        agent: "KOFI",
        task_type: "inventory_check",
        payload: { trigger: "etsy_listing_published", listing_id: row.listing_id },
        priority: 4,
      }).catch(() => {});

      processed++;
    } catch (error) {
      await supabase
        .from("publish_queue")
        .update({ status: "failed", error: error.message })
        .eq("id", row.id);
      await logAgent(
        "KWAME",
        `Publish failed for #${row.listing_id}: ${error.message}`,
        "error",
      );
      failed++;
    }
  }

  return { processed, blocked, failed, candidates: due.length };
}
