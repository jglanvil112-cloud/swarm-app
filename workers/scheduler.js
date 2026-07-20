// workers/scheduler.js — SWARM OS v6.1 — analytics→NANA, niche rotation, shopify fulfillment hook
// [FIX-1] extractTopPick() — safe string coercion kills [object Object]
// [FIX-2] generate_etsy_tags follow-up assembles siblings + queues file gen
// [NEW-1] generate_digital_file follow-up queues publish with file_url
// [NEW-2] publish follow-up logs live URL
// [NEW-3] Proactive Etsy token refresh in health check
import cron from "node-cron";
import{enqueueTask,claimNextTask,updateTaskStatus,updateSchedulerState,logAgent,recordHealth,saveAgentOutput,supabase}from"../lib/supabase.js";
import{executeTask,publishNextListing}from"../agents/executor.js";

const WORKER_ID="worker-"+(process.env.RENDER_INSTANCE_ID||"local")+"-"+Date.now();
const BASE_URL=process.env.BASE_URL||"https://swarm-app-3nch.onrender.com";
console.log("SWARM OS v6.0 — "+WORKER_ID);

function extractTopPick(result){
  const raw=result?.top_pick;
  if(!raw)return null;
  if(typeof raw==="string"&&raw.trim())return raw.trim();
  if(typeof raw==="object"){const v=raw.keyword??raw.top_pick??raw.title??raw.name??"";if(typeof v==="string"&&v.trim())return v.trim();}
  return null;
}

async function processAgentQueue(agent){
  try{
    const task=await claimNextTask(agent);if(!task)return;
    console.log("["+agent+"] Claimed: "+task.task_type+" ("+task.id+")");
    try{
      const result=await executeTask(task);
      if(result?.requires_approval){await updateTaskStatus(task.id,"awaiting_approval",result);await logAgent(agent,"Awaiting: "+task.task_type,"warn",result,task.id);}
      else{await updateTaskStatus(task.id,"completed",result);await enqueueFollowUps(task,result);}
    }catch(err){await updateTaskStatus(task.id,"failed",null,err.message);await logAgent(agent,"Failed: "+err.message,"error",null,task.id);}
  }catch(err){console.error("["+agent+"] Queue error:",err.message);}
}

async function retryFailedTasks(){
  try{
    const{data:failed,count}=await supabase.from("tasks").select("id",{count:"exact"}).eq("status","failed").lt("updated_at",new Date(Date.now()-120000).toISOString()).lt("priority",9);
    if(!count)return;
    await supabase.from("tasks").update({status:"pending",error:null,started_at:null,updated_at:new Date().toISOString()}).in("id",(failed||[]).map(t=>t.id));
    console.log("[RETRY] Reset "+count+" tasks");
  }catch(err){console.error("[RETRY]",err.message);}
}

async function getSiblingOutputs(parentId,types){
  if(!parentId)return{};
  const{data:siblings}=await supabase.from("tasks").select("id,task_type").eq("parent_task_id",parentId).in("task_type",types);
  if(!siblings?.length)return{};
  const ids=siblings.map(t=>t.id);
  const{data:outputs}=await supabase.from("agent_outputs").select("output_type,etsy_title,etsy_description,etsy_tags").in("task_id",ids);
  const map={};for(const o of(outputs||[]))map[o.output_type]=o;
  return map;
}

