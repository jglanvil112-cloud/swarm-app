// routes/ibrahim.js — IBRAHIM Auto-Posting Engine v2.0
// Phase 2: AUTO-POSTING ENABLED
// Strategy: 60% art previews, 30% reels, 10% BTS
// Schedule: 2 posts/day + 1 reel/day at optimal times
// Features: engagement guard, CEO report, follower tracking, Etsy traffic priority

import express from "express";
import { supabase, logAgent } from "../lib/supabase.js";
export const ibrahimRouter = express.Router();

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const APP_URL = process.env.APP_URL || "https://swarm-app-3nch.onrender.com";

// ─── CONFIG ───────────────────────────────────────────────────────────────────

export const IBRAHIM_CONFIG = {
  auto_posting: true,
  phase: "2-auto-posting",
  posts_per_day: 2,
  reels_per_day: 1,
  // Optimal posting times (EST → UTC)
  post_times_utc: ["14:00", "22:00"],   // 10am, 6pm EST
  reel_time_utc:  "18:00",              // 2pm EST — peak reel engagement
  // Content mix
  strategy: {
    art_showcase:   0.60,  // Digital art previews + Etsy listing showcases
    trending_reels: 0.30,  // Trending audio reels
    bts:            0.10,  // Behind-the-scenes House of Jreym
  },
  // Engagement guard — auto-pause thresholds
  engagement_guard: {
    enabled: true,
    min_engagement_rate: 0.015,   // Pause if drops below 1.5%
    lookback_posts: 5,             // Check last 5 posts
    cooldown_hours: 24,            // Auto-resume after 24h cooldown
  },
  // Tracking
  track: ["followers","reach","impressions","engagement","profile_visits","link_clicks","saves","shares"],
};

// ─── AI HELPER ────────────────────────────────────────────────────────────────

async function ai(prompt, system) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001", max_tokens: 1500,
      system: system || "You are IBRAHIM, House of Jreym's elite social media AI. House of Jreym is a premium digital art print shop on Etsy. Brand voice: bold, culturally rich, aspirational. Drive Etsy traffic and IG follower growth. Be concise, creative, and authentic.",
      messages: [{ role: "user", content: prompt }]
    })
  });
  const d = await r.json();
  return d.content?.[0]?.text || "";
}

// ─── TOKEN HELPER ─────────────────────────────────────────────────────────────

async function getIGCredentials() {
  const { data } = await supabase.from("social_credentials")
    .select("*").eq("platform", "instagram").single();
  if (!data?.access_token) throw new Error("Instagram not connected");
  return data;
}

// ─── CONTENT GENERATION ───────────────────────────────────────────────────────

async function generatePostContent(type, keyword = "", listingData = null) {
  let prompt = "";

  if (type === "art_showcase") {
    const listing = listingData || { title: keyword || "Premium Digital Art Print", price: "$7.99" };
    prompt = `Generate an Instagram post for House of Jreym digital art print shop.
Listing: "${listing.title}" — ${listing.price || "$7.99"} on Etsy
Requirements:
- Hook in first line (no hashtags in first line)
- 2-3 sentences max body copy
- Strong CTA driving to Etsy shop (link in bio)
- 25-30 relevant hashtags mixing: niche art hashtags, trending tags, brand tags
- Include #HouseOfJreym #DigitalArt #EtsyShop
- Tone: aspirational, culturally rich, premium feel
Return ONLY the caption text with hashtags at the end.`;
  }
  else if (type === "trending_reel") {
    prompt = `Generate an Instagram Reel caption for House of Jreym digital art print shop.
Context: Reel showcasing digital art prints, using trending audio
Requirements:
- Short punchy hook (under 10 words) — designed for Reels
- Minimal text — let the visual do the work
- 1 strong CTA (link in bio / shop now)
- 20-25 hashtags: trending Reels tags + niche art + brand
- Include #Reels #ArtReels #HouseOfJreym
- Tone: energetic, bold, scroll-stopping
Return ONLY the caption text with hashtags at the end.`;
  }
  else if (type === "bts") {
    prompt = `Generate a behind-the-scenes Instagram post for House of Jreym digital art shop.
Requirements:
- Authentic, personal tone — show the creative process
- 2-4 sentences about designing/curating digital prints
- Make followers feel part of the brand journey
- Soft CTA to Etsy shop
- 20-25 hashtags mixing: BTS/process tags, art community, brand tags
- Include #BehindTheScenes #HouseOfJreym #BlackArtist #DigitalCreator
Return ONLY the caption text with hashtags at the end.`;
  }

  return await ai(prompt);
}

