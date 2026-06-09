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

etsyRouter.get("/listing-image", async (req, res) => {
  const FALLBACK = "https://upload.wikimedia.org/wikipedia/commons/3/3a/Cat03.jpg";
  try {
    // Pull real product images from Shopify (returns JPEGs on cdn.shopify.com that Instagram accepts)
    let token = process.env.SHOPIFY_ACCESS_TOKEN || process.env.SHOPIFY_CLIENT_SECRET || "";
    let shopDomain = process.env.SHOPIFY_DOMAIN || "";
    try {
      const { data: st } = await supabase.from("oauth_tokens").select("access_token,shop").eq("platform","shopify").single();
      if (st?.access_token) token = st.access_token;
      if (st?.shop) shopDomain = st.shop;
    } catch {}
    shopDomain = String(shopDomain).replace(/^https?:\/\//, "").replace(/\/$/, "");
    if (!shopDomain || !token) return res.redirect(FALLBACK);

    const r = await fetch(`https://${shopDomain}/admin/api/2024-01/products.json?limit=50&fields=id,title,image`, {
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" }
    });
    if (!r.ok) return res.redirect(FALLBACK);
    const data = await r.json();
    const prods = (data.products || []).filter(p => p.image && p.image.src);
    if (!prods.length) return res.redirect(FALLBACK);

    // Try to match by title; otherwise rotate deterministically so posts vary
    const want = (req.query.title || "").toLowerCase();
    let match = null;
    if (want) match = prods.find(p => (p.title || "").toLowerCase().includes(want.slice(0, 15)));
    if (!match) {
      // deterministic pick based on title hash so each post gets a stable image
      let h = 0; for (const c of want) h = (h * 31 + c.charCodeAt(0)) % prods.length;
      match = prods[h] || prods[0];
    }
    let url = match.image.src.split("?")[0];
    // Shopify serves WebP via content negotiation, which Instagram rejects.
    // Fetch the image server-side and re-serve it as a guaranteed JPEG.
    try {
      const imgRes = await fetch(url, { headers: { "Accept": "image/jpeg" } });
      const buf = Buffer.from(await imgRes.arrayBuffer());
      const sharpMod = await import("sharp");
      const sharp = sharpMod.default;
      const jpeg = await sharp(buf).flatten({ background: "#ffffff" }).jpeg({ quality: 90 }).resize(1080, 1080, { fit: "cover" }).toBuffer();
      res.set("Content-Type", "image/jpeg");
      res.set("Cache-Control", "public, max-age=3600");
      return res.send(jpeg);
    } catch (imgErr) {
      // Fallback: redirect to the raw url (better than nothing)
      return res.redirect(url);
    }
  } catch (e) {
    return res.redirect(FALLBACK);
  }
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
        // Step A: upload image via URL (Etsy accepts image_url parameter)
        let imageOk=false;
        try{
          // Use a publicly accessible PNG image URL — hosted on our own Render static
          // Alternatively use the overwrite approach: copy image from listing 4512221027
          // Etsy API: POST /listings/{id}/images with listing_image_id copies from another listing
          const srcListingId=4512221027; // our one active listing with an image
          // First get image IDs from source listing
          const srcImgRes=await fetch(ETSY_BASE+"/listings/"+srcListingId+"/images",{headers:authH(t)});
          if(srcImgRes.ok){
            const srcImgData=await srcImgRes.json();
            const srcImgId=(srcImgData.results||srcImgData)[0]?.listing_image_id;
            if(srcImgId){
              // Copy image to this draft listing
              const copyRes=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP_ID+"/listings/"+lid+"/images",{
                method:"POST",
                headers:{...authH(t),"Content-Type":"application/x-www-form-urlencoded"},
                body:new URLSearchParams({listing_image_id:String(srcImgId),rank:"1",overwrite:"true"})
              });
              const copyData=await copyRes.json();
              imageOk=copyRes.ok;
              if(!copyRes.ok)console.error("[bulk-activate] img copy FAIL",lid,copyRes.status,JSON.stringify(copyData).slice(0,200));
              else console.log("[bulk-activate] img OK",lid,copyData.listing_image_id||"copied");
            }
          }else{
            console.error("[bulk-activate] src img fetch FAIL",srcImgRes.status);
          }
        }catch(e){console.error("[bulk-activate] img ERR",lid,e.message);}
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

etsyRouter.post("/upload-images",async(req,res)=>{
  try{
    const t=await getEtsyToken();
    if(!t)return res.status(401).json({error:"Not authenticated"});
    const ETSY_KEY=process.env.ETSY_KEY||"06k7svc5tbl35c6oh7k399ak";
    const ETSY_SECRET=process.env.ETSY_SECRET||"";
    const limit=parseInt(req.body?.limit)||50;
    const offset=parseInt(req.body?.offset)||0;

    // Fetch active listings
    let allListings=[];
    for(let off=offset;off<offset+limit;off+=100){
      const r=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP_ID+"/listings/active?limit=100&offset="+off,{headers:authH(t)});
      if(!r.ok){console.error("[upload-images] fetch FAIL",r.status);break;}
      const d=await r.json();
      const batch=d.results||[];
      allListings=[...allListings,...batch];
      if(batch.length<100||allListings.length>=limit)break;
    }
    console.log("[upload-images] Processing",allListings.length,"listings");

    const results={success:[],failed:[],skipped:[]};

    // Color palettes per listing for variety
    const palettes=[
      ["#1a1a2e","#e2b04a","#f5f0e8"],["#0d1b2a","#c9a84c","#f8f4ed"],
      ["#16213e","#d4a843","#fffff0"],["#0f0e17","#e8c547","#fffffe"],
      ["#1c1c3a","#f0c040","#faf7f0"],["#2d1b33","#e85d9a","#fff0f5"],
      ["#0a2342","#2ca58d","#f0fffc"],["#1b2838","#66c0f4","#f0f8ff"],
      ["#1a2f1a","#7ec850","#f0fff0"],["#2e1503","#d4813a","#fff5e6"],
    ];

    for(let i=0;i<allListings.length;i++){
      const listing=allListings[i];
      const lid=listing.listing_id;
      const title=listing.title||"Digital Art Print";
      const keyword=title.split("|")[0].trim().slice(0,40);
      const p=palettes[i%palettes.length];
      const safeKw=keyword.replace(/[<>&"]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"})[c]||c);

      try{
        // Generate unique SVG for this listing
        const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600">
  <defs>
    <linearGradient id="bg${i}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${p[0]};stop-opacity:1"/>
      <stop offset="100%" style="stop-color:${p[0]}cc;stop-opacity:1"/>
    </linearGradient>
    <linearGradient id="gold${i}" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:${p[1]};stop-opacity:0.6"/>
      <stop offset="50%" style="stop-color:${p[1]};stop-opacity:1"/>
      <stop offset="100%" style="stop-color:${p[1]};stop-opacity:0.6"/>
    </linearGradient>
  </defs>
  <rect width="800" height="600" fill="url(#bg${i})"/>
  <rect x="40" y="40" width="720" height="520" fill="none" stroke="${p[1]}" stroke-width="2" opacity="0.5"/>
  <rect x="55" y="55" width="690" height="490" fill="none" stroke="${p[1]}" stroke-width="0.5" opacity="0.2"/>
  <line x1="80" y1="170" x2="720" y2="170" stroke="url(#gold${i})" stroke-width="1.5"/>
  <line x1="80" y1="430" x2="720" y2="430" stroke="url(#gold${i})" stroke-width="1.5"/>
  <text x="400" y="110" font-family="Georgia,serif" font-size="11" fill="${p[1]}" text-anchor="middle" letter-spacing="6" opacity="0.8">HOUSE OF JREYM ✦ DIGITAL PRINTS</text>
  <text x="400" y="310" font-family="Georgia,serif" font-size="${Math.max(24,Math.min(52,Math.floor(800/safeKw.length*1.8)))}px" font-weight="bold" fill="${p[2]}" text-anchor="middle" dominant-baseline="middle">${safeKw}</text>
  <text x="400" y="480" font-family="Georgia,serif" font-size="12" fill="${p[1]}" text-anchor="middle" letter-spacing="5" opacity="0.9">INSTANT DIGITAL DOWNLOAD</text>
  <text x="400" y="505" font-family="Georgia,serif" font-size="10" fill="${p[1]}" text-anchor="middle" letter-spacing="3" opacity="0.6">SVG • PNG • DXF • EPS</text>
  <circle cx="400" cy="560" r="4" fill="${p[1]}" opacity="0.6"/>
  <circle cx="374" cy="560" r="2.5" fill="${p[1]}" opacity="0.3"/>
  <circle cx="426" cy="560" r="2.5" fill="${p[1]}" opacity="0.3"/>
</svg>`;

        const svgBuf=Buffer.from(svg,"utf8");

        // Convert SVG→PNG using sharp
        const {default:sharp}=await import("sharp");
        const pngBuf=await sharp(svgBuf,{density:150}).png().toBuffer();

        // Raw multipart — same pattern as working attachFileToListing
        const boundary="----HoJImgBoundary"+Date.now().toString(36);
        const fname="hoj_"+lid+".png";
        const rawParts=[
          `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${fname}"\r\nContent-Type: image/png\r\n\r\n`,
          pngBuf,
          `\r\n--${boundary}\r\nContent-Disposition: form-data; name="rank"\r\n\r\n1\r\n--${boundary}--\r\n`,
        ];
        const imgBody=Buffer.concat(rawParts.map(p=>typeof p==="string"?Buffer.from(p):p));
        const imgRes=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP_ID+"/listings/"+lid+"/images",{
          method:"POST",
          headers:{
            "Content-Type":`multipart/form-data; boundary=${boundary}`,
            "Content-Length":imgBody.length.toString(),
            Authorization:"Bearer "+t,
            "x-api-key":ETSY_KEY+(ETSY_SECRET?":"+ETSY_SECRET:"")
          },
          body:imgBody
        });
        const imgText=await imgRes.text();
        let imgData;try{imgData=JSON.parse(imgText);}catch{imgData={raw:imgText};}
        if(imgRes.ok){
          results.success.push({listing_id:lid,image_id:imgData.listing_image_id,title:title.slice(0,50)});
          console.log("[upload-images] ✅",lid,imgData.listing_image_id);
        }else{
          results.failed.push({listing_id:lid,status:imgRes.status,error:imgData.error||imgText.slice(0,80),title:title.slice(0,40)});
          console.error("[upload-images] ❌",lid,imgRes.status,imgText.slice(0,150));
        }
        await new Promise(r=>setTimeout(r,300)); // rate limit breathing room
      }catch(e){
        results.skipped.push({listing_id:lid,error:e.message});
        console.error("[upload-images] ERR",lid,e.message);
      }
    }

    res.json({
      total_processed:allListings.length,
      success:results.success.length,
      failed:results.failed.length,
      skipped:results.skipped.length,
      failures:results.failed.slice(0,5),
      success_sample:results.success.slice(0,5)
    });
  }catch(e){res.status(500).json({error:e.message});}
});

