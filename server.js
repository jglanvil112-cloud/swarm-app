import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, "dist")));

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const AGENTS = {
  SWARMX_PRIME: `You are SWARMX PRIME, supreme orchestrator of HOUSE OF JREYM — an autonomous AI Etsy commerce empire. Maximize profit. Coordinate all agents. Respond ONLY in JSON: {"decisions":[],"delegations":[],"priority":"","reasoning":""}`,
  TREND_HUNTER: `You are TREND HUNTER for HOUSE OF JREYM Etsy business. Find viral niches before they peak. Respond ONLY in JSON: {"trends":[{"niche":"","score":0,"opportunity":"","urgency":""}],"topNiche":"","action":""}`,
  PRODUCT_FORG  PRODUCT_FORG  PRODUCT_FORG  PRODUCT_FORG  PRODUCT_FORG  PRODUCT_-on-demand Etsy product ideas. Respond ONLY in JSON: {"products":[{"title":"  PRODUCT_FORG  PRODUCT"p  PRODUCT_FORG  PROmatedR  PRODUCT_FORG  PRODUCT_FORG  PRu are SEO AGENT for HOUSE OF JREYM. Optimize Etsy listings for page 1 ranking. Respond ONLY in JSON: {"title":"","tags":[],"d  PRODUCT_FORG  PRODUCTKe  PRODUCT_FORG ingScore":0}`,
  DESIGN_AGENT: `You are DESIGN AGENT for HOUSE OF JREYM. Create Midjourney prompts and design briefs. Respond ONLY i  DESIGN_AGENT:ur  DESIGN_AGENT: `You are DESIGN AGENT for HOUSE OF JREYM. Create Midjourney prompts and design briefs. Respond ONLY i  DESIGN_AGENT:ur  DESIGN_AGENT: `You are DESIGN AGENT for HOUSE OF JREYM. Create Midjourney prompts and design briefs. Respond O:[  DESIGN_AGENT: `You are DESIGN AGENT for HOUSE OF JREYM. Create Midjourney prompts and design briefs. Respond ONLY i  DESIGN_AGENT:ur  DESIGN_AGENT: `You are DESIGN AGENT for HOUSE OF JREYM. Create Miderformers":[],"recomme  DESIGN_AGENT: `You are DESIGN AGENT for HOUSE OF JREYM. Create Midjourney prompts and design briefs. Respond ONLY i  DESIGN_AGENT:ur  DESIGN_AGENT: `You are DESIGN AGENT for HOUSE OF JREYM. Create Midjourney prompts and design briefs. Respond ONLY i  DESIGN_AGENT:ur  DESIGN_AGENT: `You are DESIGN AGENT for HOUSE OF JREYM. Create Midjourney prompts and design briefs. Respond O:[  DESIGN_AGENT: `You are DESIGN AGvi
cd /Users/jamellglanville/Downloads/swarm-app && git add . && git commit -m "HOJ 10-agent backend direct write" && git push