async function enqueueFollowUps(completedTask,result){
  const{task_type,id:taskId,parent_task_id:parentId}=completedTask;

  if(task_type==="trend_research"&&result?.top_pick){
    const kw=extractTopPick(result);
    if(!kw){console.warn("[PIPELINE] top_pick unextractable");return;}
    console.log("[PIPELINE] NANA → \""+kw+"\"");
    await enqueueTask({agent:"AISHA",task_type:"seo_generation",payload:{title:kw,keywords:result.trends?.map(t=>t.keyword)||[],platform:"etsy"},priority:3,parentTaskId:taskId});
    await enqueueTask({agent:"AMARA",task_type:"generate_etsy_title",payload:{keyword:kw},priority:3,parentTaskId:taskId});
    await enqueueTask({agent:"AMARA",task_type:"generate_etsy_description",payload:{keyword:kw},priority:3,parentTaskId:taskId});
    await enqueueTask({agent:"AMARA",task_type:"generate_etsy_tags",payload:{keyword:kw},priority:3,parentTaskId:taskId});
    await enqueueTask({agent:"AMARA",task_type:"generate_social_caption",payload:{keyword:kw},priority:4,parentTaskId:taskId});
  }

  if(task_type==="generate_etsy_title"&&result?.title)await saveAgentOutput({taskId,agent:"AMARA",outputType:"etsy_title",etsyTitle:result.title,confidence:result.confidence||0.8});
  if(task_type==="generate_etsy_description"&&result?.description)await saveAgentOutput({taskId,agent:"AMARA",outputType:"etsy_description",etsyDescription:result.description,confidence:result.confidence||0.8});
  if(task_type==="generate_social_caption"&&result?.caption)await saveAgentOutput({taskId,agent:"AMARA",outputType:"social_caption",socialCaption:result.caption,confidence:result.confidence||0.8});

  if(task_type==="generate_etsy_tags"&&result?.tags){
    await saveAgentOutput({taskId,agent:"AMARA",outputType:"etsy_tags",etsyTags:result.tags,confidence:result.confidence||0.8});
    if(!parentId){console.warn("[PIPELINE] generate_etsy_tags: no parent_task_id");return;}
    const sib=await getSiblingOutputs(parentId,["generate_etsy_title","generate_etsy_description"]);
    const titleRow=sib["etsy_title"];const descRow=sib["etsy_description"];
    if(!titleRow||!descRow){console.warn("[PIPELINE] Missing title/desc siblings — will retry");return;}
    console.log("[PIPELINE] All content ready → queuing file gen");
    await enqueueTask({agent:"AMARA",task_type:"generate_digital_file",payload:{keyword:titleRow.etsy_title,title:titleRow.etsy_title,description:descRow.etsy_description,tags:result.tags,price:4.99},priority:2,parentTaskId:parentId});
  }

  if(task_type==="generate_digital_file"){
    if(!parentId){console.warn("[PIPELINE] generate_digital_file: no parent");return;}
    const sib=await getSiblingOutputs(parentId,["generate_etsy_title","generate_etsy_description","generate_etsy_tags"]);
    const title=sib["etsy_title"]?.etsy_title;const description=sib["etsy_description"]?.etsy_description;const tags=sib["etsy_tags"]?.etsy_tags;
    if(!title||!description||!tags){console.warn("[PIPELINE] generate_digital_file: missing content siblings");return;}
    console.log("[PIPELINE] File ready → queuing publish: \""+title+"\"");
    await enqueueTask({agent:"AISHA",task_type:"publish_etsy_listing",payload:{title,description,tags,price:4.99,file_url:result.file_url||null,file_name:result.file_name||"digital-download.svg"},priority:1,parentTaskId:parentId});
  }

  if(task_type==="publish_etsy_listing"&&result?.published){
    await logAgent("AISHA","LIVE: "+result.url+" | file:"+result.file_attached,"success",result,taskId);
    await saveAgentOutput({taskId,agent:"AISHA",outputType:"etsy_listing_published",etsyTitle:result.url,confidence:1.0});
    console.log("[PIPELINE] LISTING LIVE: "+result.url);
    // Analytics feedback loop — SEUN reports back so NANA can refine next scan
    await enqueueTask({agent:"SEUN",task_type:"analytics_report",payload:{period:"last_hour",trigger:"listing_published"},priority:3,parentTaskId:taskId}).catch(()=>{});
    // Shopify fulfillment hook — KOFI checks inventory after each listing
    await enqueueTask({agent:"KOFI",task_type:"inventory_check",payload:{trigger:"post_publish",listing_url:result.listing_id},priority:4,parentTaskId:taskId}).catch(()=>{});
  }

  if(task_type==="seo_generation"&&result?.title)await enqueueTask({agent:"AMARA",task_type:"social_caption",payload:{product:result.title,platform:"instagram",count:3},priority:4,parentTaskId:taskId});
  if(task_type==="analytics_report"&&result?.underperformers?.length>0){
    await enqueueTask({agent:"KWAME",task_type:"sales_optimization",payload:{sales:result},priority:4,parentTaskId:taskId});
    // Feed analytics back to NANA — pivot to better niches based on what's underperforming
    const hour=new Date().getUTCHours();const startIdx=((hour+7)*3)%NICHE_POOL.length;
    const pivotCats=NICHE_POOL.slice(startIdx,startIdx+3);
    for(const cat of pivotCats)await enqueueTask({agent:"NANA",task_type:"trend_research",payload:{category:cat,context:"analytics_pivot"},priority:2});
  }
  if(task_type==="inventory_check"&&result?.status==="critical")await enqueueTask({agent:"ZARA",task_type:"inventory_check",payload:{low_stock:result.low_stock,context:"critical_alert"},priority:1,parentTaskId:taskId});
}