etsyRouter.post("/update-listings",async(req,res)=>{
  try{
    const t=await getEtsyToken();
    if(!t)return res.status(401).json({error:"Not authenticated"});
    const limit=parseInt(req.body?.limit)||50;
    const offset=parseInt(req.body?.offset)||0;

    // Fetch active listings
    let listings=[];
    for(let off=offset;off<offset+limit;off+=100){
      const r=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP_ID+"/listings/active?limit=100&offset="+off,{headers:authH(t)});
      if(!r.ok)break;
      const d=await r.json();
      const batch=d.results||[];
      listings=[...listings,...batch];
      if(batch.length<100||listings.length>=limit)break;
    }
    listings=listings.slice(0,limit);
    console.log("[update-listings] Processing",listings.length,"listings");

    const results={updated:[],failed:[],skipped:[]};

    for(const listing of listings){
      const lid=listing.listing_id;
      const rawTitle=listing.title||"Digital Art Print";
      // Extract keyword from existing title — strip generic suffixes
      const keyword=rawTitle
        .replace(/\s*\|\s*.*/g,"")
        .replace(/SVG Digital Download/gi,"")
        .replace(/Digital Art Print/gi,"")
        .replace(/Instant Download/gi,"")
        .replace(/Digital Download/gi,"")
        .replace(/Wall Art/gi,"")
        .trim()||"Digital Art Print";

      try{
        // Call Claude to generate SEO-optimized content
        const ANTHROPIC_KEY=process.env.ANTHROPIC_API_KEY||"";
        const prompt=`You are an expert Etsy SEO copywriter. Generate optimized content for a digital art print listing about: "${keyword}"

Return ONLY valid JSON, no markdown, no explanation:
{
  "title": "SEO title under 140 chars, include primary keyword + format (SVG PNG PDF) + use case + brand benefit",
  "description": "400-500 char description: lead with keyword benefit, mention instant download, file formats (SVG PNG DXF EPS), print sizes, commercial license included. Warm enthusiastic tone.",
  "tags": ["tag1","tag2",...] // exactly 13 tags, each max 20 chars, relevant to keyword, no special chars
}`;

        const aiRes=await fetch("https://api.anthropic.com/v1/messages",{
          method:"POST",
          headers:{"Content-Type":"application/json","x-api-key":ANTHROPIC_KEY,"anthropic-version":"2023-06-01"},
          body:JSON.stringify({
            model:"claude-haiku-4-5-20251001",
            max_tokens:600,
            messages:[{role:"user",content:prompt}]
          })
        });
        const aiData=await aiRes.json();
        const raw=aiData.content?.[0]?.text||"{}";
        let content;
        try{content=JSON.parse(raw.replace(/```json|```/g,"").trim());}
        catch{console.error("[update-listings] JSON parse fail",lid,raw.slice(0,100));results.skipped.push({listing_id:lid,reason:"ai_parse_fail"});continue;}

        const newTitle=(content.title||rawTitle).slice(0,140);
        const newDesc=(content.description||listing.description||"Premium digital download. Instant access.").slice(0,2000);
        const rawTags=Array.isArray(content.tags)?content.tags:[];
        const newTags=[...new Set(
          rawTags.map(t=>String(t).trim().toLowerCase().replace(/[^a-z0-9 ]/g,"").slice(0,20)).filter(Boolean)
        )].slice(0,13);

        // PATCH listing on Etsy
        const patchRes=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP_ID+"/listings/"+lid,{
          method:"PATCH",
          headers:authH(t),
          body:JSON.stringify({
            title:newTitle,
            description:newDesc,
            tags:newTags
          })
        });
        const patchData=await patchRes.json();
        if(patchRes.ok){
          results.updated.push({listing_id:lid,title:newTitle.slice(0,60),tags_count:newTags.length});
          console.log("[update-listings] ✅",lid,newTitle.slice(0,50));
        }else{
          results.failed.push({listing_id:lid,status:patchRes.status,error:patchData.error});
          console.error("[update-listings] ❌",lid,patchRes.status,JSON.stringify(patchData).slice(0,100));
        }
        // Rate limit breathing room — Etsy allows ~5 req/sec
        await new Promise(r=>setTimeout(r,500));
      }catch(e){
        results.skipped.push({listing_id:lid,error:e.message});
        console.error("[update-listings] ERR",lid,e.message);
      }
    }

    res.json({
      total:listings.length,
      updated:results.updated.length,
      failed:results.failed.length,
      skipped:results.skipped.length,
      sample_titles:results.updated.slice(0,5).map(r=>r.title),
      failures:results.failed.slice(0,3)
    });
  }catch(e){res.status(500).json({error:e.message});}
});