async function generateReelDescription(keyword = "") {
  return await ai(`Generate a short Instagram Reel video description/script outline for House of Jreym.
Theme: ${keyword || "digital art print showcase"}
Format: 3-5 bullet points describing what to show on screen (visual directions only, no audio)
Keep it actionable and visual. Under 100 words total.`);
}

// ─── SCHEDULE CALCULATOR ─────────────────────────────────────────────────────

function getNextPostTimes(count = 10) {
  const times = [];
  const now = new Date();
  let day = new Date(now);
  day.setUTCHours(0, 0, 0, 0);

  // Content rotation: 60% art, 30% reels, 10% bts
  const typeRotation = [
    "art_showcase","art_showcase","art_showcase",
    "trending_reel","trending_reel","trending_reel",
    "art_showcase","art_showcase","art_showcase",
    "bts"
  ];
  let typeIdx = 0;
  let dayOffset = 0;

  while (times.length < count) {
    const postDay = new Date(day.getTime() + dayOffset * 86400000);

    // 2 posts per day
    for (const timeStr of IBRAHIM_CONFIG.post_times_utc) {
      if (times.length >= count) break;
      const [h, m] = timeStr.split(":").map(Number);
      const scheduled = new Date(postDay);
      scheduled.setUTCHours(h, m, 0, 0);
      if (scheduled > now) {
        const type = typeRotation[typeIdx % typeRotation.length];
        times.push({
          scheduled_for: scheduled.toISOString(),
          type,
          is_reel: false,
          day_label: postDay.toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric", timeZone:"America/New_York" }),
          time_label: scheduled.toLocaleTimeString("en-US", { hour:"numeric", minute:"2-digit", timeZone:"America/New_York" })
        });
        typeIdx++;
      }
    }

    // 1 reel per day at reel time
    if (times.length < count) {
      const [rh, rm] = IBRAHIM_CONFIG.reel_time_utc.split(":").map(Number);
      const reelTime = new Date(postDay);
      reelTime.setUTCHours(rh, rm, 0, 0);
      if (reelTime > now) {
        times.push({
          scheduled_for: reelTime.toISOString(),
          type: "trending_reel",
          is_reel: true,
          day_label: postDay.toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric", timeZone:"America/New_York" }),
          time_label: reelTime.toLocaleTimeString("en-US", { hour:"numeric", minute:"2-digit", timeZone:"America/New_York" })
        });
      }
    }

    dayOffset++;
    if (dayOffset > 30) break;
  }

  return times.sort((a, b) => new Date(a.scheduled_for) - new Date(b.scheduled_for)).slice(0, count);
}

// ─── INSTAGRAM PUBLISHER ─────────────────────────────────────────────────────