const NICHE_POOL=["wall art","digital prints","home decor","affirmation prints","black art","luxury quote prints","motivational wall art","minimalist line art","gothic wall decor","abstract art prints","botanical prints","celestial art","feminist art prints","dad jokes prints","boho decor"];
async function runHourlyTrendScan(){
  const hour=new Date().getUTCHours();const startIdx=(hour*3)%NICHE_POOL.length;const cats=[...NICHE_POOL.slice(startIdx,startIdx+5),...NICHE_POOL.slice(0,Math.max(0,5-(NICHE_POOL.length-startIdx)))].slice(0,5);
  for(const c of cats)await enqueueTask({agent:"NANA",task_type:"trend_research",payload:{category:c},priority:3});
  await updateSchedulerState("hourly_trend_scan","ok");
}
async function runHourlyInventoryCheck(){await enqueueTask({agent:"KOFI",task_type:"inventory_check",payload:{},priority:2});await updateSchedulerState("hourly_inventory_check","ok");}
async function runHourlyOrderMonitor(){await syncEtsyRevenue().catch(()=>{});await enqueueTask({agent:"SEUN",task_type:"analytics_report",payload:{period:"last_hour"},priority:2});await updateSchedulerState("hourly_order_monitor","ok");}
async function runDailySEO(){
  const{data:trends}=await supabase.from("trends").select("*").order("score",{ascending:false}).limit(5);
  if(trends?.length)for(const t of trends)await enqueueTask({agent:"AISHA",task_type:"seo_generation",payload:{title:t.keyword,keywords:[t.keyword],platform:"etsy"},priority:4});
  await updateSchedulerState("daily_seo_generation","ok");
}
async function runDailyAnalytics(){
  await enqueueTask({agent:"SEUN",task_type:"analytics_report",payload:{period:"last_24_hours"},priority:3});
  await enqueueTask({agent:"ABENA",task_type:"financial_report",payload:{period:"today"},priority:4});
  await updateSchedulerState("daily_analytics_report","ok");
}
async function runWeeklyCampaign(){await enqueueTask({agent:"AMARA",task_type:"marketing_campaign",payload:{goal:"weekly_review"},priority:5});await updateSchedulerState("weekly_campaign_review","ok");}
async function runWeeklyAudit(){
  await enqueueTask({agent:"KWAME",task_type:"sales_optimization",payload:{context:"weekly_audit"},priority:5});
  await enqueueTask({agent:"DELE",task_type:"pricing_analysis",payload:{context:"weekly_review"},priority:5});
  await updateSchedulerState("weekly_product_audit","ok");
}

async function runHealthCheck(){
  for(const svc of["anthropic","supabase","shopify","etsy"]){
    try{const start=Date.now();const r=await fetch(BASE_URL+"/api/health/"+svc,{signal:AbortSignal.timeout(8000)});const d=await r.json();await recordHealth(svc,d.status==="ok"?"ok":"fail",Date.now()-start,d);}
    catch(e){await recordHealth(svc,"fail",null,{error:e.message});}
  }
  try{
    const{data:row}=await supabase.from("oauth_tokens").select("expires_at").eq("platform","etsy").maybeSingle();
    if(row?.expires_at){const h=(new Date(row.expires_at)-Date.now())/3600000;if(h<2){console.log("[healthCheck] Etsy token expires in "+h.toFixed(1)+"h — refreshing");await fetch(BASE_URL+"/api/etsy/refresh-token",{method:"POST"}).catch(e=>console.warn("[healthCheck] Refresh failed:",e.message));}}
  }catch(e){console.warn("[healthCheck] Token check failed:",e.message);}
}

const AGENTS=["NANA","KOFI","AMARA","KWAME","FATIMA","SEUN","AISHA","IBRAHIM","ZARA","DELE","IMANI","ABENA"];
async function runWorkerLoop(){for(const agent of AGENTS)await processAgentQueue(agent);}