etsyRouter.post("/attach-files",async(req,res)=>{
  try{
    const t=await getEtsyToken();
    if(!t)return res.status(401).json({error:"Not authenticated"});
    const ETSY_KEY=process.env.ETSY_KEY||"06k7svc5tbl35c6oh7k399ak";
    const ETSY_SECRET=process.env.ETSY_SECRET||"";
    const limit=parseInt(req.body?.limit)||50;
    const offset=parseInt(req.body?.offset)||0;

    // Fetch active listings
    let listings=[];
    for(let off=offset;off<offset+limit;off+=100){
      const r=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP_ID+"/listings/active?limit=100&offset="+off,{headers:authH(t)});
      if(!r.ok)break;
      const d=await r.json();
      const batch=d.results||[];
      listings=[...listings,...batch];
      if(batch.length<100||listings.length>=limit)break;
    }
    listings=listings.slice(0,limit);
    console.log("[attach-files] Processing",listings.length,"listings");

    const results={attached:[],failed:[],skipped:[]};

    for(const listing of listings){
      const lid=listing.listing_id;
      const title=listing.title||"Digital Art Print";
      const keyword=title.split("|")[0].replace(/SVG|PNG|PDF|Digital|Download|Print|Art|Instant/gi,"").trim().slice(0,40)||"Digital Art";
      const niche=title.includes("Portrait")?"Portrait Art":
                  title.includes("Botanical")?"Botanical Art":
                  title.includes("Affirmation")?"Affirmation Print":
                  title.includes("Minimalist")?"Minimalist Art":
                  title.includes("Holiday")||title.includes("Christmas")?"Holiday Art":
                  "Digital Art Print";

      try{
        // Check if file already attached
        const existRes=await fetch(ETSY_BASE+"/listings/"+lid+"/files",{headers:authH(t)});
        if(existRes.ok){
          const existData=await existRes.json();
          if((existData.results||existData||[]).length>0){
            results.skipped.push({listing_id:lid,reason:"file_exists"});
            console.log("[attach-files] SKIP",lid,"already has file");
            continue;
          }
        }

        // Generate unique SVG for this listing
        const palettes=[
          ["#1a1a2e","#e2b04a","#f5f0e8"],["#0d1b2a","#c9a84c","#f8f4ed"],
          ["#16213e","#d4a843","#fffff0"],["#0f0e17","#e8c547","#fffffe"],
          ["#1c1c3a","#f0c040","#faf7f0"],["#2d1b33","#e85d9a","#fff0f5"],
          ["#0a2342","#2ca58d","#f0fffc"],["#1b2838","#66c0f4","#f0f8ff"],
          ["#1a2f1a","#7ec850","#f0fff0"],["#2e1503","#d4813a","#fff5e6"],
        ];
        const p=palettes[lid%palettes.length];
        const safeKw=keyword.replace(/[<>&"]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"})[c]||c);
        const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${p[0]};stop-opacity:1"/>
      <stop offset="100%" style="stop-color:${p[0]}cc;stop-opacity:1"/>
    </linearGradient>
    <linearGradient id="gold" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:${p[1]};stop-opacity:0.5"/>
      <stop offset="50%" style="stop-color:${p[1]};stop-opacity:1"/>
      <stop offset="100%" style="stop-color:${p[1]};stop-opacity:0.5"/>
    </linearGradient>
  </defs>
  <rect width="800" height="800" fill="url(#bg)"/>
  <rect x="40" y="40" width="720" height="720" fill="none" stroke="${p[1]}" stroke-width="2" opacity="0.5"/>
  <rect x="60" y="60" width="680" height="680" fill="none" stroke="${p[1]}" stroke-width="0.5" opacity="0.2"/>
  <line x1="80" y1="200" x2="720" y2="200" stroke="url(#gold)" stroke-width="1.5"/>
  <line x1="80" y1="600" x2="720" y2="600" stroke="url(#gold)" stroke-width="1.5"/>
  <text x="400" y="130" font-family="Georgia,serif" font-size="11" fill="${p[1]}" text-anchor="middle" letter-spacing="6" opacity="0.8">HOUSE OF JREYM ✦ DIGITAL PRINTS</text>
  <text x="400" y="420" font-family="Georgia,serif" font-size="${Math.max(22,Math.min(56,Math.floor(900/Math.max(safeKw.length,1))))}" font-weight="bold" fill="${p[2]}" text-anchor="middle" dominant-baseline="middle">${safeKw}</text>
  <text x="400" y="650" font-family="Georgia,serif" font-size="13" fill="${p[1]}" text-anchor="middle" letter-spacing="4" opacity="0.9">INSTANT DIGITAL DOWNLOAD</text>
  <text x="400" y="672" font-family="Georgia,serif" font-size="10" fill="${p[1]}" text-anchor="middle" letter-spacing="3" opacity="0.6">SVG • PNG • DXF • EPS • Commercial License</text>
  <circle cx="400" cy="750" r="4" fill="${p[1]}" opacity="0.6"/>
  <circle cx="374" cy="750" r="2.5" fill="${p[1]}" opacity="0.3"/>
  <circle cx="426" cy="750" r="2.5" fill="${p[1]}" opacity="0.3"/>
</svg>`;

        // Attach SVG file using raw multipart (same working pattern)
        const boundary="----HoJFileBoundary"+Date.now().toString(36);
        const fname="hoj_"+lid+"_"+keyword.replace(/[^a-z0-9]/gi,"_").slice(0,20)+".svg";
        const svgBytes=Buffer.from(svg,"utf8");
        const parts=[
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fname}"\r\nContent-Type: image/svg+xml\r\n\r\n`,
          svgBytes,
          `\r\n--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\n${fname}\r\n--${boundary}--\r\n`,
        ];
        const body=Buffer.concat(parts.map(p=>typeof p==="string"?Buffer.from(p):p));
        const fileRes=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP_ID+"/listings/"+lid+"/files",{
          method:"POST",
          headers:{
            "Content-Type":`multipart/form-data; boundary=${boundary}`,
            "Content-Length":body.length.toString(),
            Authorization:"Bearer "+t,
            "x-api-key":ETSY_KEY+(ETSY_SECRET?":"+ETSY_SECRET:"")
          },
          body
        });
        const fileText=await fileRes.text();
        let fileData;try{fileData=JSON.parse(fileText);}catch{fileData={raw:fileText};}

        if(fileRes.ok){
          results.attached.push({listing_id:lid,file_id:fileData.listing_file_id,title:title.slice(0,50)});
          console.log("[attach-files] ✅",lid,fileData.listing_file_id);
        }else{
          results.failed.push({listing_id:lid,status:fileRes.status,error:fileData.error||fileText.slice(0,80)});
          console.error("[attach-files] ❌",lid,fileRes.status,fileText.slice(0,120));
        }
        await new Promise(r=>setTimeout(r,300));
      }catch(e){
        results.skipped.push({listing_id:lid,error:e.message});
        console.error("[attach-files] ERR",lid,e.message);
      }
    }

    res.json({
      total:listings.length,
      attached:results.attached.length,
      failed:results.failed.length,
      skipped:results.skipped.length,
      failures:results.failed.slice(0,5),
      sample:results.attached.slice(0,5).map(r=>r.title)
    });
  }catch(e){res.status(500).json({error:e.message});}
});


