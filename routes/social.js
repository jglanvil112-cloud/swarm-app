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

      const { data } = await supabase.from("social_posts").insert({
        platform, status: "draft", created_by: "IBRAHIM",
        caption: content.caption, hashtags: content.hashtags || [],
        media_type: "image", keyword: topic,
        etsy_listing_id: etsy_listing_id || null,
        meta: { platform_notes: content.platform_notes, style },
        updated_at: new Date().toISOString()
      }).select().single();

      posts.push(data);
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
