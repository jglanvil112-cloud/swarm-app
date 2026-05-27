import { useState, useEffect, useRef } from "react";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

const AGENTS = [
{ id:1, name:"TREND", role:"Market Intel", icon:"🔍", color:"#00ff88", x:15, y:20 },
{ id:2, name:"FORGE", role:"Innovation", icon:"⚡", color:"#ff6b35", x:85, y:20 },
{ id:3, name:"MARKETING", role:"Brand Ops", icon:"📣", color:"#a855f7", x:5, y:50 },
{ id:4, name:"SEO", role:"Search", icon:"🎯", color:"#f59e0b", x:95, y:50 },
{ id:5, name:"LISTINGS", role:"Content", icon:"📋", color:"#06b6d4", x:15, y:80 },
{ id:6, name:"ANALYTICS", role:"Data Intel", icon:"📊", color:"#ec4899", x:85, y:80 },
{ id:7, name:"PROFIT", role:"Revenue", icon:"💰", color:"#84cc16", x:35, y:5 },
{ id:8, name:"SUPPORT", role:"Customer Svc", icon:"💬", color:"#f97316", x:65, y:5 },
{ id:9, name:"SUPPLY", role:"Chain Ops", icon:"🚚", color:"#0ea5e9", x:35, y:95 },
{ id:10, name:"AUTO", role:"Efficiency", icon:"⚙️", color:"#6366f1", x:65, y:95 },
{ id:11, name:"PRIME", role:"Director", icon:"👑", color:"#F59E0B", x:50, y:2 },
];

const COMM_MSGS = [
{ from:"TREND", to:"LISTINGS", msg:"Niche locked — 'Boho AI Art Prints' zero competition. Create templates NOW." },
{ from:"ANALYTICS", to:"PROFIT", msg:"Conversion dipped 4% on $29 tier. Recommend A/B test at $24.99." },
{ from:"FORGE", to:"ALL", msg:"Pipeline 12 complete. 1,203 tasks processed. Standing by for directive." },
{ from:"MARKETING", to:"SEO", msg:"TikTok live — 14.2K views in 2hrs. Need keyword push to capitalize." },
{ from:"PROFIT", to:"LISTINGS", msg:"7 items repriced. Projected margin increase $340/mo. Expand catalog." },
{ from:"SUPPORT", to:"H·O·J", msg:"All tickets cleared. CSAT 100%. Requesting next task batch." },
{ from:"LISTINGS", to:"TREND", msg:"47 active products. Need 10 new design briefs based on trends." },
{ from:"TREND", to:"FORGE", msg:"Micro-niche alert: 'Afrofuturism wall art' — build template set NOW." },
{ from:"ANALYTICS", to:"H·O·J", msg:"Daily revenue on track. Q3 projection revised up +18%." },
{ from:"SEO", to:"LISTINGS", msg:"3 listings need keyword refresh. Updated tags queued for review." },
{ from:"AUTO", to:"ALL", msg:"Automation sweep complete. All pipelines green. Next run in 6hr." },
{ from:"SUPPLY", to:"PROFIT", msg:"Shipping cost analysis done. Recommend free shipping threshold at $35." },
{ from:"PRIME", to:"ALL", msg:"Sweep cycle 847 complete. Empire Mode active. All agents standby." },
{ from:"MARKETING", to:"ANALYTICS", msg:"Email sequence triggered — 2,400 subscribers targeted. Watch conversion." },
{ from:"FORGE", to:"LISTINGS", msg:"Bulk listing script executed — 48 new products queued for review." },
{ from:"SEO", to:"MARKETING", msg:"Top keyword gap: 'best printable wall art 2025' — needs blog post." },
{ from:"SUPPORT", to:"MARKETING", msg:"3 buyers asked about bundles. Recommend launching a 3-pack product." },
];