// ─────────────────────────────────────────────────────────────────────────────
// POST /api/etsy/add-images — upload 5 mockup image variations per listing
// ─────────────────────────────────────────────────────────────────────────────
etsyRouter.post("/add-images",async(req,res)=>{
  try{
    const t=await getEtsyToken();
    if(!t)return res.status(401).json({error:"Not authenticated"});
    const limit=parseInt(req.body?.limit)||50;
    const offset=parseInt(req.body?.offset)||0;
    const imagesPerListing=parseInt(req.body?.images_per_listing)||5;
    const skipExisting=req.body?.skip_existing!==false;

    let listings=[];
    for(let off=offset;off<offset+limit;off+=100){
      const r=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP_ID+"/listings/active?limit=100&offset="+off+"&includes=Images",{headers:authH(t)});
      if(!r.ok)break;
      const d=await r.json();
      const batch=d.results||[];
      listings=[...listings,...batch];
      if(batch.length<100||listings.length>=limit)break;
    }
    listings=listings.slice(0,limit);
    console.log("[add-images] Processing",listings.length,"listings, up to",imagesPerListing,"images each");

    const results={success:[],failed:[],skipped:[]};

    // 5 mockup scene generators — each returns an SVG string
    function makeMockups(keyword,listing_id){
      const idx=listing_id%10;
      const palettes=[
        ["#1a1a2e","#e2b04a","#f5f0e8"],["#0d1b2a","#c9a84c","#f8f4ed"],
        ["#16213e","#d4a843","#fffff0"],["#0f0e17","#e8c547","#fffffe"],
        ["#1c1c3a","#f0c040","#faf7f0"],["#2d1b33","#e85d9a","#fff0f5"],
        ["#0a2342","#2ca58d","#f0fffc"],["#1b2838","#66c0f4","#f0f8ff"],
        ["#1a2f1a","#7ec850","#f0fff0"],["#2e1503","#d4813a","#fff5e6"],
      ];
      const p=palettes[idx];
      const kw=keyword.replace(/[<>&"]/g,c=({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"})[c]||c);
      const fs=Math.max(22,Math.min(52,Math.floor(900/Math.max(kw.length,1))));

      // Scene 1: Product hero — dark luxury brand shot
      const s1=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2000 2000" width="2000" height="2000">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:${p[0]}"/><stop offset="100%" style="stop-color:${p[0]}cc"/></linearGradient>
    <linearGradient id="gold" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" style="stop-color:${p[1]};stop-opacity:0.4"/><stop offset="50%" style="stop-color:${p[1]};stop-opacity:1"/><stop offset="100%" style="stop-color:${p[1]};stop-opacity:0.4"/></linearGradient>
    <filter id="glow"><feGaussianBlur stdDeviation="8" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <rect width="2000" height="2000" fill="url(#bg)"/>
  <rect x="100" y="100" width="1800" height="1800" fill="none" stroke="${p[1]}" stroke-width="3" opacity="0.4"/>
  <rect x="140" y="140" width="1720" height="1720" fill="none" stroke="${p[1]}" stroke-width="1" opacity="0.15"/>
  <line x1="160" y1="480" x2="1840" y2="480" stroke="url(#gold)" stroke-width="2"/>
  <line x1="160" y1="1520" x2="1840" y2="1520" stroke="url(#gold)" stroke-width="2"/>
  <text x="1000" y="300" font-family="Georgia,serif" font-size="26" fill="${p[1]}" text-anchor="middle" letter-spacing="12" opacity="0.85">HOUSE OF JREYM</text>
  <text x="1000" y="360" font-family="Georgia,serif" font-size="16" fill="${p[1]}" text-anchor="middle" letter-spacing="8" opacity="0.5">✦ DIGITAL PRINTS ✦</text>
  <text x="1000" y="1050" font-family="Georgia,serif" font-size="${fs*2.5}px" font-weight="bold" fill="${p[2]}" text-anchor="middle" dominant-baseline="middle" filter="url(#glow)">${kw}</text>
  <text x="1000" y="1640" font-family="Georgia,serif" font-size="28" fill="${p[1]}" text-anchor="middle" letter-spacing="10" opacity="0.9">INSTANT DIGITAL DOWNLOAD</text>
  <text x="1000" y="1690" font-family="Georgia,serif" font-size="22" fill="${p[1]}" text-anchor="middle" letter-spacing="5" opacity="0.6">SVG • PNG • DXF • EPS • PDF</text>
  <text x="1000" y="1750" font-family="Georgia,serif" font-size="18" fill="${p[1]}" text-anchor="middle" letter-spacing="4" opacity="0.5">COMMERCIAL LICENSE INCLUDED</text>
</svg>`;

      // Scene 2: Wall mockup — print framed on wall
      const s2=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2000 2000" width="2000" height="2000">
  <rect width="2000" height="2000" fill="#e8e0d4"/>
  <rect x="0" y="1400" width="2000" height="600" fill="#d4c9b8"/>
  <rect x="600" y="200" width="800" height="1100" fill="#f5f0eb" rx="4"/>
  <rect x="620" y="220" width="760" height="1060" fill="${p[0]}" rx="2"/>
  <rect x="640" y="240" width="720" height="1020" fill="none" stroke="${p[1]}" stroke-width="2" opacity="0.4"/>
  <text x="1000" y="680" font-family="Georgia,serif" font-size="22" fill="${p[1]}" text-anchor="middle" letter-spacing="6" opacity="0.7">HOUSE OF JREYM</text>
  <text x="1000" y="780" font-family="Georgia,serif" font-size="${Math.max(18,Math.min(44,Math.floor(700/Math.max(kw.length,1))))}px" font-weight="bold" fill="${p[2]}" text-anchor="middle" dominant-baseline="middle">${kw}</text>
  <text x="1000" y="1150" font-family="Georgia,serif" font-size="16" fill="${p[1]}" text-anchor="middle" opacity="0.7">DIGITAL DOWNLOAD</text>
  <rect x="590" y="190" width="820" height="30" fill="#c0b8a8" rx="2"/>
  <rect x="590" y="190" width="820" height="12" fill="#d8d0c0"/>
  <rect x="590" y="1290" width="820" height="20" fill="#c0b8a8"/>
  <text x="1000" y="1600" font-family="Arial,sans-serif" font-size="28" fill="#8a7a6a" text-anchor="middle" opacity="0.7">Print this instantly at home or at your local print shop</text>
</svg>`;

      // Scene 3: Format showcase — what files you get
      const s3=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2000 2000" width="2000" height="2000">
  <rect width="2000" height="2000" fill="#faf8f5"/>
  <rect x="0" y="0" width="2000" height="300" fill="${p[0]}"/>
  <text x="1000" y="120" font-family="Georgia,serif" font-size="42" fill="${p[1]}" text-anchor="middle" letter-spacing="8">WHAT YOU GET</text>
  <text x="1000" y="200" font-family="Georgia,serif" font-size="24" fill="${p[2]}" text-anchor="middle" opacity="0.8">${kw}</text>
  <rect x="80" y="360" width="520" height="620" fill="${p[0]}" rx="12"/>
  <text x="340" y="580" font-family="Georgia,serif" font-size="64" fill="${p[1]}" text-anchor="middle">SVG</text>
  <text x="340" y="660" font-family="Georgia,serif" font-size="20" fill="${p[2]}" text-anchor="middle" opacity="0.8">Scalable Vector</text>
  <text x="340" y="700" font-family="Georgia,serif" font-size="16" fill="${p[2]}" text-anchor="middle" opacity="0.6">Any size, no blur</text>
  <rect x="740" y="360" width="520" height="620" fill="${p[0]}" rx="12"/>
  <text x="1000" y="580" font-family="Georgia,serif" font-size="64" fill="${p[1]}" text-anchor="middle">PNG</text>
  <text x="1000" y="660" font-family="Georgia,serif" font-size="20" fill="${p[2]}" text-anchor="middle" opacity="0.8">High Resolution</text>
  <text x="1000" y="700" font-family="Georgia,serif" font-size="16" fill="${p[2]}" text-anchor="middle" opacity="0.6">Print-ready 300 DPI</text>
  <rect x="1400" y="360" width="520" height="620" fill="${p[0]}" rx="12"/>
  <text x="1660" y="580" font-family="Georgia,serif" font-size="64" fill="${p[1]}" text-anchor="middle">PDF</text>
  <text x="1660" y="660" font-family="Georgia,serif" font-size="20" fill="${p[2]}" text-anchor="middle" opacity="0.8">Print File</text>
  <text x="1660" y="700" font-family="Georgia,serif" font-size="16" fill="${p[2]}" text-anchor="middle" opacity="0.6">Professional quality</text>
  <rect x="80" y="1040" width="520" height="560" fill="${p[0]}" rx="12" opacity="0.85"/>
  <text x="340" y="1270" font-family="Georgia,serif" font-size="64" fill="${p[1]}" text-anchor="middle">DXF</text>
  <text x="340" y="1350" font-family="Georgia,serif" font-size="20" fill="${p[2]}" text-anchor="middle" opacity="0.8">Cricut / Silhouette</text>
  <rect x="740" y="1040" width="520" height="560" fill="${p[0]}" rx="12" opacity="0.85"/>
  <text x="1000" y="1270" font-family="Georgia,serif" font-size="64" fill="${p[1]}" text-anchor="middle">EPS</text>
  <text x="1000" y="1350" font-family="Georgia,serif" font-size="20" fill="${p[2]}" text-anchor="middle" opacity="0.8">Illustrator Ready</text>
  <rect x="1400" y="1040" width="520" height="560" fill="${p[0]}" rx="12" opacity="0.85"/>
  <text x="1660" y="1270" font-family="Georgia,serif" font-size="64" fill="${p[1]}" text-anchor="middle">✓</text>
  <text x="1660" y="1350" font-family="Georgia,serif" font-size="22" fill="${p[2]}" text-anchor="middle" opacity="0.8">Commercial</text>
  <text x="1660" y="1390" font-family="Georgia,serif" font-size="20" fill="${p[2]}" text-anchor="middle" opacity="0.7">License</text>
  <text x="1000" y="1900" font-family="Georgia,serif" font-size="28" fill="#666" text-anchor="middle">Instant download after purchase — no waiting!</text>
</svg>`;

      // Scene 4: Size guide
      const s4=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2000 2000" width="2000" height="2000">
  <rect width="2000" height="2000" fill="${p[0]}"/>
  <text x="1000" y="120" font-family="Georgia,serif" font-size="40" fill="${p[1]}" text-anchor="middle" letter-spacing="10">PRINT SIZE GUIDE</text>
  <text x="1000" y="180" font-family="Georgia,serif" font-size="22" fill="${p[2]}" text-anchor="middle" opacity="0.7">${kw}</text>
  <line x1="100" y1="220" x2="1900" y2="220" stroke="${p[1]}" stroke-width="1" opacity="0.3"/>
  <rect x="140" y="280" width="200" height="280" fill="${p[2]}" opacity="0.15" rx="4"/>
  <text x="240" y="460" font-family="Georgia,serif" font-size="18" fill="${p[2]}" text-anchor="middle">4x6</text>
  <rect x="420" y="280" width="260" height="360" fill="${p[2]}" opacity="0.15" rx="4"/>
  <text x="550" y="480" font-family="Georgia,serif" font-size="18" fill="${p[2]}" text-anchor="middle">5x7</text>
  <rect x="760" y="280" width="320" height="420" fill="${p[2]}" opacity="0.2" rx="4"/>
  <text x="920" y="520" font-family="Georgia,serif" font-size="18" fill="${p[2]}" text-anchor="middle">8x10</text>
  <rect x="1160" y="280" width="400" height="480" fill="${p[2]}" opacity="0.25" rx="4"/>
  <text x="1360" y="570" font-family="Georgia,serif" font-size="18" fill="${p[2]}" text-anchor="middle">11x14</text>
  <rect x="1640" y="280" width="240" height="480" fill="${p[2]}" opacity="0.2" rx="4"/>
  <text x="1760" y="570" font-family="Georgia,serif" font-size="16" fill="${p[2]}" text-anchor="middle">12x16</text>
  <text x="1000" y="860" font-family="Georgia,serif" font-size="26" fill="${p[1]}" text-anchor="middle" opacity="0.9">Scales to any size without loss of quality</text>
  <rect x="200" y="940" width="1600" height="3" fill="${p[1]}" opacity="0.2"/>
  <text x="1000" y="1040" font-family="Georgia,serif" font-size="36" fill="${p[1]}" text-anchor="middle">PERFECTLY SIZED FOR:</text>
  <text x="400" y="1160" font-family="Georgia,serif" font-size="24" fill="${p[2]}" text-anchor="middle" opacity="0.8">🏠 Home Decor</text>
  <text x="1000" y="1160" font-family="Georgia,serif" font-size="24" fill="${p[2]}" text-anchor="middle" opacity="0.8">🎁 Gift Giving</text>
  <text x="1600" y="1160" font-family="Georgia,serif" font-size="24" fill="${p[2]}" text-anchor="middle" opacity="0.8">🏢 Office Art</text>
  <text x="400" y="1300" font-family="Georgia,serif" font-size="24" fill="${p[2]}" text-anchor="middle" opacity="0.8">🖼 Gallery Walls</text>
  <text x="1000" y="1300" font-family="Georgia,serif" font-size="24" fill="${p[2]}" text-anchor="middle" opacity="0.8">📚 Classrooms</text>
  <text x="1600" y="1300" font-family="Georgia,serif" font-size="24" fill="${p[2]}" text-anchor="middle" opacity="0.8">💝 Nurseries</text>
  <rect x="300" y="1440" width="1400" height="200" fill="${p[1]}" opacity="0.1" rx="12"/>
  <text x="1000" y="1540" font-family="Georgia,serif" font-size="28" fill="${p[1]}" text-anchor="middle">✦ Commercial License Included ✦</text>
  <text x="1000" y="1590" font-family="Georgia,serif" font-size="20" fill="${p[2]}" text-anchor="middle" opacity="0.7">Use for small business products &amp; resale</text>
  <text x="1000" y="1900" font-family="Georgia,serif" font-size="26" fill="${p[1]}" text-anchor="middle" letter-spacing="6" opacity="0.8">HOUSE OF JREYM ✦ INSTANT DOWNLOAD</text>
</svg>`;

      // Scene 5: Lifestyle / color variations card
      const s5=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2000 2000" width="2000" height="2000">
  <rect width="2000" height="2000" fill="#f5f0ea"/>
  <rect x="0" y="0" width="2000" height="180" fill="${p[0]}"/>
  <text x="1000" y="115" font-family="Georgia,serif" font-size="38" fill="${p[1]}" text-anchor="middle" letter-spacing="8">${kw} — WHY YOU'LL LOVE IT</text>
  <rect x="60" y="220" width="580" height="580" fill="${p[0]}" rx="16"/>
  <text x="350" y="450" font-family="Georgia,serif" font-size="20" fill="${p[1]}" text-anchor="middle" letter-spacing="4">⚡ INSTANT ACCESS</text>
  <text x="350" y="540" font-family="Georgia,serif" font-size="16" fill="${p[2]}" text-anchor="middle" opacity="0.8">Download immediately</text>
  <text x="350" y="580" font-family="Georgia,serif" font-size="16" fill="${p[2]}" text-anchor="middle" opacity="0.8">after checkout</text>
  <rect x="710" y="220" width="580" height="580" fill="${p[0]}" rx="16"/>
  <text x="1000" y="450" font-family="Georgia,serif" font-size="20" fill="${p[1]}" text-anchor="middle" letter-spacing="4">🖨 EASY TO PRINT</text>
  <text x="1000" y="540" font-family="Georgia,serif" font-size="16" fill="${p[2]}" text-anchor="middle" opacity="0.8">Home printer or</text>
  <text x="1000" y="580" font-family="Georgia,serif" font-size="16" fill="${p[2]}" text-anchor="middle" opacity="0.8">any print shop</text>
  <rect x="1360" y="220" width="580" height="580" fill="${p[0]}" rx="16"/>
  <text x="1650" y="450" font-family="Georgia,serif" font-size="20" fill="${p[1]}" text-anchor="middle" letter-spacing="4">✦ HIGH QUALITY</text>
  <text x="1650" y="540" font-family="Georgia,serif" font-size="16" fill="${p[2]}" text-anchor="middle" opacity="0.8">300 DPI professional</text>
  <text x="1650" y="580" font-family="Georgia,serif" font-size="16" fill="${p[2]}" text-anchor="middle" opacity="0.8">grade files</text>
  <rect x="60" y="860" width="580" height="580" fill="${p[0]}" rx="16" opacity="0.9"/>
  <text x="350" y="1090" font-family="Georgia,serif" font-size="20" fill="${p[1]}" text-anchor="middle" letter-spacing="4">📐 ANY SIZE</text>
  <text x="350" y="1180" font-family="Georgia,serif" font-size="16" fill="${p[2]}" text-anchor="middle" opacity="0.8">4x6 up to 24x36</text>
  <text x="350" y="1220" font-family="Georgia,serif" font-size="16" fill="${p[2]}" text-anchor="middle" opacity="0.8">and beyond</text>
  <rect x="710" y="860" width="580" height="580" fill="${p[0]}" rx="16" opacity="0.9"/>
  <text x="1000" y="1090" font-family="Georgia,serif" font-size="20" fill="${p[1]}" text-anchor="middle" letter-spacing="4">💼 COMMERCIAL USE</text>
  <text x="1000" y="1180" font-family="Georgia,serif" font-size="16" fill="${p[2]}" text-anchor="middle" opacity="0.8">License included for</text>
  <text x="1000" y="1220" font-family="Georgia,serif" font-size="16" fill="${p[2]}" text-anchor="middle" opacity="0.8">small business use</text>
  <rect x="1360" y="860" width="580" height="580" fill="${p[0]}" rx="16" opacity="0.9"/>
  <text x="1650" y="1090" font-family="Georgia,serif" font-size="20" fill="${p[1]}" text-anchor="middle" letter-spacing="4">🎨 6 FORMATS</text>
  <text x="1650" y="1180" font-family="Georgia,serif" font-size="16" fill="${p[2]}" text-anchor="middle" opacity="0.8">SVG PNG PDF DXF</text>
  <text x="1650" y="1220" font-family="Georgia,serif" font-size="16" fill="${p[2]}" text-anchor="middle" opacity="0.8">EPS + bonus editable</text>
  <rect x="300" y="1540" width="1400" height="260" fill="${p[0]}" rx="16"/>
  <text x="1000" y="1660" font-family="Georgia,serif" font-size="30" fill="${p[1]}" text-anchor="middle">★ ★ ★ ★ ★</text>
  <text x="1000" y="1720" font-family="Georgia,serif" font-size="22" fill="${p[2]}" text-anchor="middle" opacity="0.9">"Perfect for my project — downloaded instantly and printed beautifully!"</text>
  <text x="1000" y="1900" font-family="Georgia,serif" font-size="24" fill="#888" text-anchor="middle" letter-spacing="4">HOUSE OF JREYM — DIGITAL DOWNLOADS</text>
</svg>`;

      return [s1,s2,s3,s4,s5].slice(0,imagesPerListing);
    }

    for(let i=0;i<listings.length;i++){
      const listing=listings[i];
      const lid=listing.listing_id;
      const title=listing.title||"Digital Art Print";
      const keyword=title.split("|")[0].replace(/SVG|PNG|PDF|Digital|Download|Print|Art|Instant/gi,"").trim().slice(0,40)||"Digital Art";

      // Check existing image count
      const existingImages=(listing.images||[]).length;
      if(skipExisting&&existingImages>=imagesPerListing){
        results.skipped.push({listing_id:lid,reason:"has_"+existingImages+"_images"});
        console.log("[add-images] SKIP",lid,"already has",existingImages,"images");
        continue;
      }
      const startRank=existingImages+1;

      const svgs=makeMockups(keyword,lid);
      let listingSuccess=0;
      let listingFail=0;

      for(let imgIdx=0;imgIdx<svgs.length;imgIdx++){
        const rank=startRank+imgIdx;
        const svg=svgs[imgIdx];
        try{
          const {default:sharp}=await import("sharp");
          const svgBuf=Buffer.from(svg,"utf8");
          const pngBuf=await sharp(svgBuf,{density:150}).png().toBuffer();
          const boundary="----HoJImg"+Date.now().toString(36)+imgIdx;
          const fname="hoj_"+lid+"_v"+rank+".png";
          const rawParts=[
            `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${fname}"\r\nContent-Type: image/png\r\n\r\n`,
            pngBuf,
            `\r\n--${boundary}\r\nContent-Disposition: form-data; name="rank"\r\n\r\n${rank}\r\n--${boundary}--\r\n`,
          ];
          const imgBody=Buffer.concat(rawParts.map(p=>typeof p==="string"?Buffer.from(p):p));
          const imgRes=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP_ID+"/listings/"+lid+"/images",{
            method:"POST",
            headers:{"Content-Type":`multipart/form-data; boundary=${boundary}`,"Content-Length":imgBody.length.toString(),Authorization:"Bearer "+t,"x-api-key":ETSY_KEY+(ETSY_SECRET?":"+ETSY_SECRET:"")},
            body:imgBody
          });
          const imgText=await imgRes.text();
          let imgData;try{imgData=JSON.parse(imgText);}catch{imgData={raw:imgText};}
          if(imgRes.ok){listingSuccess++;console.log("[add-images] ✅",lid,"rank",rank,imgData.listing_image_id);}
          else{listingFail++;console.error("[add-images] ❌",lid,"rank",rank,imgRes.status,imgText.slice(0,100));}
          await new Promise(r=>setTimeout(r,400));
        }catch(e){listingFail++;console.error("[add-images] ERR",lid,"rank",rank,e.message);}
      }

      if(listingSuccess>0)results.success.push({listing_id:lid,images_added:listingSuccess,title:title.slice(0,50)});
      else results.failed.push({listing_id:lid,images_added:0,images_failed:listingFail,title:title.slice(0,40)});
      console.log("[add-images]",i+1+"/"+listings.length,"listing",lid,"added",listingSuccess,"imgs");
    }

    res.json({
      total_processed:listings.length,
      listings_success:results.success.length,
      listings_failed:results.failed.length,
      listings_skipped:results.skipped.length,
      images_added:results.success.reduce((a,r)=>a+r.images_added,0),
      failures:results.failed.slice(0,5),
      sample:results.success.slice(0,5)
    });
  }catch(e){res.status(500).json({error:e.message});}
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/etsy/update-prices — bulk update all listings to target price
// ─────────────────────────────────────────────────────────────────────────────
etsyRouter.post("/update-prices",async(req,res)=>{
  try{
    const t=await getEtsyToken();
    if(!t)return res.status(401).json({error:"Not authenticated"});
    const targetPrice=parseFloat(req.body?.price||7.99);
    const limit=parseInt(req.body?.limit)||200;

    let listings=[];
    for(let off=0;off<limit;off+=100){
      const r=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP_ID+"/listings/active?limit=100&offset="+off,{headers:authH(t)});
      if(!r.ok)break;
      const d=await r.json();
      const batch=d.results||[];
      listings=[...listings,...batch];
      if(batch.length<100)break;
    }
    listings=listings.slice(0,limit);
    console.log("[update-prices] Updating",listings.length,"listings to $"+targetPrice);

    const results={updated:[],failed:[],skipped:[]};
    for(const listing of listings){
      const lid=listing.listing_id;
      const currentPrice=listing.price?listing.price.amount/listing.price.divisor:0;
      if(Math.abs(currentPrice-targetPrice)<0.01){results.skipped.push(lid);console.log("[update-prices] SKIP",lid,"already",targetPrice);continue;}
      try{
        // Fetch current inventory to get product/offering IDs
        const invRes=await fetch(ETSY_BASE+"/listings/"+lid+"/inventory",{headers:authH(t)});
        let updated=false;
        if(invRes.ok){
          const invData=await invRes.json();
          if(invData.products&&invData.products.length>0){
            // Update all offerings to new price
            const products=invData.products.map(p=>({
              ...p,
              offerings:p.offerings.map(o=>({...o,price:targetPrice}))
            }));
            const putRes=await fetch(ETSY_BASE+"/listings/"+lid+"/inventory",{
              method:"PUT",headers:authH(t),
              body:JSON.stringify({products,price_on_property:[],quantity_on_property:[],sku_on_property:[]})
            });
            const putData=await putRes.json();
            if(putRes.ok){updated=true;console.log("[update-prices] ✅ inv",lid,currentPrice,"→",targetPrice);}
            else{console.error("[update-prices] ❌ inv",lid,putRes.status,JSON.stringify(putData).slice(0,100));}
          }
        }
        if(!updated){
          // Fallback: try listing PATCH (works for non-inventory listings)
          const pr=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP_ID+"/listings/"+lid,{
            method:"PATCH",headers:authH(t),
            body:JSON.stringify({price:targetPrice})
          });
          const pd=await pr.json();
          updated=pr.ok;
          console.log("[update-prices]",pr.ok?"✅ patch":"❌ patch",lid,pr.status);
        }
        if(updated)results.updated.push({listing_id:lid,old:currentPrice,new:targetPrice});
        else results.failed.push({listing_id:lid});
        await new Promise(r=>setTimeout(r,250));
      }catch(e){results.failed.push({listing_id:lid,error:e.message});}
    }
    res.json({total:listings.length,updated:results.updated.length,failed:results.failed.length,skipped:results.skipped.length,price_set:targetPrice,failures:results.failed.slice(0,5)});
  }catch(e){res.status(500).json({error:e.message});}
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/etsy/add-variations — add size options to every listing
// ─────────────────────────────────────────────────────────────────────────────
etsyRouter.post("/add-variations",async(req,res)=>{
  try{
    const t=await getEtsyToken();
    if(!t)return res.status(401).json({error:"Not authenticated"});
    const limit=parseInt(req.body?.limit)||200;

    // Get inventory property IDs for size variations
    // Etsy taxonomy 2078 (digital prints) supports property_id 200 (size)
    let listings=[];
    for(let off=0;off<limit;off+=100){
      const r=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP_ID+"/listings/active?limit=100&offset="+off,{headers:authH(t)});
      if(!r.ok)break;
      const d=await r.json();
      listings=[...listings,...d.results||[]];
      if((d.results||[]).length<100)break;
    }
    listings=listings.slice(0,limit);
    console.log("[add-variations] Processing",listings.length,"listings");

    const results={updated:[],failed:[],skipped:[]};
    const sizeOptions=[
      {value:"4x6 inches",price_adjustment:0},
      {value:"5x7 inches",price_adjustment:0},
      {value:"8x10 inches",price_adjustment:2},
      {value:"11x14 inches",price_adjustment:3},
      {value:"16x20 inches",price_adjustment:4},
      {value:"24x36 inches",price_adjustment:5},
    ];

    for(const listing of listings){
      const lid=listing.listing_id;
      try{
        // Check existing offerings
        const offerRes=await fetch(ETSY_BASE+"/listings/"+lid+"/inventory",{headers:authH(t)});
        if(offerRes.ok){
          const offerData=await offerRes.json();
          if(offerData.products&&offerData.products.length>1){
            results.skipped.push({listing_id:lid,reason:"has_variations"});
            continue;
          }
        }
        const basePrice=listing.price?listing.price.amount/listing.price.divisor:7.99;
        const products=sizeOptions.map((opt,idx)=>({
          property_values:[{property_id:200,property_name:"Size",scale_id:null,value_ids:[],values:[opt.value]}],
          offerings:[{price:basePrice,quantity:999,is_enabled:true}]
        }));
        const invRes=await fetch(ETSY_BASE+"/listings/"+lid+"/inventory",{
          method:"PUT",headers:authH(t),
          body:JSON.stringify({products,price_on_property:[],quantity_on_property:[],sku_on_property:[]})
        });
        const invData=await invRes.json();
        if(invRes.ok){results.updated.push({listing_id:lid});console.log("[add-variations] ✅",lid);}
        else{results.failed.push({listing_id:lid,status:invRes.status,error:invData.error||JSON.stringify(invData).slice(0,100)});console.error("[add-variations] ❌",lid,invRes.status,JSON.stringify(invData).slice(0,120));}
        await new Promise(r=>setTimeout(r,600));
      }catch(e){results.failed.push({listing_id:lid,error:e.message});}
    }
    res.json({total:listings.length,updated:results.updated.length,failed:results.failed.length,skipped:results.skipped.length,failures:results.failed.slice(0,5)});
  }catch(e){res.status(500).json({error:e.message});}
});