cron.schedule("*/30 * * * * *",runWorkerLoop);
cron.schedule("*/5 * * * *",retryFailedTasks);
cron.schedule("*/10 * * * *",async()=>{const r=await publishNextListing().catch(e=>({queued:0}));if(r.queued>0)console.log("[PUBLISH-QUEUE] "+r.queued);});
cron.schedule("0 */4 * * *",runHourlyTrendScan);
cron.schedule("5 * * * *",runHourlyInventoryCheck);
cron.schedule("10 * * * *",runHourlyOrderMonitor);
cron.schedule("0 6 * * *",runDailySEO);
cron.schedule("15 6 * * *",runDailyAnalytics);
cron.schedule("0 7 * * 1",runWeeklyCampaign);
cron.schedule("30 7 * * 1",runWeeklyAudit);
cron.schedule("*/15 * * * *",runHealthCheck);
cron.schedule("*/8 * * * *",async()=>{ try{ const r=await reseoTop20Tick(3); if(r&&r.processed) console.log("[RESEO-TOP20] +"+r.processed+(r.quota_hit?" (429 — will resume after reset)":"")); }catch(e){} });

(async()=>{
  try{
    const since=new Date(Date.now()-1800000).toISOString();
    const{count}=await supabase.from("tasks").select("*",{count:"exact",head:true}).eq("status","pending").gt("created_at",since);
    if((count||0)<3){console.log("[SEED] "+count+" recent pending — seeding");await runHourlyTrendScan();await runDailyAnalytics();console.log("[SEED] Done");}
    else console.log("[SEED] "+count+" pending exist — skipping");
  }catch(e){console.error("[SEED]",e.message);}
})();

console.log("SWARM OS v6.0: All cron jobs registered");

// ─── IBRAHIM Social Media Agent — Phase 2 AUTO-POSTING ───────────────────────
import { runAutoPublish, takeFollowerSnapshot, generateCEOReport, generateAndSchedulePosts } from "../routes/ibrahim.js";
import { backfillNextListingFiles } from "../routes/etsy.js";
import { assignNextSections } from "../routes/etsy.js";
import { createQueuedBundles, runShopRolloutTick, syncEtsyRevenue, reseoTop20Tick } from "../routes/etsy.js";
import { generateMissingFormats } from "../routes/etsy.js";
import { archiveTextOnlyTick } from "../routes/etsy.js";

// One-time Etsy sweep: archive words-only digital listings (vision-classified). Runs every 10 min
// in small batches until the whole active catalog is scanned, then flips a done-flag and idles forever.
cron.schedule("4-59/10 * * * *", async () => {
  try { const r = await archiveTextOnlyTick(12); if (r?.archived) console.log(`[ARCHIVE-TEXT-ONLY] 📦 ${r.archived} archived (offset ${r.offset})`); }
  catch (e) { console.error("[ARCHIVE-TEXT-ONLY]", e.message); }
});

// ─── Canva pipeline: gated publisher (KWAME) ─────────────────────────────────
import { drainPublishQueue } from "../agents/publisher.js";
// Every 5 min: activate ONLY publish_queue rows a human flipped to 'approved'.
cron.schedule("*/5 * * * *", async () => {
  try { const r = await drainPublishQueue(5); if (r?.processed > 0) console.log(`[KWAME] ✅ Published ${r.processed} approved listing(s)`); }
  catch (e) { console.error("[KWAME] publish queue error:", e.message); }
});

// Every 2 min: attach a small batch of digital files to listings missing them (overnight backfill + ongoing prevention)
cron.schedule("*/12 * * * *", () => { backfillNextListingFiles(5).catch(()=>{}); }); // throttled: stay under Etsy daily quota
// Every 3 min: organize listings into shop sections (collections), a small batch at a time
cron.schedule("*/14 * * * *", () => { assignNextSections(5).catch(()=>{}); }); // throttled: stay under Etsy daily quota
// Every 20 min: create queued bundle DRAFTS (dedup by draft title; 429s harmlessly until quota resets, then idles)
cron.schedule("*/20 * * * *", () => { createQueuedBundles().catch(()=>{}); });
// Every 7 min: roll SEO + framed mockup across active listings (only when enabled via /rollout-start); idles when done
cron.schedule("*/7 * * * *", () => { runShopRolloutTick().catch(()=>{}); });
// Every 8 min: generate one missing format-variant set (CDN source, no Etsy quota); idles when all 5 done
cron.schedule("*/8 * * * *", () => { generateMissingFormats().catch(()=>{}); });

// Every 5 min: check for scheduled posts due and auto-publish
cron.schedule("*/5 * * * *", async () => {
  try {
    const result = await runAutoPublish();
    if (result?.published > 0) console.log(`[IBRAHIM] ✅ Auto-published ${result.published} post(s) to @houseofjreym`);
    if (result?.paused) console.log(`[IBRAHIM] ⏸ Auto-publish paused: ${result.reason}`);
  } catch(e) { console.error("[IBRAHIM] Auto-publish error:", e.message); }
});

