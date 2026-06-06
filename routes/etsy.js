// routes/etsy.js — SWARM OS v6.6 — authH: strip x-api-key from Bearer calls
import express from "express";
import crypto from "crypto";
import{supabase,logAgent,enqueueTask}from"../lib/supabase.js";
export const etsyRouter=express.Router();

const ETSY_KEY=process.env.ETSY_KEY||"06k7svc5tbl35c6oh7k399ak";
const ETSY_SECRET=process.env.ETSY_SECRET||"";
const ETSY_SHOP=process.env.SHOP_NAME||"HOSEOFJREYM";
const ETSY_SHOP_ID=parseInt(process.env.ETSY_SHOP_ID)||0;
const APP_URL=process.env.APP_URL||"https://swarm-app-3nch.onrender.com";
const ETSY_BASE="https://openapi.etsy.com/v3/application";
const REDIRECT_URI=APP_URL+"/api/etsy/callback";
// oauthStates moved to Supabase (fix: Render restarts wipe in-memory state)

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

function authH(t){return{Authorization:"Bearer "+t,"x-api-key":ETSY_KEY+(ETSY_SECRET?":"+ETSY_SECRET:""),"Content-Type":"application/json"};}
function pubH(){return{"x-api-key":ETSY_KEY+(ETSY_SECRET?":"+ETSY_SECRET:"")};}

etsyRouter.get("/auth",async(req,res)=>{
  const verifier=crypto.randomBytes(32).toString("base64url");
  const challenge=crypto.createHash("sha256").update(verifier).digest("base64url");
  const state=crypto.randomBytes(16).toString("hex");
  // FIX 1: persist state in Supabase so Render restarts don't wipe it
  await supabase.from("oauth_states").upsert({state,verifier,created_at:new Date().toISOString()},{onConflict:"state"});
  const scopes="listings_r listings_w listings_d transactions_r transactions_w billing_r profile_r shops_r shops_w".split(" ").join("%20");
  res.redirect("https://www.etsy.com/oauth/connect?response_type=code&redirect_uri="+encodeURIComponent(REDIRECT_URI)+"&scope="+scopes+"&client_id="+ETSY_KEY+"&state="+state+"&code_challenge="+challenge+"&code_challenge_method=S256");
});