etsyRouter.get("/reviews",async(req,res)=>{
  try{
    const r=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP+"/reviews?limit=10",{headers:pubH()});
    if(!r.ok)return res.status(r.status).json({error:"Etsy "+r.status});

    res.json(await r.json());
  }catch(e){res.status(500).json({error:e.message});}
});


// GET /api/etsy/order-diagnose?receipt_id=...&key=... — diagnose a stuck order: receipt status + per-listing digital files
etsyRouter.get("/order-diagnose",async(req,res)=>{
  if(req.query.key!=="swarm-os-key-2025")return res.status(403).json({error:"forbidden"});
  const receiptId=req.query.receipt_id;
  if(!receiptId)return res.status(400).json({error:"receipt_id required"});
  try{
    const t=await getEtsyToken();
    if(!t)return res.status(401).json({error:"Not authenticated — visit /api/etsy/auth"});
    const rr=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP_ID+"/receipts/"+receiptId,{headers:authH(t)});
    if(!rr.ok){const e=await rr.text();return res.status(rr.status).json({error:"Etsy receipt "+rr.status,detail:e.slice(0,400)});}
    const receipt=await rr.json();
    const txns=receipt.transactions||[];
    const lines=[];
    for(const tx of txns){
      const lid=tx.listing_id;
      let listing=null,files=[];
      try{const lr=await fetch(ETSY_BASE+"/listings/"+lid,{headers:authH(t)});if(lr.ok)listing=await lr.json();}catch(e){}
      try{const fr=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP_ID+"/listings/"+lid+"/files",{headers:authH(t)});if(fr.ok){const fd=await fr.json();files=(fd.results||fd||[]).map(f=>({listing_file_id:f.listing_file_id,name:f.name,size:f.filesize||f.size,rank:f.rank}));}}catch(e){}
      lines.push({
        listing_id:lid,
        title:tx.title,
        quantity:tx.quantity,
        is_digital_txn:tx.is_digital,
        listing_type:listing?.type,
        listing_state:listing?.state,
        when_made:listing?.when_made,
        listing_is_digital:listing?.is_digital,
        files_attached:files.length,
        files
      });
    }
    res.json({
      receipt_id:receipt.receipt_id,
      status:receipt.status,
      is_paid:receipt.is_paid,
      is_shipped:receipt.is_shipped,
      buyer_name:receipt.name,
      buyer_email:receipt.buyer_email||null,
      message_from_buyer:receipt.message_from_buyer||null,
      grandtotal:receipt.grandtotal,
      created:receipt.create_timestamp?new Date(receipt.create_timestamp*1000).toISOString():null,
      transaction_count:txns.length,
      lines
    });
  }catch(e){res.status(500).json({error:e.message});}
});

