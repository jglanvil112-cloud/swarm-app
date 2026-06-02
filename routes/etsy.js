// routes/etsy.js — SWARM OS v6.1 — getEtsyToken .catch bug fixed
import express from "express";
import crypto from "crypto";
import{supabase,logAgent,enqueueTask}from"../lib/supabase.js";
export const etsyRouter=express.Router();

const ETSY_KEY=process.env.ETSY_KEY||"06k7svc5tbl35c6oh7k399ak";
const ETSY_SECRET=process.env.ETSY_SECRET||"";
const ETSY_SHOP=process.env.SHOP_NAME||"HOUSEOFJREYM";
const ETSY_SHOP_ID=process.env.ETSY_SHOP_ID||"";
const APP_URL=process.env.APP_URL||"https://swarm-app-3nch.onrender.com";
const ETSY_BASE="https://openapi.etsy.com/v3/application";
const REDIRECT_URI=APP_URL+"/api/etsy/callback";
const oauthStates=new Map();

async function getEtsyToken(){
  try{
    const{data,error}=await supabase.from("oauth_tokens").select("access_token,refresh_token,expires_at").eq("platform","etsy").single();
    if(!error&&data?.access_token){
      if(data.expires_at&&new Date(data.expires_at)<new Date())return refreshEtsyToken(data.refresh_token);
      return data.access_token;
    }
  }catch(e){/* no row yet — fall through to env */}
  return process.env.ETSY_ACCESS_TOKEN||null;
}

async function refreshEtsyToken(refreshToken){
  const rt=refreshToken||process.env.ETSY_REFRESH_TOKEN;
  if(!rt)throw new Error("No refresh token — visit /api/etsy/auth");
  const r=await fetch("https://api.etsy.com/v3/public/oauth/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"refresh_token",client_id:ETSY_KEY,refresh_token:rt})});
  const data=await r.json();
  if(!data.access_token)throw new Error("Token refresh failed: "+JSON.stringify(data));
  await supabase.from("oauth_tokens").upsert({platform:"etsy",access_token:data.access_token,refresh_token:data.refresh_token||rt,expires_at:new Date(Date.now()+data.expires_in*1000).toISOString(),updated_at:new Date().toISOString()},{onConflict:"platform"});
  return data.access_token;
}

function authH(t){return{Authorization:"Bearer "+t,"x-api-key":ETSY_KEY+":"+ETSY_SECRET,"Content-Type":"application/json"};}
function pubH(){return{"x-api-key":ETSY_KEY+":"+ETSY_SECRET};}

etsyRouter.get("/auth",(req,res)=>{
  const verifier=crypto.randomBytes(32).toString("base64url");
  const challenge=crypto.createHash("sha256").update(verifier).digest("base64url");
  const state=crypto.randomBytes(16).toString("hex");
  oauthStates.set(state,{verifier,createdAt:Date.now()});
  const scopes="listings_r listings_w listings_d transactions_r transactions_w billing_r profile_r shops_r shops_w".split(" ").join("%20");
  res.redirect("https://www.etsy.com/oauth/connect?response_type=code&redirect_uri="+encodeURIComponent(REDIRECT_URI)+"&scope="+scopes+"&client_id="+ETSY_KEY+"&state="+state+"&code_challenge="+challenge+"&code_challenge_method=S256");
});

etsyRouter.get("/callback",async(req,res)=>{
  const{code,state}=req.query;
  const stored=oauthStates.get(state);
  if(!stored)return res.status(403).json({error:"Invalid or expired OAuth state"});
  oauthStates.delete(state);
  try{
    const tr=await fetch("https://api.etsy.com/v3/public/oauth/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"authorization_code",client_id:ETSY_KEY,redirect_uri:REDIRECT_URI,code,code_verifier:stored.verifier})});
    const td=await tr.json();
    if(!td.access_token)return res.status(500).json({error:"Token exchange failed",detail:td});
    console.log("[ETSY-TOKEN-SAVED]",td.access_token?.slice(0,12),"expires_in:",td.expires_in);
    const{error:saveErr}=await supabase.from("oauth_tokens").upsert({platform:"etsy",access_token:td.access_token,refresh_token:td.refresh_token,expires_at:new Date(Date.now()+td.expires_in*1000).toISOString(),updated_at:new Date().toISOString()},{onConflict:"platform"});if(saveErr)throw new Error("Token save failed: "+saveErr.message);
    await logAgent("AISHA","Etsy OAuth completed","success");
    res.redirect("/swarm_shop_os_v5.html?etsy=connected");
  }catch(err){console.error("[ETSY-CALLBACK-ERROR]",err.message,JSON.stringify(err));res.status(500).json({error:err.message});}
});

etsyRouter.post("/refresh-token",async(req,res)=>{
  try{const t=await refreshEtsyToken();res.json({ok:true,preview:t.slice(0,12)+"..."});}
  catch(err){res.status(500).json({ok:false,error:err.message});}
});

etsyRouter.get("/shop-id",async(req,res)=>{
  try{
    const t=await getEtsyToken();
    const r=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP,{headers:t?authH(t):pubH()});
    if(!r.ok)return res.status(r.status).json({error:"Etsy "+r.status});
    const d=await r.json();
    res.json({shop_id:d.shop_id,shop_name:d.shop_name,hint:"Add as ETSY_SHOP_ID in Render env"});
  }catch(e){res.status(500).json({error:e.message});}
});

etsyRouter.get("/shop",async(req,res)=>{
  try{
    const t=await getEtsyToken();
    const r=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP,{headers:t?authH(t):pubH()});
    if(!r.ok){const e=await r.text();return res.status(r.status).json({error:"Etsy "+r.status,detail:e.slice(0,300)});}
    res.json(await r.json());
  }catch(e){res.status(500).json({error:e.message});}
});

