// routes/social.js — SWARM OS IBRAHIM Agent v1.0
// Phase 1: DRAFT-ONLY. No auto-posting. All posts require explicit approval.
// Platforms: Instagram Business, Facebook Page, TikTok Business
import express from "express";
import { supabase, logAgent, enqueueTask, saveAgentOutput } from "../lib/supabase.js";
export const socialRouter = express.Router();

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";

// ─── helpers ──────────────────────────────────────────────────────────────────

async function ai(prompt, system = "You are IBRAHIM, House of Jreym's social media AI agent. Be concise and creative.") {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1000, system, messages: [{ role: "user", content: prompt }] })
  });
  const d = await r.json();
  return d.content?.[0]?.text || "";
}

async function getCredential(platform) {
  const { data } = await supabase.from("social_credentials").select("*").eq("platform", platform).single();
  return data;
}

async function callPlatformAPI(platform, endpoint, method = "GET", body = null) {
  const cred = await getCredential(platform);
  if (!cred?.access_token) throw new Error(`No ${platform} token — connect via /api/social/connect/${platform}`);

  let url, headers;
  if (platform === "instagram" || platform === "facebook") {
    const base = "https://graph.facebook.com/v19.0";
    url = `${base}${endpoint}`;
    headers = { "Authorization": `Bearer ${cred.access_token}`, "Content-Type": "application/json" };
  } else if (platform === "tiktok") {
    url = `https://open.tiktokapis.com/v2${endpoint}`;
    headers = { "Authorization": `Bearer ${cred.access_token}`, "Content-Type": "application/json" };
  }

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  return { ok: r.ok, status: r.status, data: await r.json() };
}

// ─── CREDENTIAL MANAGEMENT ────────────────────────────────────────────────────