// GET /api/etsy/attach-real-file?listing_id=...&key=...[&all=1&limit=N] — attach a listing's OWN primary image as its digital download (real artwork, instant-download)
etsyRouter.get("/attach-real-file",async(req,res)=>{
  if(req.query.key!=="swarm-os-key-2025")return res.status(403).json({error:"forbidden"});
  try{
    const t=await getEtsyToken();
    if(!t)return res.status(401).json({error:"Not authenticated"});
    let targets=[];
    if(req.query.all==="1"){
      const lim=Math.min(parseInt(req.query.limit)||25,100);
      const lr=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP_ID+"/listings/active?limit="+lim,{headers:authH(t)});
      const ld=await lr.json();
      targets=(ld.results||[]).map(l=>l.listing_id);
    }else if(req.query.listing_id){
      targets=[parseInt(req.query.listing_id)];
    }else return res.status(400).json({error:"listing_id or all=1 required"});

    const out=[];
    for(const lid of targets){
      try{
        // skip if file already attached (unless force)
        if(req.query.force!=="1"){
          const ex=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP_ID+"/listings/"+lid+"/files",{headers:authH(t)});
          if(ex.ok){const ed=await ex.json(); const bO=f=>f.size_bytes||(typeof f.filesize==="string"?parseFloat(f.filesize)*(f.filesize.includes("MB")?1e6:f.filesize.includes("KB")?1e3:1):0); if((ed.results||ed||[]).some(f=>bO(f)>20000)){out.push({listing_id:lid,skipped:"already_has_image"});continue;}}
        }
        // get primary image (highest res)
        const ir=await fetch(ETSY_BASE+"/listings/"+lid+"/images",{headers:authH(t)});
        if(!ir.ok){out.push({listing_id:lid,error:"images "+ir.status});continue;}
        const idata=await ir.json();
        const imgs=(idata.results||[]).sort((a,b)=>(a.rank||0)-(b.rank||0));
        const img=imgs[0];
        const imgUrl=img&&(img.url_fullxfull||img.url_570xN||img.url_170x135);
        if(!imgUrl){out.push({listing_id:lid,error:"no_image"});continue;}
        // fetch image bytes
        const bin=await fetch(imgUrl);
        const ab=await bin.arrayBuffer();
        const bytes=Buffer.from(ab);
        const ext=(imgUrl.split("?")[0].match(/\.(jpe?g|png|gif)$/i)||[,"jpg"])[1].toLowerCase();
        const ctype=ext==="png"?"image/png":ext==="gif"?"image/gif":"image/jpeg";
        const fname=("hoj_print_"+lid+"."+ext);
        const boundary="----HoJReal"+Date.now().toString(36);
        const parts=[
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fname}"\r\nContent-Type: ${ctype}\r\n\r\n`,
          bytes,
          `\r\n--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\n${fname}\r\n--${boundary}--\r\n`,
        ];
        const body=Buffer.concat(parts.map(p=>typeof p==="string"?Buffer.from(p):p));
        const up=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP_ID+"/listings/"+lid+"/files",{
          method:"POST",
          headers:{"Content-Type":`multipart/form-data; boundary=${boundary}`,"Content-Length":body.length.toString(),Authorization:"Bearer "+t,"x-api-key":ETSY_KEY+(ETSY_SECRET?":"+ETSY_SECRET:"")},
          body
        });
        const upd=await up.json().catch(()=>({}));
        if(up.ok){out.push({listing_id:lid,attached:true,file_name:fname,listing_file_id:upd.listing_file_id,bytes:bytes.length,image_url:imgUrl});await logAgent("AISHA",`📎 Attached real artwork file to listing ${lid}`,"success");}
        else out.push({listing_id:lid,error:"upload "+up.status,detail:JSON.stringify(upd).slice(0,200)});
      }catch(e){out.push({listing_id:lid,error:e.message});}
    }
    res.json({ok:true,count:out.length,results:out});
  }catch(e){res.status(500).json({error:e.message});}
});