async function publishToInstagram(post) {
  const cred = await getIGCredentials();
  const token = cred.access_token;
  const base = "https://graph.instagram.com/v21.0";

  // Resolve the correct IG Business account id from the token (not the stale stored id)
  let userId = null;
  try {
    const meRes = await fetch(`${base}/me?fields=user_id,id,username&access_token=${token}`);
    const me = await meRes.json();
    userId = me.user_id ? String(me.user_id) : (me.id ? String(me.id) : null);
  } catch {}
  if (!userId) userId = cred.page_id || cred.account_id || "17841436491512867";

  if (!post.media_urls?.length) {
    throw new Error("No media URL for post " + post.id);
  }

  const imageUrl = post.media_urls[0];

  // Create media container
  const containerPayload = {
    image_url: imageUrl,
    caption: post.caption,
    media_type: "IMAGE",
    access_token: token
  };

  if (post.media_type === "REEL" || post.is_reel) {
    containerPayload.media_type = "REELS";
    containerPayload.video_url = imageUrl;
    delete containerPayload.image_url;
  }

  const cRes = await fetch(`${base}/${userId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(containerPayload)
  });
  const container = await cRes.json();
  if (container.error) throw new Error("Container error: " + container.error.message);
  if (!container.id) throw new Error("No container id: " + JSON.stringify(container));

  // Poll container until Instagram finishes processing (avoids "Media ID is not available")
  let ready = false;
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const sRes = await fetch(`${base}/${container.id}?fields=status_code,status&access_token=${token}`);
    const sd = await sRes.json();
    if (sd.status_code === "FINISHED") { ready = true; break; }
    if (sd.status_code === "ERROR" || sd.status === "ERROR") throw new Error("Container processing failed: " + JSON.stringify(sd));
  }
  if (!ready) throw new Error("Container still processing after 20s");

  // Publish
  const pRes = await fetch(`${base}/${userId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: container.id, access_token: token })
  });
  const published = await pRes.json();
  if (published.error) throw new Error("Publish error: " + published.error.message);

  return published.id;
}

// ─── ENGAGEMENT GUARD ─────────────────────────────────────────────────────────

async function checkEngagementGuard() {
  if (!IBRAHIM_CONFIG.engagement_guard.enabled) return { paused: false };

  try {
    const { data: recentPosts } = await supabase
      .from("social_posts")
      .select("analytics")
      .eq("platform", "instagram")
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(IBRAHIM_CONFIG.engagement_guard.lookback_posts);

    if (!recentPosts?.length || recentPosts.length < 3) return { paused: false, reason: "insufficient_data" };

    const rates = recentPosts
      .map(p => p.analytics?.engagement_rate || 0)
      .filter(r => r > 0);

    if (!rates.length) return { paused: false, reason: "no_rates" };

    const avgRate = rates.reduce((a, b) => a + b, 0) / rates.length;
    const threshold = IBRAHIM_CONFIG.engagement_guard.min_engagement_rate;

    if (avgRate < threshold) {
      await logAgent("IBRAHIM", `⚠️ Engagement guard triggered: avg ${(avgRate*100).toFixed(2)}% < ${(threshold*100)}% threshold. Auto-pausing.`, "warn");
      return { paused: true, avg_rate: avgRate, threshold, reason: "low_engagement" };
    }

    return { paused: false, avg_rate: avgRate };
  } catch (e) {
    console.error("[IBRAHIM] Engagement guard error:", e.message);
    return { paused: false };
  }
}

// ─── AUTO-PUBLISH ENGINE ──────────────────────────────────────────────────────