// GET /api/social/status — show all platform connection status
socialRouter.get("/status", async (req, res) => {
  try {
    const { data: creds } = await supabase.from("social_credentials").select("platform,connected,username,token_expires_at,updated_at");
    const platforms = ["instagram", "facebook", "tiktok"];
    const status = platforms.map(p => {
      const c = creds?.find(x => x.platform === p);
      return {
        platform: p,
        connected: c?.connected || false,
        username: c?.username || null,
        token_expires_at: c?.token_expires_at || null,
        last_updated: c?.updated_at || null
      };
    });
    res.json({ status, phase: "1-draft-only", auto_posting: false });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/social/credentials — store platform tokens securely
socialRouter.post("/credentials", async (req, res) => {
  const { platform, access_token, refresh_token, page_id, account_id, username, scopes, token_expires_at } = req.body;
  if (!platform || !access_token) return res.status(400).json({ error: "platform and access_token required" });
  const allowed = ["instagram", "facebook", "tiktok"];
  if (!allowed.includes(platform)) return res.status(400).json({ error: `platform must be one of: ${allowed.join(", ")}` });

  try {
    const { data, error } = await supabase.from("social_credentials").upsert({
      platform, access_token, refresh_token: refresh_token || null,
      page_id: page_id || null, account_id: account_id || null,
      username: username || null, connected: true,
      scopes: scopes || [], token_expires_at: token_expires_at || null,
      updated_at: new Date().toISOString()
    }, { onConflict: "platform" }).select().single();

    if (error) throw new Error(error.message);
    await logAgent("IBRAHIM", `Credentials stored for ${platform} (@${username || "unknown"})`, "info");
    res.json({ ok: true, platform, username: data.username, message: "Credentials saved. Phase 1: draft-only mode active." });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/social/credentials/:platform — revoke
socialRouter.delete("/credentials/:platform", async (req, res) => {
  try {
    await supabase.from("social_credentials").update({ connected: false, access_token: null, refresh_token: null, updated_at: new Date().toISOString() }).eq("platform", req.params.platform);
    await logAgent("IBRAHIM", `Credentials revoked for ${req.params.platform}`, "warn");
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── CONTENT DRAFTS ───────────────────────────────────────────────────────────

// POST /api/social/draft — agent or user creates a content draft
socialRouter.post("/draft", async (req, res) => {
  const { platform = "all", caption, hashtags = [], media_urls = [], media_type = "image",
    scheduled_for, etsy_listing_id, keyword, created_by = "IBRAHIM" } = req.body;

  if (!caption) return res.status(400).json({ error: "caption required" });

  try {
    const { data, error } = await supabase.from("social_posts").insert({
      platform, status: "draft", created_by, caption,
      hashtags: Array.isArray(hashtags) ? hashtags : hashtags.split(/\s+/).filter(Boolean),
      media_urls: Array.isArray(media_urls) ? media_urls : [media_urls].filter(Boolean),
      media_type, scheduled_for: scheduled_for || null,
      etsy_listing_id: etsy_listing_id || null, keyword: keyword || null,
      updated_at: new Date().toISOString()
    }).select().single();

    if (error) throw new Error(error.message);
    await logAgent("IBRAHIM", `Draft created: ${platform} — "${caption.slice(0, 60)}..."`, "info");
    res.json({ ok: true, post: data, note: "Phase 1: post saved as draft. Submit for approval to publish." });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/social/generate — IBRAHIM AI generates a content draft from a keyword/listing
socialRouter.post("/generate", async (req, res) => {
  const { keyword, platform = "all", etsy_listing_id, etsy_title, count = 1, style = "luxury_brooklyn" } = req.body;
  if (!keyword && !etsy_title) return res.status(400).json({ error: "keyword or etsy_title required" });

  const topic = etsy_title || keyword;
  try {
    const styleGuides = {
      luxury_brooklyn: "Brooklyn street luxury aesthetic. Neon blue/gold palette. 'Silent Pressure' energy. Direct, confident, aspirational. Mix culture + commerce.",
      minimal: "Clean, minimal, high-end. Let the product speak. Short captions.",
      hype: "High energy, emojis, urgency. Gen Z tone. Trending sounds reference."
    };
    const guide = styleGuides[style] || styleGuides.luxury_brooklyn;

    const system = `You are IBRAHIM, House of Jreym's social media agent. Style: ${guide}. Brand: House of Jreym — digital art prints. Etsy shop: HOUSEOFJREYM. Always include a call to action to shop.`;

    const posts = [];
    for (let i = 0; i < Math.min(count, 5); i++) {
      const rawText = await ai(
        `Generate a social media post about: "${topic}" for ${platform === "all" ? "Instagram + Facebook + TikTok" : platform}.
Return ONLY valid JSON: {"caption": "...", "hashtags": ["tag1","tag2",...], "platform_notes": "..."}
Caption: 2-4 sentences + CTA. Hashtags: 15-20 relevant tags. No markdown.`, system
      );
      let content;
      try { content = JSON.parse(rawText.replace(/```json|```/g, "").trim()); }
      catch { content = { caption: rawText.slice(0, 500), hashtags: ["houseofjreym", "digitalart", "instantdownload"] }; }

      const { data: postRow, error: postErr } = await supabase.from("social_posts").insert({
        platform, status: "draft", created_by: "IBRAHIM",
        caption: content.caption, hashtags: content.hashtags || [],
        media_type: "image", keyword: topic,
        etsy_listing_id: etsy_listing_id || null,
        meta: { platform_notes: content.platform_notes, style },
        updated_at: new Date().toISOString()
      }).select().single();

      if (postErr) { console.error("[IBRAHIM] social_posts insert error:", postErr.message, postErr.code, postErr.details); }
      else { posts.push(postRow); }
      await saveAgentOutput({ agent: "IBRAHIM", outputType: "social_draft", socialCaption: content.caption, data: content });
    }

    await logAgent("IBRAHIM", `Generated ${posts.length} draft(s) for "${topic}"`, "info");
    res.json({ ok: true, drafts: posts, count: posts.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/social/drafts — list all drafts
socialRouter.get("/drafts", async (req, res) => {
  try {
    const status = req.query.status || "draft";
    const limit = parseInt(req.query.limit) || 50;
    const { data, error } = await supabase.from("social_posts")
      .select("*").eq("status", status)
      .order("created_at", { ascending: false }).limit(limit);
    if (error) throw new Error(error.message);
    res.json({ posts: data || [], count: data?.length || 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/social/draft/:id — edit a draft
socialRouter.patch("/draft/:id", async (req, res) => {
  try {
    const allowed = ["caption", "hashtags", "media_urls", "media_type", "scheduled_for", "platform", "keyword"];
    const updates = {};
    for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase.from("social_posts").update(updates).eq("id", req.params.id).select().single();
    if (error) throw new Error(error.message);
    res.json({ ok: true, post: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/social/draft/:id — delete a draft
socialRouter.delete("/draft/:id", async (req, res) => {
  try {
    await supabase.from("social_posts").delete().eq("id", req.params.id).eq("status", "draft");
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── APPROVAL WORKFLOW ────────────────────────────────────────────────────────

// POST /api/social/submit/:id — submit draft for CEO approval
socialRouter.post("/submit/:id", async (req, res) => {
  try {
    const { data, error } = await supabase.from("social_posts")
      .update({ status: "pending_approval", updated_at: new Date().toISOString() })
      .eq("id", req.params.id).eq("status", "draft").select().single();
    if (error || !data) return res.status(404).json({ error: "Draft not found or already submitted" });
    await logAgent("IBRAHIM", `Post submitted for approval: ${req.params.id}`, "info");
    res.json({ ok: true, post: data, message: "Submitted for CEO approval. Will not post until approved." });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/social/approve/:id — CEO approves a post
socialRouter.post("/approve/:id", async (req, res) => {
  const { approved_by = "CEO", scheduled_for } = req.body;
  try {
    const updates = {
      status: "approved", approved_by, approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    if (scheduled_for) { updates.scheduled_for = scheduled_for; updates.status = "scheduled"; }

    const { data, error } = await supabase.from("social_posts")
      .update(updates).eq("id", req.params.id).in("status", ["pending_approval", "draft"]).select().single();
    if (error || !data) return res.status(404).json({ error: "Post not found" });
    await logAgent("IBRAHIM", `Post approved by ${approved_by}: ${req.params.id}`, "info");
    res.json({ ok: true, post: data, message: scheduled_for ? `Scheduled for ${scheduled_for}` : "Approved. Ready to publish manually." });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/social/reject/:id — CEO rejects a post
socialRouter.post("/reject/:id", async (req, res) => {
  const { reason = "No reason given", rejected_by = "CEO" } = req.body;
  try {
    const { data, error } = await supabase.from("social_posts")
      .update({ status: "rejected", rejection_reason: reason, updated_at: new Date().toISOString() })
      .eq("id", req.params.id).select().single();
    if (error || !data) return res.status(404).json({ error: "Post not found" });
    await logAgent("IBRAHIM", `Post rejected by ${rejected_by}: ${reason}`, "warn");
    res.json({ ok: true, post: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── MANUAL PUBLISH (approved posts only) ────────────────────────────────────

// POST /api/social/publish/:id — manually publish an approved post
// Phase 1: only works if status === 'approved'. No auto-publish.
socialRouter.post("/publish/:id", async (req, res) => {
  try {
    const { data: post, error: fetchErr } = await supabase.from("social_posts")
      .select("*").eq("id", req.params.id).single();
    if (fetchErr || !post) return res.status(404).json({ error: "Post not found" });
    if (post.status !== "approved") return res.status(403).json({
      error: `Cannot publish — status is '${post.status}'. Post must be approved first.`,
      approve_url: `/api/social/approve/${req.params.id}`
    });

    const platforms = post.platform === "all" ? ["instagram", "facebook", "tiktok"] : [post.platform];
    const results = [];

    for (const platform of platforms) {
      const cred = await getCredential(platform);
      if (!cred?.connected || !cred?.access_token) {
        results.push({ platform, ok: false, error: `Not connected — add credentials via /api/social/credentials` });
        continue;
      }

      try {
        let publishResult = { platform, ok: false, simulated: false };

        if (platform === "facebook" && cred.page_id) {
          const r = await callPlatformAPI("facebook", `/${cred.page_id}/feed`, "POST", {
            message: `${post.caption}\n\n${(post.hashtags || []).map(t => `#${t}`).join(" ")}`,
            access_token: cred.access_token
          });
          publishResult = { platform, ok: r.ok, post_id: r.data?.id, error: r.ok ? null : JSON.stringify(r.data).slice(0, 200) };

        } else if (platform === "instagram" && cred.page_id) {
          // Instagram requires media container + publish flow
          const caption = `${post.caption}\n\n${(post.hashtags || []).map(t => `#${t}`).join(" ")}`;
          if (post.media_urls?.length) {
            const containerR = await callPlatformAPI("instagram", `/${cred.page_id}/media`, "POST", {
              image_url: post.media_urls[0], caption, access_token: cred.access_token
            });
            if (containerR.ok && containerR.data?.id) {
              const pubR = await callPlatformAPI("instagram", `/${cred.page_id}/media_publish`, "POST", {
                creation_id: containerR.data.id, access_token: cred.access_token
              });
              publishResult = { platform, ok: pubR.ok, post_id: pubR.data?.id, error: pubR.ok ? null : JSON.stringify(pubR.data).slice(0, 200) };
            } else {
              publishResult = { platform, ok: false, error: `Container creation failed: ${JSON.stringify(containerR.data).slice(0, 200)}` };
            }
          } else {
            publishResult = { platform, ok: false, error: "Instagram requires media_urls to publish" };
          }

        } else if (platform === "tiktok") {
          // TikTok video upload — requires video URL
          publishResult = { platform, ok: false, error: "TikTok publish requires video upload — add media_urls with a video URL" };
        }

        results.push(publishResult);
      } catch (e) {
        results.push({ platform, ok: false, error: e.message });
      }
    }

    // Update post status
    const anyOk = results.some(r => r.ok);
    const successPlatforms = results.filter(r => r.ok).map(r => r.platform);
    if (anyOk) {
      const postId = results.find(r => r.post_id)?.post_id;
      await supabase.from("social_posts").update({
        status: "published", published_at: new Date().toISOString(),
        platform_post_id: postId || null, updated_at: new Date().toISOString(),
        meta: { ...post.meta, publish_results: results }
      }).eq("id", post.id);
      await logAgent("IBRAHIM", `Published post ${post.id} on ${successPlatforms.join(", ")}`, "success");
    }

    res.json({ ok: anyOk, post_id: post.id, platforms: results });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── ANALYTICS ────────────────────────────────────────────────────────────────

// POST /api/social/analytics/sync — pull metrics from platforms for published posts
socialRouter.post("/analytics/sync", async (req, res) => {
  try {
    const { data: posts } = await supabase.from("social_posts")
      .select("*").eq("status", "published").limit(50);

    const synced = [];
    for (const post of posts || []) {
      const platforms = post.platform === "all" ? ["instagram", "facebook", "tiktok"] : [post.platform];
      for (const platform of platforms) {
        const cred = await getCredential(platform);
        if (!cred?.connected || !post.platform_post_id) continue;

        try {
          let metrics = { views: 0, likes: 0, comments: 0, shares: 0, saves: 0, reach: 0, impressions: 0 };

          if (platform === "facebook" && post.platform_post_id) {
            const r = await callPlatformAPI("facebook",
              `/${post.platform_post_id}/insights?metric=post_impressions,post_reach,post_reactions_by_type_total,post_comments,post_shares&access_token=${cred.access_token}`);
            if (r.ok && r.data?.data) {
              for (const m of r.data.data) {
                if (m.name === "post_impressions") metrics.impressions = m.values?.[0]?.value || 0;
                if (m.name === "post_reach") metrics.reach = m.values?.[0]?.value || 0;
                if (m.name === "post_comments") metrics.comments = m.values?.[0]?.value || 0;
                if (m.name === "post_shares") metrics.shares = m.values?.[0]?.value || 0;
              }
            }
          } else if (platform === "instagram" && post.platform_post_id) {
            const r = await callPlatformAPI("instagram",
              `/${post.platform_post_id}/insights?metric=impressions,reach,likes,comments,shares,saves&access_token=${cred.access_token}`);
            if (r.ok && r.data?.data) {
              for (const m of r.data.data) {
                metrics[m.name] = m.values?.[0]?.value || m.value || 0;
              }
            }
          }

          const engagement = metrics.impressions > 0
            ? ((metrics.likes + metrics.comments + metrics.shares + metrics.saves) / metrics.impressions)
            : 0;

          await supabase.from("social_analytics").insert({
            post_id: post.id, platform, recorded_at: new Date().toISOString(),
            ...metrics, engagement_rate: engagement
          });
          synced.push({ post_id: post.id, platform, metrics });
        } catch (e) { console.error(`[IBRAHIM] analytics sync err ${platform}:`, e.message); }
      }
    }

    await logAgent("IBRAHIM", `Analytics synced: ${synced.length} post-platforms`, "info");
    res.json({ ok: true, synced: synced.length, data: synced });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/social/analytics/followers — snapshot follower counts
socialRouter.post("/analytics/followers", async (req, res) => {
  try {
    const results = [];
    for (const platform of ["instagram", "facebook", "tiktok"]) {
      const cred = await getCredential(platform);
      if (!cred?.connected) { results.push({ platform, skipped: true }); continue; }

      try {
        let followers = 0;
        if (platform === "facebook" && cred.page_id) {
          const r = await callPlatformAPI("facebook", `/${cred.page_id}?fields=fan_count&access_token=${cred.access_token}`);
          followers = r.data?.fan_count || 0;
        } else if (platform === "instagram" && cred.page_id) {
          const r = await callPlatformAPI("instagram", `/${cred.page_id}?fields=followers_count&access_token=${cred.access_token}`);
          followers = r.data?.followers_count || 0;
        } else if (platform === "tiktok") {
          const r = await callPlatformAPI("tiktok", `/user/info/?fields=follower_count`, "POST", { fields: ["follower_count"] });
          followers = r.data?.data?.user?.follower_count || 0;
        }

        await supabase.from("social_account_stats").insert({ platform, followers, recorded_at: new Date().toISOString() });
        results.push({ platform, followers });
      } catch (e) { results.push({ platform, error: e.message }); }
    }
    res.json({ ok: true, results });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/social/analytics — get aggregated analytics
socialRouter.get("/analytics", async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const since = new Date(Date.now() - days * 86400000).toISOString();

    const [posts, analytics, followers] = await Promise.all([
      supabase.from("social_posts").select("id,platform,status,caption,published_at,created_at").gte("created_at", since),
      supabase.from("social_analytics").select("*").gte("recorded_at", since).order("recorded_at", { ascending: false }),
      supabase.from("social_account_stats").select("*").order("recorded_at", { ascending: false }).limit(30)
    ]);

    const byPlatform = {};
    for (const a of analytics.data || []) {
      if (!byPlatform[a.platform]) byPlatform[a.platform] = { views: 0, likes: 0, comments: 0, shares: 0, saves: 0, reach: 0, impressions: 0, posts: 0 };
      byPlatform[a.platform].views += a.views || 0;
      byPlatform[a.platform].likes += a.likes || 0;
      byPlatform[a.platform].comments += a.comments || 0;
      byPlatform[a.platform].shares += a.shares || 0;
      byPlatform[a.platform].saves += a.saves || 0;
      byPlatform[a.platform].reach += a.reach || 0;
      byPlatform[a.platform].impressions += a.impressions || 0;
      byPlatform[a.platform].posts++;
    }

    const latestFollowers = {};
    for (const s of followers.data || []) {
      if (!latestFollowers[s.platform]) latestFollowers[s.platform] = s.followers;
    }

    res.json({
      period_days: days,
      totals: byPlatform,
      followers: latestFollowers,
      posts: {
        total: posts.data?.length || 0,
        by_status: posts.data?.reduce((acc, p) => { acc[p.status] = (acc[p.status] || 0) + 1; return acc; }, {}) || {}
      }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── CEO DAILY REPORT ─────────────────────────────────────────────────────────

// POST /api/social/report/generate — IBRAHIM generates CEO daily report
socialRouter.post("/report/generate", async (req, res) => {
  const today = new Date().toISOString().split("T")[0];
  try {
    // Gather all data for report
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    const [recentPosts, analytics, followers, drafts] = await Promise.all([
      supabase.from("social_posts").select("*").eq("status", "published").gte("published_at", yesterday),
      supabase.from("social_analytics").select("*").gte("recorded_at", yesterday),
      supabase.from("social_account_stats").select("*").order("recorded_at", { ascending: false }).limit(10),
      supabase.from("social_posts").select("id,status").in("status", ["draft", "pending_approval", "approved", "scheduled"])
    ]);

    const totals = { views: 0, likes: 0, comments: 0, shares: 0, saves: 0, reach: 0, impressions: 0 };
    for (const a of analytics.data || []) {
      totals.views += a.views || 0; totals.likes += a.likes || 0;
      totals.comments += a.comments || 0; totals.shares += a.shares || 0;
      totals.saves += a.saves || 0; totals.reach += a.reach || 0;
      totals.impressions += a.impressions || 0;
    }

    const latestFollowers = {};
    for (const s of followers.data || []) {
      if (!latestFollowers[s.platform]) latestFollowers[s.platform] = s.followers;
    }

    const draftCounts = (drafts.data || []).reduce((acc, p) => { acc[p.status] = (acc[p.status] || 0) + 1; return acc; }, {});

    const reportData = { date: today, posts_published: recentPosts.data?.length || 0, totals, followers: latestFollowers, pipeline: draftCounts };

    const summary = await ai(
      `Generate a CEO daily social media report for House of Jreym (Etsy digital print shop).
Data: ${JSON.stringify(reportData)}
Format: Executive bullet points. Include: what happened yesterday, wins, gaps, 3 recommendations for today. Max 200 words. Tone: direct, no fluff.`
    );

    const { data: report, error } = await supabase.from("social_reports").upsert({
      report_date: today, generated_by: "IBRAHIM", summary,
      total_posts_published: reportData.posts_published,
      total_reach: totals.reach, total_engagement: totals.likes + totals.comments + totals.shares,
      follower_delta: latestFollowers, full_report: reportData,
      recommendations: summary.split("\n").filter(l => l.includes("•") || l.includes("-")).slice(0, 5)
    }, { onConflict: "report_date" }).select().single();

    if (error) throw new Error(error.message);
    await logAgent("IBRAHIM", `CEO report generated for ${today}`, "info");
    res.json({ ok: true, report: { ...report, summary } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/social/report/latest — get most recent CEO report
socialRouter.get("/report/latest", async (req, res) => {
  try {
    const { data } = await supabase.from("social_reports").select("*").order("report_date", { ascending: false }).limit(1).single();
    res.json({ report: data || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/social/report/history — list all reports
socialRouter.get("/report/history", async (req, res) => {
  try {
    const { data } = await supabase.from("social_reports").select("report_date,summary,total_posts_published,total_reach,total_engagement,follower_delta").order("report_date", { ascending: false }).limit(30);
    res.json({ reports: data || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── SCHEDULE CHECK ───────────────────────────────────────────────────────────

// POST /api/social/schedule/check — called by scheduler cron, publishes due approved/scheduled posts
// Phase 1: DISABLED — returns what would be published without publishing
socialRouter.post("/schedule/check", async (req, res) => {
  const force = req.body?.force === true; // require explicit force flag to ever publish
  try {
    const { data: due } = await supabase.from("social_posts")
      .select("*").eq("status", "scheduled")
      .lte("scheduled_for", new Date().toISOString()).limit(10);

    if (!due?.length) return res.json({ ok: true, due: 0, message: "No posts due" });
    if (!force) {
      return res.json({
        ok: true, phase: "1-draft-only",
        message: `${due.length} post(s) due but auto-posting is disabled in Phase 1. Approve and publish manually.`,
        due_posts: due.map(p => ({ id: p.id, platform: p.platform, scheduled_for: p.scheduled_for, caption_preview: p.caption?.slice(0, 80) }))
      });
    }

    // force=true path — for Phase 2
    res.json({ ok: false, message: "Force publish not enabled in Phase 1" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── META OAUTH (Instagram + Facebook) ───────────────────────────────────────

const META_APP_ID     = process.env.META_APP_ID || "";
const META_APP_SECRET = process.env.META_APP_SECRET || "";
const APP_URL         = process.env.APP_URL || "https://swarm-app-3nch.onrender.com";
const META_REDIRECT   = APP_URL + "/api/social/callback/meta";
// Meta scopes needed for Instagram Business + Facebook Page
const META_SCOPES = [
  "instagram_basic","instagram_content_publish","instagram_manage_insights",
  "pages_show_list","pages_read_engagement","pages_manage_posts",
  "pages_read_user_content","read_insights","business_management"
].join(",");

// GET /api/social/auth/meta — redirect to Meta OAuth
socialRouter.get("/auth/meta", (req, res) => {
  if (!META_APP_ID) return res.status(500).json({ error: "META_APP_ID not set in Render env vars" });
  const url = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(META_REDIRECT)}&scope=${META_SCOPES}&response_type=code&state=hoj-meta-${Date.now()}`;
  res.redirect(url);
});

// GET /api/social/callback/meta — handle Meta OAuth callback
socialRouter.get("/callback/meta", async (req, res) => {
  const { code, error, error_description } = req.query;
  if (error) return res.redirect(`/social_dashboard.html?error=${encodeURIComponent(error_description || error)}`);
  if (!code) return res.redirect("/social_dashboard.html?error=no_code");

  try {
    // Exchange code for short-lived token
    const tokenRes = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?client_id=${META_APP_ID}&client_secret=${META_APP_SECRET}&redirect_uri=${encodeURIComponent(META_REDIRECT)}&code=${code}`);
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error("Token exchange failed: " + JSON.stringify(tokenData));

    // Exchange for long-lived token (60 days)
    const longRes = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${META_APP_ID}&client_secret=${META_APP_SECRET}&fb_exchange_token=${tokenData.access_token}`);
    const longData = await longRes.json();
    const longToken = longData.access_token || tokenData.access_token;
    const expiresIn = longData.expires_in || 5183944; // ~60 days default

    // Get user ID and pages
    const meRes = await fetch(`https://graph.facebook.com/v19.0/me?fields=id,name&access_token=${longToken}`);
    const meData = await meRes.json();

    // Get pages the user manages
    const pagesRes = await fetch(`https://graph.facebook.com/v19.0/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${longToken}`);
    const pagesData = await pagesRes.json();
    const pages = pagesData.data || [];

    // Find the House of Jreym page
    const hojPage = pages.find(p => p.name?.toLowerCase().includes("jreym") || p.name?.toLowerCase().includes("house of")) || pages[0];

    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    // Store Facebook Page credentials
    if (hojPage) {
      const pageToken = hojPage.access_token || longToken;
      await supabase.from("social_credentials").upsert({
        platform: "facebook",
        access_token: pageToken,
        page_id: hojPage.id,
        username: hojPage.name || "Houseofjreym",
        connected: true,
        token_expires_at: expiresAt,
        meta: { user_id: meData.id, page_name: hojPage.name, all_pages: pages.map(p=>p.name) },
        updated_at: new Date().toISOString()
      }, { onConflict: "platform" });

      // Get Instagram Business Account linked to this page
      const igAccountId = hojPage.instagram_business_account?.id;
      if (igAccountId) {
        // Get IG account details
        const igRes = await fetch(`https://graph.facebook.com/v19.0/${igAccountId}?fields=id,username,followers_count,media_count&access_token=${pageToken}`);
        const igData = await igRes.json();
        await supabase.from("social_credentials").upsert({
          platform: "instagram",
          access_token: pageToken,
          page_id: igAccountId,
          account_id: igAccountId,
          username: igData.username || "houseofjreym",
          connected: true,
          token_expires_at: expiresAt,
          meta: { followers: igData.followers_count, media_count: igData.media_count, fb_page_id: hojPage.id },
          updated_at: new Date().toISOString()
        }, { onConflict: "platform" });

        // Snapshot followers
        if (igData.followers_count) {
          await supabase.from("social_account_stats").insert({ platform: "instagram", followers: igData.followers_count, recorded_at: new Date().toISOString() });
        }
        await logAgent("IBRAHIM", `Instagram connected: @${igData.username || "houseofjreym"} (${igData.followers_count || 0} followers)`, "success");
      }

      await logAgent("IBRAHIM", `Facebook connected: ${hojPage.name} (page_id: ${hojPage.id})`, "success");
      res.redirect("/social_dashboard.html?meta=connected&page=" + encodeURIComponent(hojPage.name));
    } else {
      // No pages found — store user token anyway and log
      await logAgent("IBRAHIM", "Meta OAuth: no pages found for this account", "warn");
      res.redirect("/social_dashboard.html?meta=connected&warning=no_pages_found");
    }
  } catch (e) {
    console.error("[IBRAHIM] Meta OAuth callback error:", e.message);
    await logAgent("IBRAHIM", "Meta OAuth failed: " + e.message, "error");
    res.redirect("/social_dashboard.html?error=" + encodeURIComponent(e.message));
  }
});

// ─── TIKTOK OAUTH ─────────────────────────────────────────────────────────────

const TT_CLIENT_KEY    = process.env.TIKTOK_CLIENT_KEY || "";
const TT_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET || "";
const TT_REDIRECT      = APP_URL + "/api/social/callback/tiktok";
const TT_SCOPES        = "user.info.basic,user.info.stats,video.upload,video.publish";

// GET /api/social/auth/tiktok — redirect to TikTok OAuth
socialRouter.get("/auth/tiktok", (req, res) => {
  if (!TT_CLIENT_KEY) return res.status(500).json({ error: "TIKTOK_CLIENT_KEY not set in Render env vars" });
  const csrfState = "hoj-tt-" + Date.now();
  const url = `https://www.tiktok.com/v2/auth/authorize?client_key=${TT_CLIENT_KEY}&scope=${TT_SCOPES}&response_type=code&redirect_uri=${encodeURIComponent(TT_REDIRECT)}&state=${csrfState}`;
  res.redirect(url);
});

// GET /api/social/callback/tiktok — handle TikTok OAuth callback
socialRouter.get("/callback/tiktok", async (req, res) => {
  const { code, error, error_description } = req.query;
  if (error) return res.redirect(`/social_dashboard.html?error=${encodeURIComponent(error_description || error)}`);
  if (!code) return res.redirect("/social_dashboard.html?error=no_tiktok_code");

  try {
    // Exchange code for access token
    const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: TT_CLIENT_KEY, client_secret: TT_CLIENT_SECRET,
        code, grant_type: "authorization_code", redirect_uri: TT_REDIRECT
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error("TikTok token exchange failed: " + JSON.stringify(tokenData));

    // Get user info
    const userRes = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,display_name,avatar_url,follower_count,following_count,likes_count,video_count", {
      headers: { "Authorization": "Bearer " + tokenData.access_token }
    });
    const userData = await userRes.json();
    const user = userData.data?.user || {};

    const expiresAt = new Date(Date.now() + (tokenData.expires_in || 86400) * 1000).toISOString();

    await supabase.from("social_credentials").upsert({
      platform: "tiktok",
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || null,
      account_id: user.open_id || null,
      username: user.display_name || "houseofjreym",
      connected: true,
      token_expires_at: expiresAt,
      meta: { followers: user.follower_count, likes: user.likes_count, videos: user.video_count, open_id: user.open_id },
      updated_at: new Date().toISOString()
    }, { onConflict: "platform" });

    if (user.follower_count) {
      await supabase.from("social_account_stats").insert({ platform: "tiktok", followers: user.follower_count, recorded_at: new Date().toISOString() });
    }

    await logAgent("IBRAHIM", `TikTok connected: @${user.display_name || "houseofjreym"} (${user.follower_count || 0} followers)`, "success");
    res.redirect("/social_dashboard.html?tiktok=connected&user=" + encodeURIComponent(user.display_name || "houseofjreym"));
  } catch (e) {
    console.error("[IBRAHIM] TikTok OAuth callback error:", e.message);
    await logAgent("IBRAHIM", "TikTok OAuth failed: " + e.message, "error");
    res.redirect("/social_dashboard.html?error=" + encodeURIComponent(e.message));
  }
});

// GET /api/social/auth/status — detailed account info (called by dashboard on load)
socialRouter.get("/auth/status", async (req, res) => {
  try {
    const { data: creds } = await supabase.from("social_credentials").select("*");
    const result = {};
    for (const c of creds || []) {
      const expired = c.token_expires_at && new Date(c.token_expires_at) < new Date();
      result[c.platform] = {
        connected: c.connected && !expired,
        username: c.username,
        page_id: c.page_id,
        token_expires_at: c.token_expires_at,
        expired,
        meta: c.meta
      };
    }
    // Add disconnected platforms
    for (const p of ["instagram","facebook","tiktok"]) {
      if (!result[p]) result[p] = { connected: false, username: null };
    }
    res.json({ accounts: result, oauth: {
      meta_configured: !!META_APP_ID,
      tiktok_configured: !!TT_CLIENT_KEY,
      meta_auth_url: META_APP_ID ? "/api/social/auth/meta" : null,
      tiktok_auth_url: TT_CLIENT_KEY ? "/api/social/auth/tiktok" : null
    }});
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/social/token/refresh — refresh a platform token
socialRouter.post("/token/refresh", async (req, res) => {
  const { platform } = req.body;
  try {
    const cred = await getCredential(platform);
    if (!cred) return res.status(404).json({ error: "Platform not connected" });

    if (platform === "tiktok" && cred.refresh_token) {
      const r = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_key: TT_CLIENT_KEY, client_secret: TT_CLIENT_SECRET, grant_type: "refresh_token", refresh_token: cred.refresh_token })
      });
      const data = await r.json();
      if (!data.access_token) throw new Error("TikTok refresh failed: " + JSON.stringify(data));
      const expiresAt = new Date(Date.now() + (data.expires_in || 86400) * 1000).toISOString();
      await supabase.from("social_credentials").update({ access_token: data.access_token, refresh_token: data.refresh_token || cred.refresh_token, token_expires_at: expiresAt, updated_at: new Date().toISOString() }).eq("platform", "tiktok");
      res.json({ ok: true, platform, expires_at: expiresAt });

    } else if ((platform === "facebook" || platform === "instagram") && META_APP_ID) {
      // Refresh Meta long-lived token
      const r = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${META_APP_ID}&client_secret=${META_APP_SECRET}&fb_exchange_token=${cred.access_token}`);
      const data = await r.json();
      if (!data.access_token) throw new Error("Meta refresh failed: " + JSON.stringify(data));
      const expiresAt = new Date(Date.now() + (data.expires_in || 5183944) * 1000).toISOString();
      await supabase.from("social_credentials").update({ access_token: data.access_token, token_expires_at: expiresAt, updated_at: new Date().toISOString() }).eq("platform", platform);
      res.json({ ok: true, platform, expires_at: expiresAt });
    } else {
      res.status(400).json({ error: "Cannot refresh: missing refresh token or app credentials" });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── TOKEN WIZARD — paste one token, auto-discover everything ─────────────────

// POST /api/social/setup/meta — paste a user access token, auto-discovers pages + IG
socialRouter.post("/setup/meta", async (req, res) => {
  const { user_access_token } = req.body;
  if (!user_access_token) return res.status(400).json({ error: "user_access_token required" });

  try {
    const results = { facebook: null, instagram: null, errors: [] };

    // Step 1: Verify token and get user info
    const meRes = await fetch(`https://graph.facebook.com/v19.0/me?fields=id,name&access_token=${user_access_token}`);
    const me = await meRes.json();
    if (me.error) throw new Error("Token invalid: " + me.error.message);

    // Step 2: Get long-lived token (60 days) if we have app credentials
    let longToken = user_access_token;
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (appId && appSecret && !appId.startsWith("PASTE")) {
      const llRes = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${user_access_token}`);
      const llData = await llRes.json();
      if (llData.access_token) {
        longToken = llData.access_token;
        console.log("[IBRAHIM] Got long-lived Meta token, expires_in:", llData.expires_in);
      }
    }
    const expiresAt = new Date(Date.now() + 5183944000).toISOString(); // 60 days default

    // Step 3: Get all pages managed by user
    const pagesRes = await fetch(`https://graph.facebook.com/v19.0/me/accounts?fields=id,name,access_token,instagram_business_account{id,username,followers_count,media_count}&limit=25&access_token=${longToken}`);
    const pagesData = await pagesRes.json();
    const pages = pagesData.data || [];
    console.log("[IBRAHIM] Found", pages.length, "pages:", pages.map(p=>p.name));

    if (!pages.length) {
      results.errors.push("No Facebook Pages found. Make sure you're logged in as an admin of the Houseofjreym page.");
    }

    // Step 4: Find House of Jreym page (fuzzy match)
    const hojKeywords = ["jreym", "house of", "houseofjreym"];
    const hojPage = pages.find(p =>
      hojKeywords.some(k => p.name?.toLowerCase().includes(k))
    ) || pages[0]; // fallback to first page

    if (hojPage) {
      const pageToken = hojPage.access_token || longToken;
      // Page tokens are long-lived by default

      // Store Facebook
      const { error: fbErr } = await supabase.from("social_credentials").upsert({
        platform: "facebook",
        access_token: pageToken,
        page_id: hojPage.id,
        username: hojPage.name,
        connected: true,
        token_expires_at: expiresAt,
        meta: { user_id: me.id, user_name: me.name, all_pages: pages.map(p => ({ id: p.id, name: p.name })) },
        updated_at: new Date().toISOString()
      }, { onConflict: "platform" });

      results.facebook = { ok: !fbErr, page_id: hojPage.id, page_name: hojPage.name, error: fbErr?.message };
      if (!fbErr) await logAgent("IBRAHIM", `Facebook connected: ${hojPage.name} (page_id: ${hojPage.id})`, "success");

      // Step 5: Check for linked Instagram Business Account
      const igAccount = hojPage.instagram_business_account;
      if (igAccount?.id) {
        // Get detailed IG info using page token
        const igRes = await fetch(`https://graph.facebook.com/v19.0/${igAccount.id}?fields=id,username,followers_count,media_count,biography&access_token=${pageToken}`);
        const ig = await igRes.json();

        const { error: igErr } = await supabase.from("social_credentials").upsert({
          platform: "instagram",
          access_token: pageToken, // IG Business uses page token
          page_id: ig.id,
          account_id: ig.id,
          username: ig.username || igAccount.username || "houseofjreym",
          connected: true,
          token_expires_at: expiresAt,
          meta: { followers: ig.followers_count, media_count: ig.media_count, fb_page_id: hojPage.id, fb_page_name: hojPage.name },
          updated_at: new Date().toISOString()
        }, { onConflict: "platform" });

        // Snapshot followers
        if (ig.followers_count) {
          await supabase.from("social_account_stats").insert({ platform: "instagram", followers: ig.followers_count, recorded_at: new Date().toISOString() });
        }
        results.instagram = { ok: !igErr, account_id: ig.id, username: ig.username || "houseofjreym", followers: ig.followers_count, error: igErr?.message };
        if (!igErr) await logAgent("IBRAHIM", `Instagram connected: @${ig.username} (${ig.followers_count} followers)`, "success");
      } else {
        results.errors.push("No Instagram Business Account linked to this Facebook Page. Go to Facebook Page Settings → Instagram → Connect Account.");
        results.instagram = { ok: false, error: "No IG Business Account linked to page" };
      }
    }

    res.json({ ok: true, user: me, results, tip: "If Instagram not found, link it in Facebook Page Settings → Instagram" });
  } catch (e) {
    console.error("[IBRAHIM] Meta setup error:", e.message);
    await logAgent("IBRAHIM", "Meta setup failed: " + e.message, "error");
    res.status(500).json({ error: e.message });
  }
});

// POST /api/social/setup/tiktok — paste TikTok access token, auto-saves
socialRouter.post("/setup/tiktok", async (req, res) => {
  const { access_token, open_id, refresh_token } = req.body;
  if (!access_token) return res.status(400).json({ error: "access_token required" });

  try {
    // Get user info
    const userRes = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,display_name,avatar_url,follower_count,following_count,likes_count,video_count", {
      headers: { "Authorization": "Bearer " + access_token, "Content-Type": "application/json" }
    });
    const userData = await userRes.json();
    const user = userData.data?.user || {};
    const resolvedOpenId = user.open_id || open_id || null;

    const expiresAt = new Date(Date.now() + 86400000).toISOString(); // 24h default

    const { error } = await supabase.from("social_credentials").upsert({
      platform: "tiktok",
      access_token,
      refresh_token: refresh_token || null,
      account_id: resolvedOpenId,
      username: user.display_name || "houseofjreym",
      connected: true,
      token_expires_at: expiresAt,
      meta: { followers: user.follower_count, likes: user.likes_count, videos: user.video_count, open_id: resolvedOpenId },
      updated_at: new Date().toISOString()
    }, { onConflict: "platform" });

    if (error) throw new Error(error.message);

    if (user.follower_count) {
      await supabase.from("social_account_stats").insert({ platform: "tiktok", followers: user.follower_count, recorded_at: new Date().toISOString() });
    }

    await logAgent("IBRAHIM", `TikTok connected: @${user.display_name || "houseofjreym"} (${user.follower_count || 0} followers)`, "success");
    res.json({ ok: true, username: user.display_name || "houseofjreym", followers: user.follower_count || 0, open_id: resolvedOpenId });
  } catch (e) {
    console.error("[IBRAHIM] TikTok setup error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/social/setup/meta-instructions — returns exact steps to get the token
socialRouter.get("/setup/meta-instructions", (req, res) => {
  const appId = process.env.META_APP_ID;
  const hasRealApp = appId && !appId.startsWith("PASTE");
  res.json({
    method: hasRealApp ? "oauth" : "graph_explorer",
    steps: hasRealApp ? [
      "1. Go to swarm-app-3nch.onrender.com/social_dashboard.html",
      "2. Click Connect Accounts tab",
      "3. Click Connect with Meta button",
      "4. Log in with the Facebook account that manages Houseofjreym page",
      "5. Grant all requested permissions",
      "6. You'll be redirected back automatically"
    ] : [
      "1. Go to https://developers.facebook.com/tools/explorer/",
      "2. Click 'Meta App' dropdown → select an app (or create one)",
      "3. Click 'Generate Access Token'",
      "4. Log in as the Facebook account managing Houseofjreym page",
      "5. Select permissions: pages_show_list, pages_read_engagement, pages_manage_posts, instagram_basic, instagram_content_publish, instagram_manage_insights",
      "6. Copy the generated User Access Token",
      "7. Paste it into the dashboard Connect Accounts → Manual Token Entry",
      "8. Or POST to /api/social/setup/meta with {user_access_token: 'YOUR_TOKEN'}"
    ],
    oauth_ready: hasRealApp,
    meta_app_id: hasRealApp ? appId : null,
    redirect_uri: "https://swarm-app-3nch.onrender.com/api/social/callback/meta"
  });
});


// ─── DASHBOARD DATA ENDPOINT ──────────────────────────────────────────────────

// GET /api/social/dashboard — single endpoint that feeds the dashboard
socialRouter.get("/dashboard", async (req, res) => {
  try {
    const [statusRes, postsRes, analyticsRes, followersRes, reportRes, pendingRes] = await Promise.all([
      supabase.from("social_credentials").select("platform,connected,username,updated_at"),
      supabase.from("social_posts").select("id,platform,status,caption,created_at,published_at,scheduled_for,created_by").order("created_at", { ascending: false }).limit(20),
      supabase.from("social_analytics").select("platform,views,likes,comments,shares,saves,reach,impressions,recorded_at").order("recorded_at", { ascending: false }).limit(100),
      supabase.from("social_account_stats").select("platform,followers,recorded_at").order("recorded_at", { ascending: false }).limit(10),
      supabase.from("social_reports").select("report_date,summary,total_posts_published,total_reach,total_engagement").order("report_date", { ascending: false }).limit(1),
      supabase.from("social_posts").select("id,platform,caption,created_at,created_by").eq("status", "pending_approval")
    ]);

    const totals = {};
    for (const a of analyticsRes.data || []) {
      if (!totals[a.platform]) totals[a.platform] = { views: 0, likes: 0, comments: 0, shares: 0, saves: 0, reach: 0, impressions: 0 };
      for (const k of ["views","likes","comments","shares","saves","reach","impressions"]) totals[a.platform][k] += a[k] || 0;
    }

    const latestFollowers = {};
    for (const s of followersRes.data || []) if (!latestFollowers[s.platform]) latestFollowers[s.platform] = s.followers;

    res.json({
      phase: "1-draft-only",
      auto_posting: false,
      connections: statusRes.data || [],
      posts: postsRes.data || [],
      analytics: totals,
      followers: latestFollowers,
      pending_approval: pendingRes.data || [],
      latest_report: reportRes.data?.[0] || null,
      timestamp: new Date().toISOString()
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