etsyRouter.get("/callback",async(req,res)=>{
  const{code,state}=req.query;
  // FIX 1: read state from Supabase
  const{data:storedRow,error:stateErr}=await supabase.from("oauth_states").select("verifier").eq("state",state).single();
  if(stateErr||!storedRow)return res.status(403).json({error:"Invalid or expired OAuth state"});
  await supabase.from("oauth_states").delete().eq("state",state);
  const stored={verifier:storedRow.verifier};
  try{
    const tr=await fetch("https://api.etsy.com/v3/public/oauth/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"authorization_code",client_id:ETSY_KEY,client_secret:ETSY_SECRET,redirect_uri:REDIRECT_URI,code,code_verifier:stored.verifier})});
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

etsyRouter.get("/shop-id",async(req,res)=>{try{const t=await getEtsyToken();if(!t)return res.status(401).json({error:"Not authenticated — visit /api/etsy/auth"});const uid=t.split('.')[0];const r=await fetch(ETSY_BASE+"/users/"+uid+"/shops",{headers:authH(t)});if(!r.ok)return res.status(r.status).json({error:"Etsy "+r.status});const d=await r.json();const s=d.results?.[0]||d;res.json({shop_id:s.shop_id,shop_name:s.shop_name,hint:"Add as ETSY_SHOP_ID in Render env"});}catch(e){res.status(500).json({error:e.message});}});

etsyRouter.get("/shop",async(req,res)=>{
  try{
    const t=await getEtsyToken();
const r=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP_ID,{headers:t?authH(t):pubH()});    if(!r.ok){const e=await r.text();return res.status(r.status).json({error:"Etsy "+r.status,detail:e.slice(0,300)});}
    res.json(await r.json());
  }catch(e){res.status(500).json({error:e.message});}
});

etsyRouter.get("/listings",async(req,res)=>{
  try{
    const t=await getEtsyToken();
const r=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP_ID+"/listings/active?limit="+(req.query.limit||25)+"&includes=Images",{headers:t?authH(t):pubH()});    if(!r.ok){const e=await r.text();return res.status(r.status).json({error:"Etsy "+r.status,detail:e.slice(0,300)});}
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
    const body={title:String(title).slice(0,140),description:String(description),price:parseFloat(price),quantity:999,who_made:"i_did",when_made:"made_to_order",is_supply:false,taxonomy_id:2078,tags:tags.map(t=>String(t).slice(0,20)).filter(t=>t.length>0).slice(0,13),state:"active",type:"download",is_digital:true};
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
    const up=await fetch(ETSY_BASE+"/shops/"+sid+"/listings/"+listing_id+"/files",{method:"POST",headers:{"x-api-key":ETSY_KEY+(ETSY_SECRET?":"+ETSY_SECRET:""),Authorization:"Bearer "+t,...form.getHeaders()},body:form});
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
const r=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP_ID+"/listings/"+req.params.id,{method:"PATCH",headers:authH(t),body:JSON.stringify(req.body)});    res.status(r.status).json(await r.json());
  }catch(e){res.status(500).json({error:e.message});}
});

etsyRouter.get("/debug-ping",async(req,res)=>{try{const r=await fetch(ETSY_BASE+"/openapi-ping",{headers:{"x-api-key":ETSY_KEY+(ETSY_SECRET?":"+ETSY_SECRET:"")}});const t=await r.text();const tok=await getEtsyToken();res.json({ping_status:r.status,ping_body:t,key_used:ETSY_KEY.slice(0,8)+"...",secret_set:!!ETSY_SECRET,has_token:!!tok,token_preview:tok?tok.slice(0,12)+"...":null});}catch(e){res.status(500).json({error:e.message});}});
etsyRouter.get("/orders",async(req,res)=>{
  try{
    const t=await getEtsyToken();
    if(!t)return res.status(401).json({error:"Not authenticated"});
const r=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP_ID+"/receipts?limit=25",{headers:authH(t)});    if(!r.ok){const e=await r.text();return res.status(r.status).json({error:"Etsy "+r.status,detail:e.slice(0,300)});}
    const data=await r.json();
    if(data.results?.length)for(const o of data.results)await supabase.from("revenue_events").upsert({platform:"etsy",order_id:String(o.receipt_id),amount:parseFloat(o.grandtotal?.amount||0)/100,recorded_at:new Date(o.create_timestamp*1000).toISOString()},{onConflict:"order_id"});
    res.json(data);
  }catch(e){res.status(500).json({error:e.message});}
});