export async function runAutoPublish() {
  try {
    // 1. Check engagement guard
    const guard = await checkEngagementGuard();
    if (guard.paused) {
      console.log(`[IBRAHIM] Auto-publish paused by engagement guard (avg: ${(guard.avg_rate*100).toFixed(2)}%)`);
      return { published: 0, paused: true, reason: guard.reason };
    }

    // 2. Find scheduled posts that are due
    const { data: duePosts } = await supabase
      .from("social_posts")
      .select("*")
      .eq("platform", "instagram")
      .eq("status", "scheduled")
      .lte("scheduled_for", new Date().toISOString())
      .order("scheduled_for", { ascending: true })
      .limit(3);

    if (!duePosts?.length) return { published: 0, paused: false };

    let publishedCount = 0;
    for (const post of duePosts) {
      try {
        // Check we haven't already hit daily limit
        const today = new Date().toISOString().split("T")[0];
        const { count: todayCount } = await supabase
          .from("social_posts")
          .select("id", { count: "exact", head: true })
          .eq("platform", "instagram")
          .eq("status", "published")
          .gte("published_at", today + "T00:00:00Z");

        const dailyLimit = IBRAHIM_CONFIG.posts_per_day + IBRAHIM_CONFIG.reels_per_day;
        if ((todayCount || 0) >= dailyLimit) {
          console.log(`[IBRAHIM] Daily limit reached (${todayCount}/${dailyLimit}). Skipping.`);
          break;
        }

        const postId = await publishToInstagram(post);

        await supabase.from("social_posts").update({
          status: "published",
          published_at: new Date().toISOString(),
          ig_post_id: postId,
          updated_at: new Date().toISOString()
        }).eq("id", post.id);

        await logAgent("IBRAHIM", `✅ Published to @houseofjreym: ${postId} | Type: ${post.media_type} | "${post.caption?.slice(0, 60)}..."`, "success");
        publishedCount++;

        // Space out posts to avoid rate limits
        if (duePosts.indexOf(post) < duePosts.length - 1) {
          await new Promise(r => setTimeout(r, 5000));
        }
      } catch (e) {
        // Mark failed so the scheduler (which only selects status="scheduled") stops retrying it.
        await logAgent("IBRAHIM", `❌ Publish failed for post ${post.id}: ${e.message}`, "error");
        const { error: updateErr } = await supabase.from("social_posts").update({
          status: "failed",
          error_message: e.message,
          updated_at: new Date().toISOString()
        }).eq("id", post.id);
        if (updateErr) console.error("[IBRAHIM] Failed to update post status:", updateErr.message);
        console.log(`[IBRAHIM] Post ${post.id} marked failed after publish error. Fix and re-schedule to retry.`);
      }
    }

    return { published: publishedCount, paused: false };
  } catch (e) {
    console.error("[IBRAHIM] Auto-publish error:", e.message);
    return { published: 0, error: e.message };
  }
}

// ─── ANALYTICS SYNC ───────────────────────────────────────────────────────────

async function syncPostAnalytics(postId, igPostId, token) {
  try {
    const fields = "id,like_count,comments_count,shares_count,saved,reach,impressions,profile_visits,follows";
    const r = await fetch(`https://graph.facebook.com/v21.0/${igPostId}/insights?metric=reach,impressions,saved,profile_visits&access_token=${token}`);
    const data = await r.json();
    if (data.error) return null;

    const metrics = {};
    for (const d of data.data || []) metrics[d.name] = d.values?.[0]?.value || 0;

    // Also get likes/comments from media endpoint
    const m = await fetch(`https://graph.facebook.com/v21.0/${igPostId}?fields=like_count,comments_count&access_token=${token}`);
    const mData = await m.json();

    const analytics = {
      reach: metrics.reach || 0,
      impressions: metrics.impressions || 0,
      saves: metrics.saved || 0,
      profile_visits: metrics.profile_visits || 0,
      likes: mData.like_count || 0,
      comments: mData.comments_count || 0,
      engagement_rate: metrics.reach > 0
        ? ((mData.like_count || 0) + (mData.comments_count || 0) + (metrics.saved || 0)) / metrics.reach
        : 0
    };

    await supabase.from("social_posts").update({
      analytics,
      updated_at: new Date().toISOString()
    }).eq("ig_post_id", igPostId);

    return analytics;
  } catch (e) {
    console.error("[IBRAHIM] Analytics sync error:", e.message);
    return null;
  }
}

// ─── FOLLOWER SNAPSHOT ────────────────────────────────────────────────────────