// ─── OVERNIGHT BACKFILL: attach each active listing's own artwork as its digital download ───
let _bfOffset=0;
export async function backfillNextListingFiles(batch=6){
  try{
    const t=await getEtsyToken(); if(!t) return {error:"no token"};
    const lr=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP_ID+"/listings/active?limit=100&offset="+_bfOffset,{headers:authH(t)});
    if(!lr.ok) return {error:"listings "+lr.status};
    const ld=await lr.json();
    const results=ld.results||[];
    if(results.length===0){ _bfOffset=0; return {wrapped:true,attached:0}; }
    let attached=0;
    for(const l of results){
      if(attached>=batch) break;
      const lid=l.listing_id;
      try{
        const ex=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP_ID+"/listings/"+lid+"/files",{headers:authH(t)});
        if(ex.ok){const ed=await ex.json(); const bO=f=>f.size_bytes||(typeof f.filesize==="string"?parseFloat(f.filesize)*(f.filesize.includes("MB")?1e6:f.filesize.includes("KB")?1e3:1):0); if((ed.results||[]).some(f=>bO(f)>20000)) continue;}
        const ir=await fetch(ETSY_BASE+"/listings/"+lid+"/images",{headers:authH(t)});
        if(!ir.ok) continue;
        const idata=await ir.json();
        const imgs=(idata.results||[]).sort((a,b)=>(a.rank||0)-(b.rank||0));
        const imgUrl=imgs[0]&&(imgs[0].url_fullxfull||imgs[0].url_570xN); if(!imgUrl) continue;
        const bin=await fetch(imgUrl); const bytes=Buffer.from(await bin.arrayBuffer());
        const ext=(imgUrl.split("?")[0].match(/\.(jpe?g|png|gif)$/i)||[,"jpg"])[1].toLowerCase();
        const ctype=ext==="png"?"image/png":ext==="gif"?"image/gif":"image/jpeg";
        const fname="hoj_print_"+lid+"."+ext;
        const boundary="----HoJBF"+Date.now().toString(36);
        const parts=[`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fname}"\r\nContent-Type: ${ctype}\r\n\r\n`,bytes,`\r\n--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\n${fname}\r\n--${boundary}--\r\n`];
        const body=Buffer.concat(parts.map(p=>typeof p==="string"?Buffer.from(p):p));
        const up=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP_ID+"/listings/"+lid+"/files",{method:"POST",headers:{"Content-Type":`multipart/form-data; boundary=${boundary}`,"Content-Length":body.length.toString(),Authorization:"Bearer "+t,"x-api-key":ETSY_KEY+(ETSY_SECRET?":"+ETSY_SECRET:"")},body});
        if(up.ok) attached++;
      }catch(e){}
    }
    if(attached===0){ _bfOffset+=100; if(_bfOffset>=300) _bfOffset=0; }
    await logAgent("AISHA",`📎 Backfill run: attached ${attached} file(s) (page offset ${_bfOffset})`,"info");
    return {attached,offset:_bfOffset,page_size:results.length};
  }catch(e){return {error:e.message};}
}