// Every 6 hours: generate and schedule next 10 posts if queue is low
cron.schedule("0 */6 * * *", async () => {
  console.log("[IBRAHIM] Checking content queue...");
  try {
    const { count } = await supabase.from("social_posts")
      .select("id", { count: "exact", head: true })
      .eq("platform", "instagram").eq("status", "scheduled");
    if ((count || 0) < 6) {
      console.log(`[IBRAHIM] Queue low (${count} scheduled) — generating 10 new posts`);
      await generateAndSchedulePosts(10);
    } else {
      console.log(`[IBRAHIM] Queue healthy: ${count} posts scheduled`);
    }
  } catch(e) { console.error("[IBRAHIM] Queue refill error:", e.message); }
});

// Daily 6 AM UTC (2am EST): follower snapshot
cron.schedule("0 6 * * *", async () => {
  console.log("[IBRAHIM] Taking follower snapshot...");
  try { await takeFollowerSnapshot(); }
  catch(e) { console.error("[IBRAHIM] Follower snapshot error:", e.message); }
});

// Daily 7 AM UTC (3am EST): CEO daily report
cron.schedule("0 7 * * *", async () => {
  console.log("[IBRAHIM] Generating CEO daily report...");
  try { await generateCEOReport(); }
  catch(e) { console.error("[IBRAHIM] CEO report error:", e.message); }
});

// Every 4 hours: sync analytics on published posts
cron.schedule("30 */4 * * *", async () => {
  try {
    const { data: posts } = await supabase.from("social_posts")
      .select("id,ig_post_id").eq("platform","instagram").eq("status","published")
      .gte("published_at", new Date(Date.now()-86400000*3).toISOString()).limit(20);
    if (posts?.length) console.log(`[IBRAHIM] Analytics sync: ${posts.length} posts`);
  } catch(e) { console.error("[IBRAHIM] Analytics sync error:", e.message); }
});