export async function takeFollowerSnapshot() {
  try {
    const cred = await getIGCredentials();
    const userId = cred.page_id || "17841436491512867";
    const r = await fetch(`https://graph.instagram.com/v21.0/${userId}?fields=followers_count,media_count,profile_views&access_token=${cred.access_token}`);
    const data = await r.json();
    if (data.error) throw new Error(data.error.message);

    // Get previous snapshot for delta
    const { data: prev } = await supabase
      .from("social_account_stats")
      .select("followers")
      .eq("platform", "instagram")
      .order("recorded_at", { ascending: false })
      .limit(1)
      .single();

    const followers = data.followers_count || 0;
    const delta = prev ? followers - (prev.followers || 0) : 0;

    await supabase.from("social_account_stats").insert({
      platform: "instagram",
      followers,
      following: 0,
      posts: data.media_count || 0,
      recorded_at: new Date().toISOString()
    });

    await logAgent("IBRAHIM", `📊 Follower snapshot: ${followers} followers (${delta >= 0 ? "+" : ""}${delta} today)`, "info");
    return { followers, delta, posts: data.media_count };
  } catch (e) {
    console.error("[IBRAHIM] Follower snapshot error:", e.message);
    return null;
  }
}

// ─── CEO DAILY REPORT ─────────────────────────────────────────────────────────

export async function generateCEOReport() {
  try {
    const today = new Date().toISOString().split("T")[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];

    // Published posts today
    const { data: publishedToday } = await supabase
      .from("social_posts")
      .select("*")
      .eq("platform", "instagram")
      .eq("status", "published")
      .gte("published_at", yesterday + "T00:00:00Z");

    // Follower delta
    const { data: snapshots } = await supabase
      .from("social_account_stats")
      .select("followers,recorded_at")
      .eq("platform", "instagram")
      .order("recorded_at", { ascending: false })
      .limit(2);

    const currentFollowers = snapshots?.[0]?.followers || 0;
    const followerDelta = snapshots?.length >= 2
      ? currentFollowers - snapshots[1].followers
      : 0;

    // Aggregate analytics
    const totals = (publishedToday || []).reduce((acc, p) => {
      const a = p.analytics || {};
      acc.reach += a.reach || 0;
      acc.impressions += a.impressions || 0;
      acc.likes += a.likes || 0;
      acc.comments += a.comments || 0;
      acc.saves += a.saves || 0;
      acc.profile_visits += a.profile_visits || 0;
      return acc;
    }, { reach: 0, impressions: 0, likes: 0, comments: 0, saves: 0, profile_visits: 0 });

    const avgEngagement = publishedToday?.length
      ? (publishedToday.reduce((a, p) => a + (p.analytics?.engagement_rate || 0), 0) / publishedToday.length)
      : 0;

    // AI summary
    const summary = await ai(`Generate a brief CEO daily social media report for House of Jreym (@houseofjreym).
Data for ${today}:
- Posts published: ${publishedToday?.length || 0}
- Total reach: ${totals.reach}
- Total impressions: ${totals.impressions}
- Likes: ${totals.likes} | Comments: ${totals.comments} | Saves: ${totals.saves}
- Avg engagement rate: ${(avgEngagement * 100).toFixed(2)}%
- Follower change: ${followerDelta >= 0 ? "+" : ""}${followerDelta}
- Current followers: ${currentFollowers}
- Profile visits: ${totals.profile_visits}

Write a 3-paragraph CEO report: (1) performance summary, (2) what's working, (3) tomorrow's focus. Be specific and data-driven. Under 200 words.`);

    const report = {
      report_date: today,
      summary,
      total_posts_published: publishedToday?.length || 0,
      total_reach: totals.reach,
      total_impressions: totals.impressions,
      total_engagement: totals.likes + totals.comments + totals.saves,
      avg_engagement_rate: avgEngagement,
      follower_delta: followerDelta,
      current_followers: currentFollowers,
      profile_visits: totals.profile_visits,
      created_at: new Date().toISOString()
    };

    await supabase.from("social_reports").upsert(report, { onConflict: "report_date" });
    await logAgent("IBRAHIM", `📋 CEO Report generated for ${today}: ${currentFollowers} followers, +${followerDelta} delta, ${(avgEngagement*100).toFixed(2)}% engagement`, "info");

    return { ok: true, report };
  } catch (e) {
    console.error("[IBRAHIM] CEO Report error:", e.message);
    return { ok: false, error: e.message };
  }
}