etsyRouter.get("/listings",async(req,res)=>{
  try{
    const t=await getEtsyToken();
    const r=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP+"/listings/active?limit="+(req.query.limit||25)+"&includes=Images",{headers:t?authH(t):pubH()});
    if(!r.ok){const e=await r.text();return res.status(r.status).json({error:"Etsy "+r.status,detail:e.slice(0,300)});}
    const data=await r.json();
    if(data.results?.length)for(const l of data.results)await supabase.from("products").upsert({external_id:String(l.listing_id),platform:"etsy",title:l.title,description:l.description?.slice(0,1000),tags:l.tags||[],price:l.price?l.price.amount/l.price.divisor:0,status:l.state,updated_at:new Date().toISOString()},{onConflict:"external_id,platform"});
    res.json(data);
  }catch(e){res.status(500).json({error:e.message});}
});

etsyRouter.post("/publish",async(req,res)=>{
  const{title,description,tags=[],price,shop_id}=req.body;
  const sid=shop_id||ETSY_SHOP_ID;
  const missing=["title","description","price"].filter(f=>!req.body[f]);
  if(missing.length)return res.status(400).json({error:"Missing: "+missing.join(", ")});
  if(!sid)return res.status(400).json({error:"shop_id required — add ETSY_SHOP_ID to Render env (GET /api/etsy/shop-id)"});
  if(!tags.length)return res.status(400).json({error:"tags array empty"});
  try{
    const t=await getEtsyToken();
    if(!t)return res.status(401).json({error:"Not authenticated — visit /api/etsy/auth"});
    const body={title:String(title).slice(0,140),description:String(description),price:parseFloat(price),quantity:999,who_made:"i_did",when_made:"made_to_order",is_supply:false,taxonomy_id:2078,tags:tags.slice(0,13),state:"active",type:"download",is_digital:true};
    const r=await fetch(ETSY_BASE+"/shops/"+sid+"/listings",{method:"POST",headers:authH(t),body:JSON.stringify(body)});
    const listing=await r.json();
    if(!r.ok){await logAgent("AISHA","Listing failed: "+(listing?.error||r.status),"error");return res.status(502).json({error:"Etsy listing failed",details:listing});}
    await logAgent("AISHA","Listed: "+body.title+" ("+listing.listing_id+")","success");
    return res.json({success:true,listing_id:listing.listing_id,url:"https://www.etsy.com/listing/"+listing.listing_id,title:body.title,tags:body.tags});
  }catch(err){res.status(500).json({error:err.message});}
});