// ─── Stale-task reclaimer ────────────────────────────────────────────────────
// Workers that die mid-task leave rows stuck in 'running' forever (claimed, never
// released). Every 10 min: reset 'running' tasks idle > 30 min back to 'pending'
// for retry. After 3 reclaims a task is marked 'failed' to avoid poison loops.
cron.schedule("*/10 * * * *", async () => {
  try {
    const STALE_MS = 30 * 60 * 1000;
    const cutoff = new Date(Date.now() - STALE_MS).toISOString();
    const { data: stuck } = await supabase
      .from("tasks")
      .select("id, result")
      .eq("status", "running")
      .lt("started_at", cutoff)
      .limit(50);
    if (!stuck?.length) return;
    let requeued = 0, failed = 0;
    for (const t of stuck) {
      const reclaims = ((t.result && t.result._reclaims) || 0) + 1;
      if (reclaims > 3) {
        await supabase.from("tasks").update({
          status: "failed",
          error: `stale: reclaimed ${reclaims - 1}x without completing`,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", t.id);
        failed++;
      } else {
        await supabase.from("tasks").update({
          status: "pending",
          started_at: null,
          result: { ...(t.result || {}), _reclaims: reclaims },
          updated_at: new Date().toISOString(),
        }).eq("id", t.id);
        requeued++;
      }
    }
    console.log(`[RECLAIMER] stale running tasks → requeued ${requeued}, failed ${failed}`);
  } catch (e) { console.error("[RECLAIMER] error:", e.message); }
});

console.log("[IBRAHIM] Phase 2 AUTO-POSTING cron jobs registered ✅");

// ─── One-shot (7/8): re-slot every scheduled post onto 13:00/15:00 UTC daytime slots ──
import { nextDaytimeSlot } from "../routes/ibrahim.js";
(async()=>{try{
  const{data:g}=await supabase.from("scheduler_state").select("run_count").eq("job_name","reslot_posts_v1").limit(1);
  if(g?.length)return;
  await updateSchedulerState("reslot_posts_v1","started");
  const{data:rows}=await supabase.from("social_posts").select("id,scheduled_for").eq("status","scheduled").order("scheduled_for",{ascending:true});
  if(rows?.length){
    let cursor=new Date();
    for(const r of rows){const slot=nextDaytimeSlot(cursor);await supabase.from("social_posts").update({scheduled_for:slot.toISOString(),updated_at:new Date().toISOString()}).eq("id",r.id);cursor=slot;}
    console.log("[RESLOT] Redistributed "+rows.length+" scheduled posts onto 13:00/15:00 UTC slots");
    await logAgent("IBRAHIM","Re-slotted "+rows.length+" queued posts — everything now lands 9am/11am ET, nothing after","success");
  }
  await updateSchedulerState("reslot_posts_v1","ok");
}catch(e){console.error("[RESLOT]",e.message);}})();


// ─── PODGEN trend auto-drop: NANA top_pick → full closed loop, 3x/day ─────────
// Gen at 05/09/12 UTC; buy-link post auto-schedules +3h → 08/12/15 UTC = 4am/8am/11am ET.
// Same runPodGen path = IP gate, 250-cap, and IBRAHIM 4/day posting cap all apply.
import { runPodGen } from "../routes/podgen.js";
const PODGEN_FLAVORS={1:"New Year renewal",2:"Black History Month tribute",3:"spring awakening",6:"Juneteenth heritage",7:"summer block party",9:"harvest gratitude",10:"Afro-gothic autumn",11:"Thanksgiving legacy",12:"Kwanzaa celebration"};
const PODGEN_STYLES=["design","art"];
const PODGEN_FALLBACK=["Sankofa Wisdom","Melanin Queen","Ancestral Power","Diaspora Roots","Kente Heritage","Black Love","Golden Heritage","Afro Muse"];
async function runPodgenTrendDrop(slot){
  try{
    const{data}=await supabase.from("tasks").select("result").eq("task_type","trend_research").eq("status","completed").order("updated_at",{ascending:false}).limit(1);
    const pick=extractTopPick(data?.[0]?.result||{});
    const flavor=PODGEN_FLAVORS[new Date().getUTCMonth()+1]||"pop-culture moment";
    const fallback=PODGEN_FALLBACK[(Math.floor(Date.now()/86400000)+slot)%PODGEN_FALLBACK.length];
    let r=await runPodGen({theme:`deep symbolic ${pick||fallback} — unique ${flavor} edition`,style:PODGEN_STYLES[slot%3]});
    if(r?.reason==="theme tripped IP blocklist")r=await runPodGen({theme:`deep symbolic ${fallback} — unique ${flavor} edition`,style:PODGEN_STYLES[slot%3]});
    console.log("[PODGEN-TREND] slot "+slot+" → "+(r?.uid||"fail")+" "+(r?.status||r?.reason||""));
  }catch(e){console.error("[PODGEN-TREND]",e.message);}
}
cron.schedule("0 5 * * *",()=>runPodgenTrendDrop(0));
cron.schedule("0 9 * * *",()=>runPodgenTrendDrop(1));
cron.schedule("0 12 * * *",()=>runPodgenTrendDrop(2));
console.log("[PODGEN-TREND] 3x/day trend auto-drop registered (05/09/12 UTC → posts by 11am ET) ✅");

// ── CEO 2026-07-20: ONE-TIME 24-PRODUCT TRENDING DROP ────────────────────────
// Fires once on the next boot: 24 fresh products across the brand's Afrocentric
// core, optical illusions, this month's culture theme, and 2026's best-selling
// wall-art aesthetics. Each flows the full loop (fal.ai -> IP gate -> HOJ Shopify
// publish, watermarked, Classic/3D/Holographic, 250-cap -> auto buy-link post),
// and the Etsy sync ticks mirror them to Etsy. Latched via scheduler_state so it
// never repeats. Staggered 90s after boot so startup isn't starved.
import { bulkTrendDrop } from "../routes/podgen.js";
(async () => {
  try {
    const { data: g } = await supabase.from("scheduler_state").select("run_count").eq("job_name", "trend_drop_24b_0720").limit(1);
    if (g && g.length) return;
    await updateSchedulerState("trend_drop_24b_0720", "started");
    setTimeout(async () => {
      try {
        await logAgent("AMARA", "24-product trending drop starting (Afrocentric + optical illusion + culture + 2026 best-sellers)", "info");
        const r = await bulkTrendDrop({ count: 24 });
        await updateSchedulerState("trend_drop_24b_0720", "ok");
        await logAgent("AMARA", `24-product trending drop finished: ${r.made} live of ${r.count}`, r.made ? "success" : "warn");
      } catch (e) { console.error("[TREND-DROP-24]", e.message); }
    }, 90000);
  } catch (e) { console.error("[TREND-DROP-24 seed]", e.message); }
})();
console.log("[TREND-DROP-24] one-time trending drop seed armed ✅");