// ─── GENERATE + SCHEDULE POSTS ────────────────────────────────────────────────

export async function generateAndSchedulePosts(count = 10) {
  const scheduledTimes = getNextPostTimes(count);
  const results = [];

  // Pull latest Etsy listings for art showcase content
  let etsyListings = [];
  try {
    const { data } = await supabase
      .from("agent_outputs")
      .select("etsy_title")
      .eq("output_type", "etsy_listing_published")
      .order("created_at", { ascending: false })
      .limit(20);
    etsyListings = (data || []).map(d => ({ title: d.etsy_title, price: "$7.99" }));
  } catch (e) { /* non-fatal */ }

  // Pull latest trends for reel keywords
  let trends = [];
  try {
    const { data } = await supabase.from("trends").select("keyword").order("detected_at", { ascending: false }).limit(10);
    trends = (data || []).map(d => d.keyword);
  } catch (e) { /* non-fatal */ }

  for (let i = 0; i < scheduledTimes.length; i++) {
    const slot = scheduledTimes[i];
    const listing = etsyListings[i % (etsyListings.length || 1)] || null;
    const keyword = trends[i % (trends.length || 1)] || "digital art prints";

    try {
      const caption = await generatePostContent(slot.type, keyword, listing);
      const description = slot.is_reel ? await generateReelDescription(keyword) : null;

      // Use a placeholder image — will be replaced with actual listing images
      const imageUrl = listing
        ? `${APP_URL}/api/etsy/listing-image?title=${encodeURIComponent(listing.title || keyword)}`
        : `${APP_URL}/api/etsy/listing-image?title=${encodeURIComponent(keyword)}`;

      const { data: post, error } = await supabase.from("social_posts").insert({
        platform: "instagram",
        caption,
        media_urls: [imageUrl],
        media_type: slot.is_reel ? "REEL" : "IMAGE",
        status: "scheduled",
        scheduled_for: slot.scheduled_for,
        keyword,
        created_by: "IBRAHIM",
        etsy_listing_id: null,
        meta: {
          content_type: slot.type,
          is_reel: slot.is_reel,
          day_label: slot.day_label,
          time_label: slot.time_label,
          reel_description: description,
          listing_title: listing?.title
        }
      }).select().single();

      if (error) throw new Error(error.message);
      results.push({ ...post, slot });
      await logAgent("IBRAHIM", `📅 Scheduled: ${slot.type} post for ${slot.day_label} ${slot.time_label}`, "info");

      // Small delay between AI calls
      await new Promise(r => setTimeout(r, 1500));
    } catch (e) {
      console.error(`[IBRAHIM] Failed to generate post ${i+1}:`, e.message);
      results.push({ error: e.message, slot });
    }
  }

  return results;
}

// ─── API ROUTES ───────────────────────────────────────────────────────────────