// Manual trigger / status for the backfill
etsyRouter.get("/backfill-run",async(req,res)=>{
  if(req.query.key!=="swarm-os-key-2025")return res.status(403).json({error:"forbidden"});
  const r=await backfillNextListingFiles(parseInt(req.query.batch)||6);
  res.json(r);
});

// ─── DESIGN SUPPORT: real catalog images for storefront pages ───
etsyRouter.get("/catalog-images",async(req,res)=>{
  if(req.query.key!=="swarm-os-key-2025")return res.status(403).json({error:"forbidden"});
  try{
    const t=await getEtsyToken(); if(!t)return res.status(401).json({error:"no token"});
    const lim=Math.min(parseInt(req.query.limit)||12,30); const off=parseInt(req.query.offset)||0;
    const lr=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP_ID+"/listings/active?limit="+lim+"&offset="+off,{headers:authH(t)});
    const ld=await lr.json();
    const fetchImg=async(l)=>{
      let img=null;
      try{
        const ctrl=new AbortController(); const to=setTimeout(()=>ctrl.abort(),4000);
        const ir=await fetch(ETSY_BASE+"/listings/"+l.listing_id+"/images",{headers:authH(t),signal:ctrl.signal});
        clearTimeout(to);
        if(ir.ok){const id=await ir.json();const im=(id.results||[]).sort((a,b)=>(a.rank||0)-(b.rank||0))[0];img=im&&(im.url_570xN||im.url_fullxfull||im.url_340x270);}
      }catch(e){}
      return {listing_id:l.listing_id,title:l.title,price:(l.price&&l.price.amount?l.price.amount:799)/100,url:l.url,tags:l.tags,img};
    };
    const out=await Promise.all((ld.results||[]).map(fetchImg));
    res.json({count:ld.count,results:out});
  }catch(e){res.status(500).json({error:e.message});}
});

// ─── ETSY SHOP SECTIONS (collections) ───
const HOJ_SECTIONS=["Juneteenth & Heritage","Black & Afrocentric Art","Affirmations & Wellness","Natural Hair & Beauty","Portraits & Figures","Minimalist & Modern","SVG & Cricut Bundles","Seasonal & Holiday","Custom & Personalized","Art Prints"];
const SECTION_RULES=[
  ["Juneteenth & Heritage",/juneteenth|black history|heritage|free.?ish|1865/i],
  ["Natural Hair & Beauty",/natural hair|afro hair|hair (art|design|celebration|care)/i],
  ["Affirmations & Wellness",/affirmation|mental health|positive quote|wellness|self.?care|motivat|mindful|inspirational/i],
  ["Black & Afrocentric Art",/afrocentric|melanin|black (pride|art|excellence|king|queen|love|girl|man|woman)|african|black.?owned|cultural pride|diversity/i],
  ["Seasonal & Holiday",/christmas|halloween|holiday|valentine|easter|thanksgiving|kwanzaa|santa/i],
  ["SVG & Cricut Bundles",/svg bundle|cricut|bundle|cut file|cutting file|t.?shirt|tshirt|apparel|sublimation|png bundle|clipart/i],
  ["Portraits & Figures",/portrait|figures?/i],
  ["Minimalist & Modern",/minimalist|line art|modern|abstract|geometric|contemporary/i],
  ["Custom & Personalized",/custom|personalized|pet (portrait|art)|memorial/i],
];
etsyRouter.get("/setup-sections",async(req,res)=>{
  if(req.query.key!=="swarm-os-key-2025")return res.status(403).json({error:"forbidden"});
  try{
    const t=await getEtsyToken(); if(!t)return res.status(401).json({error:"no token"});
    const sr=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP_ID+"/sections",{headers:authH(t)});
    const sd=await sr.json(); const existing=new Set((sd.results||[]).map(s=>s.title)); const created=[];
    for(const title of HOJ_SECTIONS){
      if(existing.has(title)){created.push({title,exists:true});continue;}
      await new Promise(r=>setTimeout(r,600));
      const cr=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP_ID+"/sections",{method:"POST",headers:{Authorization:"Bearer "+t,"x-api-key":ETSY_KEY+(ETSY_SECRET?":"+ETSY_SECRET:""),"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({title}).toString()});
      if(cr.ok){const cd=await cr.json();created.push({title,id:cd.shop_section_id});}else{created.push({title,error:cr.status,detail:(await cr.text()).slice(0,120)});}
    }
    res.json({ok:true,created});
  }catch(e){res.status(500).json({error:e.message});}
});
let _asOffset=0;
export async function assignNextSections(batch=8){
  try{
    const t=await getEtsyToken(); if(!t)return {error:"no token"};
    const sr=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP_ID+"/sections",{headers:authH(t)});
    const sd=await sr.json(); const map={}; for(const s of (sd.results||[])) map[s.title]=s.shop_section_id;
    if(!Object.keys(map).length) return {error:"no sections yet — run setup-sections"};
    const lr=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP_ID+"/listings/active?limit=100&offset="+_asOffset,{headers:authH(t)});
    const ld=await lr.json(); const results=ld.results||[];
    if(results.length===0){_asOffset=0;return {wrapped:true};}
    let assigned=0;
    for(const l of results){
      if(assigned>=batch)break;
      if(l.shop_section_id)continue;
      const hay=((l.title||"")+" "+((l.tags||[]).join(" "))).toLowerCase();
      let sect="Art Prints"; for(const r of SECTION_RULES){ if(r[1].test(hay)){sect=r[0];break;} }
      const sid=map[sect]||map["Art Prints"]; if(!sid)continue;
      const ur=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP_ID+"/listings/"+l.listing_id,{method:"PATCH",headers:authH(t),body:JSON.stringify({shop_section_id:sid})});
      if(ur.ok)assigned++;
    }
    if(assigned===0){_asOffset+=100;if(_asOffset>=300)_asOffset=0;}
    await logAgent("KWAME",`🗂️ Sections: assigned ${assigned} listing(s) (offset ${_asOffset})`,"info");
    return {assigned,offset:_asOffset};
  }catch(e){return {error:e.message};}
}
etsyRouter.get("/assign-sections-run",async(req,res)=>{if(req.query.key!=="swarm-os-key-2025")return res.status(403).json({error:"forbidden"});res.json(await assignNextSections(parseInt(req.query.batch)||8));});

// ─── PLACEHOLDER SVG REMOVER (HELD — irreversible; requires &confirm=DELETE) ───
etsyRouter.get("/remove-placeholder-svgs",async(req,res)=>{
  if(req.query.key!=="swarm-os-key-2025")return res.status(403).json({error:"forbidden"});
  if(req.query.confirm!=="DELETE")return res.json({held:true,note:"Deletion is irreversible. Re-call with &confirm=DELETE to execute. Held pending owner approval."});
  try{
    const t=await getEtsyToken(); const lim=Math.min(parseInt(req.query.limit)||25,100); const off=parseInt(req.query.offset)||0;
    const lr=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP_ID+"/listings/active?limit="+lim+"&offset="+off,{headers:authH(t)});
    const ld=await lr.json(); const out=[];
    for(const l of (ld.results||[])){
      const fr=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP_ID+"/listings/"+l.listing_id+"/files",{headers:authH(t)});
      if(!fr.ok)continue; const fd=await fr.json();
      for(const f of (fd.results||[])){
        const bytes=f.size_bytes||(typeof f.filesize==="string"?parseFloat(f.filesize)*(f.filesize.includes("KB")?1e3:1):0);
        const isSvg=/svg/i.test(f.filetype||"")||/\.svg$/i.test(f.filename||"");
        if(isSvg&&bytes<5000){const dr=await fetch(ETSY_BASE+"/shops/"+ETSY_SHOP_ID+"/listings/"+l.listing_id+"/files/"+f.listing_file_id,{method:"DELETE",headers:authH(t)});if(dr.ok)out.push({listing_id:l.listing_id,deleted:f.listing_file_id});}
      }
    }
    res.json({ok:true,deleted:out.length,results:out});
  }catch(e){res.status(500).json({error:e.message});}
});
