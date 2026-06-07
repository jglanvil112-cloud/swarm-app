
import express from "express";
import { logAgent } from "../lib/supabase.js";
export const instagramRouter = express.Router();
const IG_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN || "";
const IG_USER_ID = process.env.INSTAGRAM_USER_ID || "17841436491512867";
const IG_BASE = "https://graph.facebook.com/v21.0";
instagramRouter.post("/post", async (req, res) => {
  try {
    const { image_url, caption } = req.body;
    if (!image_url || !caption) return res.status(400).json({ error: "image_url and caption required" });
    const c = await fetch(`${IG_BASE}/${IG_USER_ID}/media`, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ image_url, caption, access_token: IG_TOKEN }) });
    const container = await c.json();
    if (container.error) { await logAgent("INSTAGRAM","error",container.error.message); return res.status(500).json({ error: container.error.message }); }
    const p = await fetch(`${IG_BASE}/${IG_USER_ID}/media_publish`, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ creation_id: container.id, access_token: IG_TOKEN }) });
    const published = await p.json();
    if (published.error) { await logAgent("INSTAGRAM","error",published.error.message); return res.status(500).json({ error: published.error.message }); }
    await logAgent("INSTAGRAM","success",`Posted: ${published.id}`);
    return res.json({ success: true, post_id: published.id });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});
instagramRouter.get("/test", async (req, res) => {
  try {
    const r = await fetch(`${IG_BASE}/${IG_USER_ID}?fields=id,username&access_token=${IG_TOKEN}`);
    return res.json(await r.json());
  } catch (err) { return res.status(500).json({ error: err.message }); }
});