function MovingAgent({ agent, selected, onSelect, salesData }) {
const [pos, setPos] = useState({ x: agent.x, y: agent.y });
const [open, setOpen] = useState(false);
const [etsyT, setEtsyT] = useState("6hr");
const [shopT, setShopT] = useState("6hr");
const [working, setWorking] = useState(false);
const posRef = useRef({ x: agent.x, y: agent.y });
const velRef = useRef({ vx: (Math.random()-0.5)*0.25, vy: (Math.random()-0.5)*0.25 });

useEffect(() => {
const t = setInterval(() => {
posRef.current.x += velRef.current.vx;
posRef.current.y += velRef.current.vy;
if (posRef.current.x < 4 || posRef.current.x > 92) velRef.current.vx *= -1;
if (posRef.current.y < 4 || posRef.current.y > 92) velRef.current.vy *= -1;
const dx = posRef.current.x - 50;
const dy = posRef.current.y - 50;
const dist = Math.sqrt(dx*dx + dy*dy);
if (dist < 24) { posRef.current.x += dx/dist*0.5; posRef.current.y += dy/dist*0.5; }
setPos({ x: posRef.current.x, y: posRef.current.y });
}, 80);
return () => clearInterval(t);
}, []);

useEffect(() => {
const t = setInterval(() => setWorking(Math.random() > 0.5), 2000 + Math.random()*3000);
return () => clearInterval(t);
}, []);

const isSelected = selected?.id === agent.id;

return (
<div style={{ position:"absolute", left:`${pos.x}%`, top:`${pos.y}%`, transform:"translate(-50%,-50%)", zIndex:isSelected?50:open?40:10, transition:"left 0.08s linear,top 0.08s linear" }}>
<div onClick={() => { onSelect(agent); setOpen(!open); }} style={{ width:isSelected?54:44, height:isSelected?54:44, borderRadius:"50%", background:`radial-gradient(circle at 35% 30%,${agent.color}cc,${agent.color}22)`, border:`2px solid ${agent.color}`, boxShadow:`0 0 ${isSelected?28:14}px ${agent.color}${isSelected?"99":"44"},inset 0 0 10px ${agent.color}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:isSelected?22:16, cursor:"pointer", transition:"all 0.3s", position:"relative" }}>
{agent.icon}
{working && <div style={{ position:"absolute", top:-2, right:-2, width:8, height:8, borderRadius:"50%", background:"#00ff88", boxShadow:"0 0 6px #00ff88", animation:"pulse 0.8s infinite" }}/>}
</div>
<div style={{ position:"absolute", top:"100%", left:"50%", transform:"translateX(-50%)", marginTop:3, textAlign:"center", whiteSpace:"nowrap" }}>
<div style={{ fontSize:7, color:agent.color, fontFamily:"monospace", fontWeight:700, letterSpacing:1 }}>{agent.name}</div>
{working && <div style={{ fontSize:6, color:"rgba(0,255,136,0.6)", fontFamily:"monospace" }}>● WORKING</div>}
</div>
{open && (
<div style={{ position:"absolute", left:"50%", top:"110%", transform:"translateX(-50%)", marginTop:20, width:175, background:"rgba(2,4,10,0.96)", border:`1px solid ${agent.color}44`, borderRadius:10, padding:10, backdropFilter:"blur(20px)", boxShadow:`0 8px 32px ${agent.color}22`, zIndex:200 }} onClick={e=>e.stopPropagation()}>
<div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:8, borderBottom:`1px solid ${agent.color}22`, paddingBottom:6 }}>
<span style={{ fontSize:16 }}>{agent.icon}</span>
<div><div style={{ fontSize:9, color:agent.color, fontFamily:"monospace", fontWeight:700 }}>{agent.name}</div><div style={{ fontSize:7, color:"#475569", fontFamily:"monospace" }}>{agent.role}</div></div>
</div>
<div style={{ marginBottom:6 }}>
<div style={{ fontSize:7, color:"#f59e0b", fontFamily:"monospace", marginBottom:3, letterSpacing:1 }}>ETSY INTERVAL</div>
<div style={{ display:"flex", gap:3 }}>
{["1hr","6hr","24hr"].map(t => <button key={t} onClick={()=>setEtsyT(t)} style={{ flex:1, padding:"3px 0", fontSize:8, fontFamily:"monospace", background:etsyT===t?"rgba(245,158,11,0.15)":"transparent", border:`1px solid ${etsyT===t?"#f59e0b":"#1e293b"}`, borderRadius:4, color:etsyT===t?"#f59e0b":"#475569", cursor:"pointer", fontWeight:etsyT===t?700:400 }}>{t}</button>)}
</div>
</div>
<div style={{ marginBottom:8 }}>
<div style={{ fontSize:7, color:"#06b6d4", fontFamily:"monospace", marginBottom:3, letterSpacing:1 }}>SHOPIFY INTERVAL</div>
<div style={{ display:"flex", gap:3 }}>
{["1hr","6hr","24hr"].map(t => <button key={t} onClick={()=>setShopT(t)} style={{ flex:1, padding:"3px 0", fontSize:8, fontFamily:"monospace", background:shopT===t?"rgba(6,182,212,0.15)":"transparent", border:`1px solid ${shopT===t?"#06b6d4":"#1e293b"}`, borderRadius:4, color:shopT===t?"#06b6d4":"#475569", cursor:"pointer", fontWeight:shopT===t?700:400 }}>{t}</button>)}
</div>
</div>
<div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:4, marginBottom:8 }}>
<div style={{ background:"rgba(0,255,136,0.05)", border:"1px solid rgba(0,255,136,0.1)", borderRadius:4, padding:4, textAlign:"center" }}>
<div style={{ fontSize:14, color:"#00ff88", fontWeight:700, fontFamily:"monospace" }}>{salesData?.products||0}</div>
<div style={{ fontSize:6, color:"#475569", fontFamily:"monospace" }}>PRODUCTS</div>
</div>
<div style={{ background:"rgba(0,255,136,0.05)", border:"1px solid rgba(0,255,136,0.1)", borderRadius:4, padding:4, textAlign:"center" }}>
<div style={{ fontSize:14, color:"#fff", fontWeight:700, fontFamily:"monospace" }}>{salesData?.orders||0}</div>
<div style={{ fontSize:6, color:"#475569", fontFamily:"monospace" }}>ORDERS</div>
</div>
</div>
<button onClick={()=>setOpen(false)} style={{ width:"100%", padding:"4px", background:"transparent", border:"1px solid #1e293b", borderRadius:4, color:"#475569", fontSize:8, fontFamily:"monospace", cursor:"pointer" }}>CLOSE ✕</button>
</div>
)}
</div>
);
}

function CentralHQ({ salesData }) {
const [r, setR] = useState(0);
const [r2, setR2] = useState(0);
useEffect(() => { const t = setInterval(() => { setR(x=>(x+0.5)%360); setR2(x=>(x-0.8)%360); },30); return ()=>clearInterval(t); },[]);
return (
<div style={{ position:"absolute", left:"50%", top:"50%", transform:"translate(-50%,-50%)", zIndex:20 }}>
<div style={{ position:"absolute", width:220, height:220, left:-110, top:-110, borderRadius:"50%", border:"1px solid rgba(0,255,136,0.08)", boxShadow:"0 0 60px rgba(0,255,136,0.04)" }}/>
<div style={{ position:"absolute", width:180, height:180, left:-90, top:-90, borderRadius:"50%", border:"1px dashed rgba(0,255,136,0.18)", transform:`rotate(${r}deg)` }}/>
<div style={{ position:"absolute", width:150, height:150, left:-75, top:-75, borderRadius:"50%", border:"1px solid rgba(6,182,212,0.12)", transform:`rotate(${r2}deg)` }}/>
<div style={{ width:110, height:110, marginLeft:-55, marginTop:-55, borderRadius:"50%", background:"radial-gradient(circle,rgba(0,255,136,0.08),rgba(0,0,0,0.85))", border:"2px solid rgba(0,255,136,0.3)", boxShadow:"0 0 40px rgba(0,255,136,0.12),inset 0 0 30px rgba(0,0,0,0.6)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
<div style={{ fontSize:22, marginBottom:2 }}>🏛️</div>
<div style={{ fontSize:8, color:"#00ff88", fontFamily:"monospace", letterSpacing:2, fontWeight:700 }}>H·O·J</div>
<div style={{ fontSize:6, color:"rgba(0,255,136,0.35)", fontFamily:"monospace" }}>HQ</div>
{salesData?.revenue>0&&<div style={{ fontSize:9, color:"#00ff88", fontFamily:"monospace", fontWeight:700, marginTop:2 }}>${salesData.revenue}</div>}
</div>
{[0,90,180,270].map(a=>{ const rad=(a+r)*Math.PI/180; const rr=90; return <div key={a} style={{ position:"absolute", left:55+rr*Math.cos(rad)-3, top:55+rr*Math.sin(rad)-3, width:6, height:6, borderRadius:"50%", background:"rgba(0,255,136,0.6)", boxShadow:"0 0 8px rgba(0,255,136,0.9)", transform:"translate(-50%,-50%)" }}/> })}
</div>
);
}

function CommChannel({ onBroadcast }) {
const [msgs, setMsgs] = useState([]);
const [input, setInput] = useState("");
const [target, setTarget] = useState("ALL");
const [count, setCount] = useState(0);
const feedRef = useRef(null);
const idxRef = useRef(0);

const getColor = (name) => {
if (name === "H·O·J" || name === "ALL") return "#00ff88";
const a = AGENTS.find(x => x.name === name);
return a ? a.color : "#666";
};

useEffect(() => {
const addMsg = () => {
const cm = COMM_MSGS[idxRef.current % COMM_MSGS.length];
idxRef.current++;
const now = new Date();
const ts = now.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit", second:"2-digit" });
setMsgs(prev => [...prev.slice(-50), { ...cm, ts, isUser: false }]);
setCount(c => c + 1);
};
setTimeout(() => addMsg(), 400);
setTimeout(() => addMsg(), 1200);
setTimeout(() => addMsg(), 2100);
const t = setInterval(addMsg, 3800);
return () => clearInterval(t);
}, []);

useEffect(() => {
if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
}, [msgs]);

const send = () => {
const msg = input.trim();
if (!msg) return;
const now = new Date();
const ts = now.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit", second:"2-digit" });
const entry = { from:"H·O·J", to: target, msg, ts, isUser: true };
setMsgs(prev => [...prev.slice(-50), entry]);
setCount(c => c + 1);
if (onBroadcast) onBroadcast(msg);
setInput("");
};

return (
<div style={{ display:"flex", flexDirection:"column", height:"100%" }}>
<div ref={feedRef} style={{ flex:1, overflowY:"auto", padding:"8px 10px", display:"flex", flexDirection:"column", gap:5, scrollbarWidth:"thin", scrollbarColor:"rgba(0,255,136,0.2) transparent" }}>
{msgs.length === 0 && (
<div style={{ color:"#1e293b", fontSize:9, textAlign:"center", paddingTop:24, fontFamily:"monospace" }}>
Comm channel open — waiting for transmissions...
</div>
)}
{msgs.map((m, i) => {
const fromColor = getColor(m.from);
const toColor = m.to === "ALL" ? "#00ff88" : getColor(m.to);
return (
<div key={i} style={{ borderLeft:`2px solid ${fromColor}`, paddingLeft:7, paddingTop:3, paddingBottom:3, background: m.isUser ? "rgba(0,255,136,0.04)" : "transparent", borderRadius:"0 4px 4px 0", animation: i === msgs.length-1 ? "commSlide 0.3s ease-out" : "none" }}>
<div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:2 }}>
<span style={{ fontSize:8, color:fromColor, fontFamily:"monospace", fontWeight:700 }}>{m.from}</span>
<span style={{ fontSize:7, color:"#1e293b" }}>→</span>
<span style={{ fontSize:8, color:toColor, fontFamily:"monospace" }}>{m.to === "ALL" ? "ALL AGENTS" : m.to}</span>
<span style={{ fontSize:7, color:"#1e293b", marginLeft:"auto", fontFamily:"monospace" }}>{m.ts}</span>
</div>
<div style={{ fontSize:9, color: m.isUser ? "#e2e8f0" : "#64748b", fontFamily:"monospace", lineHeight:1.5 }}>{m.msg}</div>
</div>
);
})}
</div>
<div style={{ borderTop:"1px solid rgba(0,255,136,0.1)", padding:"7px 10px", display:"flex", gap:6, flexShrink:0 }}>
<select value={target} onChange={e=>setTarget(e.target.value)} style={{ background:"rgba(0,0,0,0.5)", border:"1px solid rgba(0,255,136,0.15)", borderRadius:6, color:"#00ff88", fontSize:8, padding:"5px 6px", fontFamily:"monospace", cursor:"pointer", flexShrink:0 }}>
<option value="ALL">→ ALL</option>
{AGENTS.map(a => <option key={a.id} value={a.name}>→ {a.name}</option>)}
</select>
<input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()} placeholder="broadcast to swarm..." style={{ flex:1, background:"rgba(0,255,136,0.04)", border:"1px solid rgba(0,255,136,0.15)", borderRadius:8, padding:"6px 10px", color:"#fff", fontSize:10, outline:"none", fontFamily:"monospace" }}/>
<button onClick={send} style={{ background:"rgba(0,255,136,0.1)", border:"1px solid rgba(0,255,136,0.4)", borderRadius:8, color:"#00ff88", padding:"6px 12px", cursor:"pointer", fontSize:10, fontWeight:700, fontFamily:"monospace", letterSpacing:1, transition:"all 0.2s" }}>SEND</button>
</div>
</div>
);
}

function ChatBot({ salesData }) {
const [activeTab, setActiveTab] = useState("COMMAND");
const [messages, setMessages] = useState([{ role:"assistant", content:"**SWARMX PRIME ONLINE**\n\n• 11 agents deployed and working\n• Shopify connected — products loaded\n• Etsy store live — 1 listing active\n• Click any agent · Type any command" }]);
const [input, setInput] = useState("");
const [loading, setLoading] = useState(false);
const [savedOpen, setSavedOpen] = useState(false);
const [commCount, setCommCount] = useState(0);
const bottomRef = useRef(null);
const saved = [
{ date:"Today 1:42 PM", preview:"$150 capital deployment strategy...", tag:"STRATEGY", color:"#00ff88" },
{ date:"Today 12:18 PM", preview:"Top products to push right now...", tag:"PRODUCTS", color:"#06b6d4" },
{ date:"Yesterday 8:33 PM", preview:"Halloween SVG bundle analysis...", tag:"INTEL", color:"#f59e0b" },
{ date:"Yesterday 3:15 PM", preview:"First Etsy sale strategy...", tag:"SALES", color:"#a855f7" },
{ date:"May 25 11:20 AM", preview:"Dog Mom SVG trend spike analysis...", tag:"TRENDS", color:"#ec4899" },
];
useEffect(()=>{ bottomRef.current?.scrollIntoView({behavior:"smooth"}); },[messages]);

const handleCommCount = () => {
if (activeTab !== "COMM") setCommCount(c => c + 1);
};

const send = async () => {
if (!input.trim()||loading) return;
const msg=input.trim(); setInput("");
setMessages(p=>[...p,{role:"user",content:msg}]); setLoading(true);
try {
const r=await fetch("/api/swarm",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt:`SWARMX PRIME of HOUSE OF JREYM. Format:\n- **BOLD HEADERS**\n- • bullets\n- ▸ action items\nStore: $${salesData?.revenue||0} rev, ${salesData?.orders||0} orders, ${salesData?.products||0} products.\nUser: ${msg}`,history:messages.map(m=>({role:m.role,content:m.content}))})});
const data=await r.json(); const reply=data.reply||"No response";
let gd=null; const match=reply.match(/GRAPH_DATA:(\[.*?\])/s);
if(match){try{gd=JSON.parse(match[1]);}catch(e){}}
setMessages(p=>[...p,{role:"assistant",content:reply.replace(/GRAPH_DATA:\[.*?\]/s,"").trim(),graphData:gd}]);
} catch(e){ setMessages(p=>[...p,{role:"assistant",content:"⚠ Error: "+e.message}]); }
setLoading(false);
};

const renderMsg=(msg,i)=>{
const isUser=msg.role==="user";
const lines=msg.content.split("\n").filter(l=>l.trim());
return (
<div key={i} style={{marginBottom:10,display:"flex",flexDirection:"column",alignItems:isUser?"flex-end":"flex-start"}}>
{!isUser&&<div style={{fontSize:7,color:"#00ff88",fontFamily:"monospace",letterSpacing:2,marginBottom:3}}>⚡ SWARMX PRIME</div>}
<div style={{maxWidth:"92%",background:isUser?"rgba(0,255,136,0.07)":"rgba(255,255,255,0.02)",border:`1px solid ${isUser?"rgba(0,255,136,0.2)":"rgba(255,255,255,0.05)"}`,borderRadius:isUser?"12px 12px 3px 12px":"3px 12px 12px 12px",padding:"8px 12px",backdropFilter:"blur(4px)"}}>
{lines.map((line,j)=>{
if(/^\*\*.*\*\*$/.test(line.trim())) return <div key={j} style={{fontSize:11,color:"#00ff88",fontWeight:700,marginBottom:4,marginTop:j>0?8:0,borderBottom:"1px solid rgba(0,255,136,0.15)",paddingBottom:3,fontFamily:"monospace",letterSpacing:1}}>{line.replace(/\*\*/g,"")}</div>;
if(/^▸/.test(line)) return <div key={j} style={{display:"flex",gap:6,marginBottom:4}}><span style={{color:"#f59e0b",flexShrink:0}}>▸</span><span style={{fontSize:11,color:"#f59e0b",lineHeight:1.6,fontFamily:"monospace"}}>{line.replace(/^▸\s*/,"")}</span></div>;
if(/^[•\-]/.test(line)) return <div key={j} style={{display:"flex",gap:6,marginBottom:4}}><span style={{color:"#00ff88",flexShrink:0,fontSize:9}}>▪</span><span style={{fontSize:11,color:"#cbd5e1",lineHeight:1.6,fontFamily:"monospace"}}>{line.replace(/^[•\-]\s*/,"").replace(/\*\*(.*?)\*\*/g,"$1")}</span></div>;
return <div key={j} style={{fontSize:11,color:"#94a3b8",lineHeight:1.6,fontFamily:"monospace",marginBottom:2}}>{line.replace(/\*\*(.*?)\*\*/g,"$1")}</div>;
})}
{msg.graphData?.length>0&&(
<div style={{marginTop:8,background:"rgba(0,0,0,0.4)",borderRadius:6,padding:8,border:"1px solid rgba(0,255,136,0.1)"}}>
<div style={{fontSize:7,color:"#334155",marginBottom:4,fontFamily:"monospace",letterSpacing:2}}>◈ DATA VIZ</div>
<ResponsiveContainer width="100%" height={90}><BarChart data={msg.graphData}><XAxis dataKey="name" tick={{fontSize:8,fill:"#475569",fontFamily:"monospace"}}/><YAxis tick={{fontSize:8,fill:"#475569"}}/><Tooltip contentStyle={{background:"#02040a",border:"1px solid rgba(0,255,136,0.2)",fontSize:9,fontFamily:"monospace"}}/><Bar dataKey="value" fill="#00ff88" radius={[3,3,0,0]}/></BarChart></ResponsiveContainer>
</div>
)}
</div>
</div>
);
};

const TABS = ["COMMAND", "COMM"];
const tabColors = { COMMAND:"#00ff88", COMM:"#06b6d4" };

return (
<div style={{display:"flex",flexDirection:"column",height:"100%",background:"rgba(0,0,0,0.5)",border:"1px solid rgba(0,255,136,0.15)",borderRadius:14,overflow:"hidden",backdropFilter:"blur(16px)"}}>
{/* Tab bar */}
<div style={{display:"flex",borderBottom:"1px solid rgba(0,255,136,0.1)",flexShrink:0}}>
{TABS.map(tab => {
const isActive = activeTab === tab;
const tc = tabColors[tab];
return (
<button key={tab} onClick={() => { setActiveTab(tab); if (tab==="COMM") setCommCount(0); }} style={{ flex:1, padding:"8px 4px", background: isActive ? `${tc}11` : "transparent", border:"none", borderBottom:`2px solid ${isActive ? tc : "transparent"}`, color: isActive ? tc : "#334155", fontSize:9, fontFamily:"monospace", letterSpacing:2, cursor:"pointer", transition:"all 0.2s", position:"relative" }}>
{tab}
{tab==="COMM" && commCount > 0 && (
<span style={{ position:"absolute", top:4, right:8, background:"#06b6d4", color:"#000", borderRadius:"50%", width:14, height:14, fontSize:7, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:"bold" }}>
{commCount > 99 ? "99" : commCount}
</span>
)}
</button>
);
})}
</div>

{/* COMMAND TAB */}
{activeTab === "COMMAND" && (
<>
<div style={{padding:"8px 14px",borderBottom:"1px solid rgba(0,255,136,0.1)",display:"flex",alignItems:"center",gap:8,background:"rgba(0,255,136,0.02)",flexShrink:0}}>
<div style={{width:8,height:8,borderRadius:"50%",background:"#00ff88",boxShadow:"0 0 10px #00ff88",animation:"pulse 2s infinite"}}/>
<span style={{fontSize:9,color:"#00ff88",fontWeight:700,letterSpacing:3,fontFamily:"monospace"}}>SWARMX COMMAND</span>
<div style={{marginLeft:"auto",display:"flex",gap:6,alignItems:"center"}}>
<span style={{fontSize:7,color:"rgba(0,255,136,0.3)",fontFamily:"monospace"}}>11 ACTIVE</span>
<button onClick={()=>setSavedOpen(!savedOpen)} style={{background:"rgba(0,255,136,0.06)",border:"1px solid rgba(0,255,136,0.2)",borderRadius:4,color:"#00ff88",fontSize:8,padding:"2px 8px",cursor:"pointer",fontFamily:"monospace"}}>{savedOpen?"HIDE ▴":"SAVED ▾"}</button>
</div>
</div>
{savedOpen&&(
<div style={{background:"rgba(0,0,0,0.5)",borderBottom:"1px solid rgba(0,255,136,0.08)",padding:"8px 12px",flexShrink:0}}>
<div style={{fontSize:7,color:"rgba(0,255,136,0.4)",fontFamily:"monospace",letterSpacing:2,marginBottom:5}}>◈ SAVED · LAST 3 DAYS</div>
{saved.map((s,i)=>(
<div key={i} style={{display:"flex",gap:8,alignItems:"center",padding:"4px 0",borderBottom:i<saved.length-1?"1px solid rgba(255,255,255,0.03)":"none",cursor:"pointer"}}>
<span style={{fontSize:7,color:s.color,fontFamily:"monospace",background:`${s.color}15`,padding:"1px 5px",borderRadius:3,flexShrink:0}}>{s.tag}</span>
<span style={{fontSize:7,color:"#475569",fontFamily:"monospace",flexShrink:0}}>{s.date}</span>
<span style={{fontSize:8,color:"#334155",fontFamily:"monospace",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.preview}</span>
</div>
))}
</div>
)}
<div style={{flex:1,overflowY:"auto",padding:12,scrollbarWidth:"thin",scrollbarColor:"rgba(0,255,136,0.2) transparent"}}>
{messages.map(renderMsg)}
{loading&&<div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:5,height:5,borderRadius:"50%",background:"#00ff88",animation:"pulse 0.8s infinite"}}/><span style={{fontSize:9,color:"rgba(0,255,136,0.4)",fontFamily:"monospace",letterSpacing:2}}>ANALYZING...</span></div>}
<div ref={bottomRef}/>
</div>
<div style={{padding:"8px 10px",borderTop:"1px solid rgba(0,255,136,0.1)",display:"flex",gap:8,background:"rgba(0,0,0,0.3)",flexShrink:0}}>
<input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()} placeholder="Command SWARMX empire..." style={{flex:1,background:"rgba(0,255,136,0.04)",border:"1px solid rgba(0,255,136,0.15)",borderRadius:8,padding:"8px 12px",color:"#fff",fontSize:11,outline:"none",fontFamily:"monospace"}}/>
<button onClick={send} disabled={loading} style={{background:loading?"transparent":"rgba(0,255,136,0.1)",border:`1px solid ${loading?"#1e293b":"rgba(0,255,136,0.4)"}`,borderRadius:8,color:loading?"#334155":"#00ff88",padding:"8px 16px",cursor:loading?"not-allowed":"pointer",fontSize:10,fontWeight:700,fontFamily:"monospace",letterSpacing:1,transition:"all 0.2s"}}>{loading?"···":"SEND"}</button>
</div>
</>
)}

{/* COMM TAB */}
{activeTab === "COMM" && (
<>
<div style={{padding:"6px 14px",borderBottom:"1px solid rgba(6,182,212,0.15)",display:"flex",alignItems:"center",gap:8,background:"rgba(6,182,212,0.02)",flexShrink:0}}>
<div style={{width:7,height:7,borderRadius:"50%",background:"#06b6d4",boxShadow:"0 0 8px #06b6d4",animation:"pulse 1.5s infinite"}}/>
<span style={{fontSize:9,color:"#06b6d4",fontWeight:700,letterSpacing:3,fontFamily:"monospace"}}>SWARM COMM CHANNEL</span>
<span style={{fontSize:7,color:"#1e293b",fontFamily:"monospace",marginLeft:4}}>LIVE INTER-AGENT NETWORK</span>
<div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:5}}>
<div style={{width:5,height:5,borderRadius:"50%",background:"#00ff88",animation:"pulse 1s infinite"}}/>
<span style={{fontSize:7,color:"#00ff88",fontFamily:"monospace"}}>STREAMING</span>
</div>
</div>
<CommChannel onBroadcast={() => {}} />
</>
)}
</div>
);
}

function AlertBanner() {
const [open,setOpen]=useState(false);
const [tick,setTick]=useState(0);
const alerts=[
{type:"SALE OPP",msg:"Halloween SVG Bundle — 3 store views last hour",color:"#00ff88",hot:true},
{type:"TREND",msg:"'Dog mom SVG' searches +340% — post now",color:"#f59e0b",hot:true},
{type:"ALERT",msg:"Etsy ads not active — losing 40+ daily impressions",color:"#ef4444",hot:true},
{type:"INTEL",msg:"Boho wall art trending — 2.1k searches today",color:"#06b6d4",hot:false},
{type:"OPP",msg:"Competitor dropped price on Tumbler SVG",color:"#a855f7",hot:false},
];
useEffect(()=>{const t=setInterval(()=>setTick(p=>(p+1)%alerts.length),3500);return()=>clearInterval(t);},[]);
return (
<div style={{position:"relative",zIndex:100,flexShrink:0}}>
<div onClick={()=>setOpen(!open)} style={{background:"rgba(0,0,0,0.85)",borderBottom:"1px solid rgba(0,255,136,0.12)",padding:"5px 16px",display:"flex",alignItems:"center",gap:12,cursor:"pointer",backdropFilter:"blur(10px)"}}>
<div style={{width:6,height:6,borderRadius:"50%",background:alerts[tick].color,boxShadow:`0 0 8px ${alerts[tick].color}`,animation:"pulse 1s infinite",flexShrink:0}}/>
<span style={{fontSize:8,color:alerts[tick].color,fontFamily:"monospace",fontWeight:700,letterSpacing:2,flexShrink:0}}>[ {alerts[tick].type} ]</span>
<span style={{fontSize:10,color:alerts[tick].hot?"#e2e8f0":"#64748b",fontFamily:"monospace",flex:1}}>{alerts[tick].msg}</span>
<span style={{fontSize:8,color:"#334155",fontFamily:"monospace",flexShrink:0}}>{alerts.length} ALERTS {open?"▴":"▾"}</span>
</div>
{open&&(
<div style={{position:"absolute",top:"100%",left:0,right:0,background:"rgba(2,4,10,0.97)",border:"1px solid rgba(0,255,136,0.1)",borderTop:"none",zIndex:200,backdropFilter:"blur(20px)"}}>
{alerts.map((a,i)=>(
<div key={i} style={{padding:"7px 16px",display:"flex",gap:10,alignItems:"center",borderBottom:i<alerts.length-1?"1px solid rgba(255,255,255,0.03)":"none"}}>
<div style={{width:5,height:5,borderRadius:"50%",background:a.color,flexShrink:0}}/>
<span style={{fontSize:8,color:a.color,fontFamily:"monospace",fontWeight:700,width:70,flexShrink:0}}>[ {a.type} ]</span>
<span style={{fontSize:10,color:a.hot?"#e2e8f0":"#64748b",fontFamily:"monospace"}}>{a.msg}</span>
</div>
))}
</div>
)}
</div>
);
}

function TrafficGraphs({ salesData }) {
const [tw,setTw]=useState("24hr");
const [hourly,setHourly]=useState([]);
const [live,setLive]=useState([{time:"now",v:21}]);
useEffect(()=>{
fetch("/api/sales/hourly").then(r=>r.json()).then(d=>{setHourly((d.snapshots||[]).map(s=>({time:new Date(s.snapshot_at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}),shopify:s.shopify_revenue||0,etsy:s.etsy_revenue||0,orders:(s.shopify_orders||0)+(s.etsy_orders||0)})));}).catch(()=>{});
const t=setInterval(()=>{const now=new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});setLive(p=>[...p,{time:now,v:Math.floor(Math.random()*60+5)}].slice(-16));},7000);
return()=>clearInterval(t);
},[]);
const base=hourly.length>0?hourly:Array.from({length:24},(_,i)=>({time:`${i.toString().padStart(2,"0")}:00`,shopify:Math.random()*180+10,etsy:Math.random()*120+5,orders:Math.floor(Math.random()*7)}));
const data=tw==="1hr"?base.slice(-4):tw==="6hr"?base.slice(-12):base;
const GCard=({title,color,dk,d,bar,extra})=>(
<div style={{background:"rgba(0,0,0,0.5)",border:`1px solid ${color}22`,borderRadius:10,padding:"8px 10px",backdropFilter:"blur(6px)"}}>
<div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
<span style={{fontSize:8,color,fontFamily:"monospace",fontWeight:700,letterSpacing:1}}>{title} · {tw}</span>
{extra&&<span style={{fontSize:9,color,fontFamily:"monospace",fontWeight:700}}>{extra}</span>}
</div>
<ResponsiveContainer width="100%" height={80}>
{bar?(
<BarChart data={d}><CartesianGrid strokeDasharray="2 2" stroke="rgba(255,255,255,0.03)"/><XAxis dataKey="time" tick={{fontSize:6,fill:"#334155",fontFamily:"monospace"}} interval={Math.floor(d.length/4)}/><YAxis tick={{fontSize:6,fill:"#334155"}} width={20}/><Tooltip contentStyle={{background:"#02040a",border:`1px solid ${color}33`,fontSize:8,fontFamily:"monospace"}}/><Bar dataKey={dk} fill={color} radius={[2,2,0,0]} opacity={0.85}/></BarChart>
):(
<AreaChart data={d}><defs><linearGradient id={`g${dk}`} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={color} stopOpacity={0.3}/><stop offset="95%" stopColor={color} stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="2 2" stroke="rgba(255,255,255,0.03)"/><XAxis dataKey="time" tick={{fontSize:6,fill:"#334155",fontFamily:"monospace"}} interval={Math.floor(d.length/4)}/><YAxis tick={{fontSize:6,fill:"#334155"}} width={20}/><Tooltip contentStyle={{background:"#02040a",border:`1px solid ${color}33`,fontSize:8,fontFamily:"monospace"}}/><Area type="monotone" dataKey={dk} stroke={color} strokeWidth={2} fill={`url(#g${dk})`} dot={false}/></AreaChart>
)}
</ResponsiveContainer>
</div>
);
return (
<div style={{flexShrink:0}}>
<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6,padding:"0 2px"}}>
<span style={{fontSize:7,color:"#334155",fontFamily:"monospace",letterSpacing:3}}>━ LIVE PLATFORM TRAFFIC ━</span>
<div style={{display:"flex",gap:4,alignItems:"center"}}>
{["1hr","6hr","24hr"].map(w=><button key={w} onClick={()=>setTw(w)} style={{background:tw===w?"rgba(0,255,136,0.12)":"transparent",border:`1px solid ${tw===w?"rgba(0,255,136,0.4)":"#1e293b"}`,borderRadius:4,color:tw===w?"#00ff88":"#334155",fontSize:8,padding:"2px 8px",cursor:"pointer",fontFamily:"monospace",fontWeight:tw===w?700:400,transition:"all 0.2s"}}>{w}</button>)}
<div style={{display:"flex",alignItems:"center",gap:4,marginLeft:6}}><div style={{width:5,height:5,borderRadius:"50%",background:"#00ff88",boxShadow:"0 0 6px #00ff88",animation:"pulse 2s infinite"}}/><span style={{fontSize:7,color:"#00ff88",fontFamily:"monospace"}}>LIVE</span></div>
</div>
</div>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8}}>
<GCard title="🛍 SHOPIFY" color="#06b6d4" dk="shopify" d={data} extra={salesData?.revenue>0?`$${salesData.revenue}`:"$—"}/>
<GCard title="🏪 ETSY" color="#f59e0b" dk="etsy" d={data} extra="PENDING"/>
<GCard title="📦 ORDERS" color="#00ff88" dk="orders" d={data} bar extra={`${salesData?.orders||0}`}/>
<GCard title="🌐 VISITORS" color="#a855f7" dk="v" d={live} extra={live.length>0?`${live[live.length-1].v}`:"—"}/>
</div>
</div>
);
}

