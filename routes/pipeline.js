// routes/pipeline.js — House of Jreym Autonomous Listing Pipeline v1.0
import express from "express";
import { executeTask } from "../agents/executor.js";
import { logAgent, saveAgentOutput } from "../lib/supabase.js";

export const pipelineRouter = express.Router();

// POST /api/pipeline/run
// Runs the full 6-agent autonomous listing pipeline end-to-end
// Body: { category?: string, dry_run?: boolean }
pipelineRouter.post("/run", async (req, res) => {
    const { category = "home decor", dry_run = false } = req.body;
    const log = [];
    const step = (name, data) => {
          log.push({ step: name, ts: new Date().toISOString(), ...data });
          console.log("[PIPELINE]", name, JSON.stringify(data).slice(0, 120));
    };

                      try {
                            // ── AGENT 1: Trend Research (NANA) ──────────────────────────────────
      step("1_trend_research", { status: "running", category });
                            const trends = await executeTask({
                                    id: "pipe-1", agent: "NANA", task_type: "trend_research",
                                    payload: { category }
                            });
                            const topTrend = trends?.top_pick || trends?.trends?.[0]?.keyword || category;
                            step("1_trend_research", { status: "done", top_trend: topTrend });

      // ── AGENT 2: Product Idea (NANA) ─────────────────────────────────────
      step("2_product_idea", { status: "running", keyword: topTrend });
                            const idea = await executeTask({
                                    id: "pipe-2", agent: "NANA", task_type: "product_opportunity",
                                    payload: { trends: trends?.trends || [{ keyword: topTrend }] }
                            });
                            step("2_product_idea", { status: "done", niche: idea?.niche, price_range: idea?.recommended_price_range });

      // ── AGENT 3: Image Generation (AMARA — SVG via executor) ─────────────
      step("3_image_generation", { status: "running" });
                            const imageKeyword = { keyword: topTrend, tags: trends?.trends?.[0]?.tags || [] };
                            const fileResult = await executeTask({
                                    id: "pipe-3", agent: "AMARA", task_type: "generate_digital_file",
                                    payload: imageKeyword
                            });
                            step("3_image_generation", { status: "done", file_url: fileResult?.file_url, file_name: fileResult?.file_name });

      // ── AGENT 4: SEO Title + Tags (AISHA) ────────────────────────────────
      step("4_seo_title", { status: "running" });
                            const [titleResult, tagsResult] = await Promise.all([
                                    executeTask({
                                              id: "pipe-4a", agent: "AISHA", task_type: "generate_etsy_title",
                                              payload: { keyword: topTrend }
                                    }),
                                    executeTask({
                                              id: "pipe-4b", agent: "AISHA", task_type: "generate_etsy_tags",
                                              payload: { keyword: topTrend }
                                    })
                                  ]);
                                                        const finalTitle = titleResult?.title || (topTrend + " SVG Digital Download");
                            const finalTags = tagsResult?.tags || [topTrend.split(" ")[0], "svg", "digital", "download", "printable", "art", "gift", "design", "wall", "decor", "bundle", "instant", "print"];
                            step("4_seo_title", { status: "done", title: finalTitle, tag_count: finalTags.length });

      // ── AGENT 5: Description (AMARA) ─────────────────────────────────────
      step("5_description", { status: "running" });
                                          const descResult = await executeTask({
                                                  id: "pipe-5", agent: "AMARA", task_type: "generate_etsy_description",
                                                  payload: { keyword: topTrend, title: finalTitle }
                                          });
                            const finalDesc = descResult?.description || idea?.design_brief || ("Instant digital download: " + finalTitle + ". Includes SVG, PNG, and PDF formats. Perfect for printing, crafts, and DIY projects.");
                            step("5_description", { status: "done", desc_length: finalDesc.length });

      // ── AGENT 6: Etsy Publish (AISHA) ────────────────────────────────────
      if (dry_run) {
              step("6_publish", { status: "skipped", reason: "dry_run=true" });
              return res.json({
                        success: true, dry_run: true,
                        pipeline_log: log,
                        product: { title: finalTitle, tags: finalTags, description: finalDesc, file_url: fileResult?.file_url, price: idea?.recommended_price_range || "$4.99" }
              });
      }

      step("6_publish", { status: "running" });
                            const publishResult = await executeTask({
                                    id: "pipe-6", agent: "AISHA", task_type: "publish_etsy_listing",
                                    payload: {
                                              title: finalTitle,
                                              description: finalDesc,
                                              tags: finalTags,
                                              price: 4.99,
                                              file_url: fileResult?.file_url,
                                      file_name: fileResult?.file_name
                                    }
                            });
                            step("6_publish", { status: "done", listing_id: publishResult?.listing_id, url: publishResult?.url });

      await saveAgentOutput({
              agent: "PIPELINE",
              output_type: "autonomous_listing",
              etsy_title: finalTitle,
              etsy_description: finalDesc,
              etsy_tags: finalTags,
              confidence: 0.95,
              metadata: { listing_id: publishResult?.listing_id, url: publishResult?.url, trend: topTrend, category }
      }).catch(() => {});

      return res.json({
              success: true,
              listing_id: publishResult?.listing_id,
              listing_url: publishResult?.url,
              file_attached: publishResult?.file_attached,
              pipeline_log: log,
              product: { title: finalTitle, tags: finalTags, price: 4.99, trend: topTrend, category }
                                   });

                      } catch (err) {
                            step("error", { message: err.message });
                            await logAgent("PIPELINE", "Pipeline failed: " + err.message, "error").catch(() => {});
                            return res.status(500).json({ success: false, error: err.message, pipeline_log: log });
                      }
});

// GET /api/pipeline/status — health check
pipelineRouter.get("/status", (_req, res) => {
    res.json({ status: "ready", agents: ["NANA","AMARA","AISHA"], pipeline_version: "1.0", endpoints: { run: "POST /api/pipeline/run", status: "GET /api/pipeline/status" } });
});