etsyRouter.post("/upload-file",async(req,res)=>{
  const{listing_id,file_url,file_name,mime_type}=req.body;
  const sid=req.body.shop_id||ETSY_SHOP_ID;
  if(!listing_id)return res.status(400).json({error:"listing_id required"});
  if(!sid)return res.status(400).json({error:"shop_id required"});
  if(!file_url)return res.status(400).json({error:"file_url required"});
  try{
    const t=await getEtsyToken();
    if(!t)return res.status(401).json({error:"Not authenticated"});
    const fileRes=await fetch(file_url,{signal:AbortSignal.timeout(30000)});
    if(!fileRes.ok)return res.status(502).json({error:"Could not fetch file: "+fileRes.status});
    const fileBuffer=Buffer.from(await fileRes.arrayBuffer());
    const resolvedMime=mime_type||fileRes.headers.get("content-type")||"image/svg+xml";
    const resolvedName=file_name||"digital-download.svg";
    const{default:FormData}=await import("form-data");
    const form=new FormData();
    form.append("file",fileBuffer,{filename:resolvedName,contentType:resolvedMime});
    form.append("name",resolvedName);form.append("rank","1");
    const up=await fetch(ETSY_BASE+"/shops/"+sid+"/listings/"+listing_id+"/files",{method:"POST",headers:{"x-api-key":ETSY_KEY,Authorization:"Bearer "+t,...form.getHeaders()},body:form});
    const upData=await up.json();
    if(!up.ok)return res.status(502).json({error:"File upload failed",details:upData});
    await logAgent("AISHA","File attached to "+listing_id,"success");
    res.json({success:true,listing_id,file_id:upData.listing_file_id,file_name:resolvedName});
  }catch(err){res.status(500).json({error:err.message});}
});

etsyRouter.post("/listings",async(req,res)=>{
  const task=await enqueueTask({agent:"AISHA",task_type:"seo_generation",payload:{...req.body.listing,action:"create_listing",requires_approval:true},priority:2});
  res.json({queued:true,task_id:task.id});
});

etsyRouter.patch("/listings/:id",async(req,res)=>{
  try{
    const t=await getEtsyToken();
    if(!t)return res.status(401).json({error:"Not authenticated"});
    const r=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP+"/listings/"+req.params.id,{method:"PATCH",headers:authH(t),body:JSON.stringify(req.body)});
    res.status(r.status).json(await r.json());
  }catch(e){res.status(500).json({error:e.message});}
});

etsyRouter.get("/orders",async(req,res)=>{
  try{
    const t=await getEtsyToken();
    if(!t)return res.status(401).json({error:"Not authenticated"});
    const r=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP+"/receipts?limit=25",{headers:authH(t)});
    if(!r.ok){const e=await r.text();return res.status(r.status).json({error:"Etsy "+r.status,detail:e.slice(0,300)});}
    const data=await r.json();
    if(data.results?.length)for(const o of data.results)await supabase.from("revenue_events").upsert({platform:"etsy",order_id:String(o.receipt_id),amount:parseFloat(o.grandtotal?.amount||0)/100,recorded_at:new Date(o.create_timestamp*1000).toISOString()},{onConflict:"order_id"});
    res.json(data);
  }catch(e){res.status(500).json({error:e.message});}
});

etsyRouter.get("/reviews",async(req,res)=>{
  try{
    const r=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP+"/reviews?limit=10",{headers:pubH()});
    if(!r.ok)return res.status(r.status).json({error:"Etsy "+r.status});
    etsyRouter.get("/debug-ping",async(req,res)=>{try{const r=await fetch(ETSY_BASE+"/openapi-ping",{headers:{"x-api-key":ETSY_KEY}});const t=await r.text();res.json({status:r.status,key_used:ETSY_KEY.slice(0,8)+"...",secret_set:!!ETSY_SECRET,body:t});}catch(e){res.status(500).json({error:e.message});}});
    res.json(await r.json());
  }catch(e){res.status(500).json({error:e.message});}
});