export default function SwarmBase() {
const [selected,setSelected]=useState(null);
const [salesData,setSalesData]=useState({revenue:0,orders:0,products:0});
const [time,setTime]=useState(new Date());
useEffect(()=>{const t=setInterval(()=>setTime(new Date()),1000);return()=>clearInterval(t);},[]);
useEffect(()=>{
const load=async()=>{
try{
const [o,p]=await Promise.all([fetch("/api/shopify/orders").then(r=>r.json()),fetch("/api/shopify/products").then(r=>r.json())]);
const orders=o.orders||[];
const rev=orders.reduce((s,x)=>s+parseFloat(x.total_price||0),0);
setSalesData({revenue:parseFloat(rev.toFixed(2)),orders:orders.length,products:(p.products||[]).length});
}catch(e){}
};
load();
const t=setInterval(load,30*60*1000);
return()=>clearInterval(t);
},[]);
return (
<div style={{background:"#02040a",minHeight:"100vh",color:"#e2e8f0",fontFamily:"'Courier New',monospace",display:"flex",flexDirection:"column",overflow:"hidden"}}>
<div style={{position:"fixed",inset:0,background:"repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.015) 2px,rgba(0,0,0,0.015) 4px)",pointerEvents:"none",zIndex:999}}/>
<AlertBanner/>
<div style={{display:"flex",alignItems:"center",padding:"5px 14px",borderBottom:"1px solid rgba(0,255,136,0.1)",background:"rgba(0,0,0,0.75)",backdropFilter:"blur(10px)",flexShrink:0}}>
<div style={{display:"flex",gap:5}}>
{[{i:"👥",v:"12",c:"#4ade80"},{i:"🔥",v:"38",c:"#f97316"},{i:"💧",v:"64",c:"#60a5fa"},{i:"⚡",v:"92",c:"#facc15"},{i:"🛡️",v:"17",c:"#a78bfa"}].map((s,i)=>(
<div key={i} style={{display:"flex",alignItems:"center",gap:3,background:"rgba(255,255,255,0.03)",borderRadius:4,padding:"2px 6px",border:"1px solid rgba(255,255,255,0.05)"}}>
<span style={{fontSize:9}}>{s.i}</span><span style={{fontSize:9,color:s.c,fontWeight:700}}>{s.v}</span>
</div>
))}
</div>
<div style={{flex:1,textAlign:"center"}}>
<div style={{fontSize:15,fontWeight:900,letterSpacing:8,color:"#fff",textShadow:"0 0 20px rgba(0,255,136,0.3)"}}>HOUSE OF JREYM</div>
<div style={{fontSize:6,color:"rgba(0,255,136,0.25)",letterSpacing:5}}>AUTONOMOUS AI COMMERCE · {AGENTS.length} AGENTS DEPLOYED</div>
</div>
<div style={{display:"flex",alignItems:"center",gap:8}}>
<span style={{fontSize:11,color:"#475569",fontFamily:"monospace"}}>{time.toLocaleTimeString()}</span>
<div style={{background:"rgba(0,255,136,0.06)",border:"1px solid rgba(0,255,136,0.25)",borderRadius:6,padding:"3px 10px",fontSize:8,color:"#00ff88",display:"flex",alignItems:"center",gap:5,fontFamily:"monospace"}}>
<div style={{width:5,height:5,borderRadius:"50%",background:"#00ff88",animation:"pulse 2s infinite"}}/>
{selected?.icon||"🏛️"} {selected?.name||"HQ"} · ACTIVE
</div>
</div>
</div>
<div style={{display:"flex",gap:14,alignItems:"center",justifyContent:"center",background:"rgba(0,255,136,0.015)",borderBottom:"1px solid rgba(0,255,136,0.06)",padding:"4px 16px",fontSize:10,fontFamily:"monospace",flexShrink:0}}>
<span style={{color:"#00ff88",fontWeight:700}}>💰 {salesData.revenue>0?`$${salesData.revenue.toLocaleString()}`:"AWAITING FIRST SALE"}</span>
<span style={{color:"#1e293b"}}>·</span>
<span style={{color:"#475569"}}>📦 {salesData.orders} ORDERS · 🛒 {salesData.products} PRODUCTS</span>
<span style={{color:"#1e293b"}}>·</span>
<span style={{color:"rgba(6,182,212,0.5)",fontSize:8}}>PIPELINE ACTIVE · DAILY 8AM UTC</span>
</div>
<div style={{display:"grid",gridTemplateColumns:"1fr 370px",gap:8,padding:"8px",flex:1,minHeight:0}}>
<div style={{position:"relative",background:"rgba(0,0,0,0.3)",border:"1px solid rgba(0,255,136,0.07)",borderRadius:12,overflow:"hidden",backdropFilter:"blur(4px)"}}>
<div style={{position:"absolute",inset:0,backgroundImage:"linear-gradient(rgba(0,255,136,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(0,255,136,0.025) 1px,transparent 1px)",backgroundSize:"50px 50px",pointerEvents:"none"}}/>
{[[{top:0,left:0},{borderRight:"none",borderBottom:"none"}],[{top:0,right:0},{borderLeft:"none",borderBottom:"none"}],[{bottom:0,left:0},{borderRight:"none",borderTop:"none"}],[{bottom:0,right:0},{borderLeft:"none",borderTop:"none"}]].map(([pos,bStyle],i)=>(
<div key={i} style={{position:"absolute",...pos,width:18,height:18,border:"1px solid rgba(0,255,136,0.25)",...bStyle}}/>
))}
<CentralHQ salesData={salesData}/>
{AGENTS.map(a=><MovingAgent key={a.id} agent={a} selected={selected} onSelect={setSelected} salesData={salesData}/>)}
<div style={{position:"absolute",bottom:8,left:"50%",transform:"translateX(-50%)",fontSize:7,color:"rgba(0,255,136,0.15)",fontFamily:"monospace",letterSpacing:3,whiteSpace:"nowrap"}}>◈ CLICK ANY AGENT ◈</div>
</div>
<div style={{minHeight:0}}><ChatBot salesData={salesData}/></div>
</div>
<div style={{padding:"0 8px 8px",flexShrink:0}}><TrafficGraphs salesData={salesData}/></div>
<style>{`
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
  @keyframes commSlide{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
  ::-webkit-scrollbar{width:3px}
  ::-webkit-scrollbar-track{background:transparent}
  ::-webkit-scrollbar-thumb{background:rgba(0,255,136,0.2);border-radius:2px}
  *{box-sizing:border-box}
  input::placeholder{color:rgba(0,255,136,0.25)}
`}</style>
</div>
);
}