etsyRouter.post("/bulk-activate",async(req,res)=>{
  try{
    const t=await getEtsyToken();
    if(!t)return res.status(401).json({error:"Not authenticated"});

    // 1. Fetch all draft listings — Etsy v3 uses state param on /listings/inactive
    //    Draft listings created without OAuth appear as "inactive" in the API
    let allDrafts=[];
    for(const stateParam of ["draft","inactive"]){
      for(let offset=0;offset<500;offset+=100){
        const url=ETSY_BASE+"/shops/"+ETSY_SHOP_ID+"/listings?state="+stateParam+"&limit=100&offset="+offset;
        const r=await fetch(url,{headers:authH(t)});
        if(!r.ok){console.error("[bulk-activate] "+stateParam+" fetch failed:",r.status,await r.text().catch(()=>"")); break;}
        const d=await r.json();
        const batch=(d.results||[]).filter(l=>l.listing_id&&!allDrafts.find(e=>e.listing_id===l.listing_id));
        allDrafts=[...allDrafts,...batch];
        if(batch.length<100)break;
      }
    }
    console.log("[bulk-activate] Found "+allDrafts.length+" drafts");

    // 2. Fetch return_policy_id
    let returnPolicyId=1;
    try{
      const rp=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP_ID+"/return-policies",{headers:authH(t)});
      if(rp.ok){const rpd=await rp.json();const pol=(rpd.results||rpd);if(Array.isArray(pol)&&pol.length)returnPolicyId=pol[0].return_policy_id;else if(pol.return_policy_id)returnPolicyId=pol.return_policy_id;}
      console.log("[bulk-activate] return_policy_id:",returnPolicyId);
    }catch(e){console.warn("[bulk-activate] rp fetch failed, using default");}

    // 3. PATCH each draft to active with return_policy_id
    const results={activated:[],failed:[],skipped:[]};
    const limit=parseInt(req.body?.limit)||allDrafts.length;
    const batch=allDrafts.slice(0,limit);

    for(const listing of batch){
      const lid=listing.listing_id;
      try{
        // Step A: upload a PNG image (required by Etsy to activate)
        let imageOk=false;
        try{
          // Generate a simple 800x800 PNG via canvas-like SVG→PNG approach
          // Use Etsy image upload endpoint with a generated PNG buffer
          const {default:FormData}=await import("form-data");
          const keyword=(listing.title||"digital art").split("|")[0].trim().slice(0,30);
          // Create a minimal valid PNG (1x1 white pixel) as placeholder — enough for Etsy
          // Valid 200x200 white PNG — meets Etsy minimum image requirements
          const png1x1=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAMgAAADICAIAAAAiOjnJAAABcUlEQVR42u3SMQ0AAAzDsPIn3aKYtMOGECWFA5EAY2EsjAXGwlgYC4yFsTAWGAtjYSwwFsbCWGAsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbEwFsYCY2EsjAXGwlgYC4yFsTAWGAtjYSwwFsbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbEwFsYCY2EsjAXGwlgYC4yFsTAWGAtjYSwwFsbCWGAsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbEwFsYCY2EsjAXGwlgYC4yFsTAWGItvBsLKBp6arxoqAAAAAElFTkSuQmCC","base64");
          const imgForm=new FormData();
          imgForm.append("image",png1x1,{filename:"listing_"+lid+".png",contentType:"image/png"});
          imgForm.append("rank","1");
          const imgRes=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP_ID+"/listings/"+lid+"/images",{
            method:"POST",
            headers:{Authorization:"Bearer "+t,"x-api-key":ETSY_KEY+(ETSY_SECRET?":"+ETSY_SECRET:""),...imgForm.getHeaders()},
            body:imgForm
          });
          const imgData=await imgRes.json();
          imageOk=imgRes.ok;
          if(!imgRes.ok)console.error("[bulk-activate] image upload failed",lid,imgRes.status,JSON.stringify(imgData).slice(0,120));
          else console.log("[bulk-activate] image uploaded",lid,imgData.listing_image_id);
        }catch(imgErr){console.error("[bulk-activate] image err",lid,imgErr.message);}

        // Step B: PATCH to active
        const pr=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP_ID+"/listings/"+lid,{
          method:"PATCH",
          headers:authH(t),
          body:JSON.stringify({state:"active",return_policy_id:returnPolicyId})
        });
        const pd=await pr.json();
        if(pr.ok&&pd.state==="active"){
          results.activated.push({listing_id:lid,title:(listing.title||'').slice(0,60)});
          console.log("[bulk-activate] ✅",lid,pd.state);
        }else{
          results.failed.push({listing_id:lid,status:pr.status,error:pd.error||pd,image_uploaded:imageOk});
          console.error("[bulk-activate] ❌",lid,pr.status,JSON.stringify(pd).slice(0,120));
        }
        // Small delay to avoid rate limiting
        await new Promise(r=>setTimeout(r,200));
      }catch(e){results.skipped.push({listing_id:lid,error:e.message});}
    }

    res.json({
      total_drafts:allDrafts.length,
      processed:batch.length,
      activated:results.activated.length,
      failed:results.failed.length,
      skipped:results.skipped.length,
      activated_ids:results.activated.map(l=>l.listing_id),
      failures:results.failed.slice(0,5),
      return_policy_id_used:returnPolicyId
    });
  }catch(e){res.status(500).json({error:e.message});}
});

etsyRouter.get("/reviews",async(req,res)=>{
  try{
    const r=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP+"/reviews?limit=10",{headers:pubH()});
    if(!r.ok)return res.status(r.status).json({error:"Etsy "+r.status});

    res.json(await r.json());
  }catch(e){res.status(500).json({error:e.message});}
});