// GET /api/ibrahim/status — config + stats
ibrahimRouter.get("/status", async (req, res) => {
  try {
    const guard = await checkEngagementGuard();
    const { count: scheduledCount } = await supabase.from("social_posts").select("id", { count: "exact", head: true }).eq("platform","instagram").eq("status","scheduled");
    const { count: publishedCount } = await supabase.from("social_posts").select("id", { count: "exact", head: true }).eq("platform","instagram").eq("status","published");
    const { data: latestReport } = await supabase.from("social_reports").select("*").order("report_date", { ascending: false }).limit(1).single();
    const { data: followerSnap } = await supabase.from("social_account_stats").select("followers,recorded_at").eq("platform","instagram").order("recorded_at",{ascending:false}).limit(1).single();

    res.json({
      config: IBRAHIM_CONFIG,
      phase: "2-auto-posting",
      auto_posting: true,
      engagement_guard: { ...guard, config: IBRAHIM_CONFIG.engagement_guard },
      stats: {
        scheduled: scheduledCount || 0,
        published: publishedCount || 0,
        followers: followerSnap?.followers || 0,
        last_snapshot: followerSnap?.recorded_at
      },
      latest_report: latestReport || null
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/ibrahim/generate — generate and schedule next N posts
ibrahimRouter.post("/generate", async (req, res) => {
  const { count = 10 } = req.body;
  try {
    const posts = await generateAndSchedulePosts(Math.min(count, 20));
    res.json({ ok: true, generated: posts.length, posts: posts.map(p => ({
      id: p.id,
      type: p.meta?.content_type,
      is_reel: p.meta?.is_reel,
      scheduled_for: p.scheduled_for,
      day_label: p.meta?.day_label,
      time_label: p.meta?.time_label,
      caption_preview: p.caption?.slice(0, 100) + "...",
      listing_title: p.meta?.listing_title
    }))});
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/ibrahim/publish-now — manually trigger auto-publish check
ibrahimRouter.post("/publish-now", async (req, res) => {
  try {
    const result = await runAutoPublish();
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/ibrahim/follower-snapshot — take follower count snapshot
ibrahimRouter.post("/follower-snapshot", async (req, res) => {
  try {
    const result = await takeFollowerSnapshot();
    res.json(result || { error: "Snapshot failed" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/ibrahim/ceo-report — generate CEO daily report
ibrahimRouter.post("/ceo-report", async (req, res) => {
  try {
    const result = await generateCEOReport();
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/ibrahim/ceo-report — get latest CEO report
ibrahimRouter.get("/ceo-report", async (req, res) => {
  try {
    const { data } = await supabase.from("social_reports")
      .select("*").order("report_date", { ascending: false }).limit(7);
    res.json({ reports: data || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/ibrahim/schedule — view upcoming scheduled posts
ibrahimRouter.get("/schedule", async (req, res) => {
  try {
    const { data } = await supabase.from("social_posts")
      .select("id,caption,media_type,scheduled_for,status,meta,keyword")
      .eq("platform","instagram")
      .in("status",["scheduled","pending_approval"])
      .order("scheduled_for",{ascending:true})
      .limit(20);
    res.json({ scheduled: data || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/ibrahim/pause — manually pause auto-posting
ibrahimRouter.post("/pause", async (req, res) => {
  IBRAHIM_CONFIG.auto_posting = false;
  await logAgent("IBRAHIM","⏸ Auto-posting manually paused by CEO","warn");
  res.json({ ok: true, auto_posting: false });
});

// POST /api/ibrahim/resume — manually resume
ibrahimRouter.post("/resume", async (req, res) => {
  IBRAHIM_CONFIG.auto_posting = true;
  await logAgent("IBRAHIM","▶️ Auto-posting resumed by CEO","info");
  res.json({ ok: true, auto_posting: true });
});

// GET /api/ibrahim/analytics — follower + engagement summary
ibrahimRouter.get("/analytics", async (req, res) => {
  try {
    const { data: snaps } = await supabase.from("social_account_stats")
      .select("followers,recorded_at").eq("platform","instagram")
      .order("recorded_at",{ascending:false}).limit(30);

    const { data: posts } = await supabase.from("social_posts")
      .select("analytics,published_at,meta")
      .eq("platform","instagram").eq("status","published")
      .order("published_at",{ascending:false}).limit(20);

    const totalReach = posts?.reduce((a,p) => a + (p.analytics?.reach||0), 0) || 0;
    const totalLikes = posts?.reduce((a,p) => a + (p.analytics?.likes||0), 0) || 0;
    const totalSaves = posts?.reduce((a,p) => a + (p.analytics?.saves||0), 0) || 0;
    const avgEng = posts?.length
      ? posts.reduce((a,p) => a + (p.analytics?.engagement_rate||0), 0) / posts.length
      : 0;

    res.json({
      follower_history: snaps || [],
      current_followers: snaps?.[0]?.followers || 0,
      posts_published: posts?.length || 0,
      total_reach: totalReach,
      total_likes: totalLikes,
      total_saves: totalSaves,
      avg_engagement_rate: avgEng,
      engagement_guard: await checkEngagementGuard()
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default ibrahimRouter;
