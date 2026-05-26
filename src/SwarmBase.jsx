import { useState, useEffect, useRef } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area, CartesianGrid } from "recharts";

const AGENTS = [
  { id: 1, name: "TREND HUNTER", role: "Market Intel", icon: "🔍", color: "#00ff64" },
  { id: 2, name: "PRODUCT CREATOR", role: "Innovation", icon: "⚡", color: "#ff6b35" },
  { id: 3, name: "MARKETING", role: "Brand Strategy", icon: "📣", color: "#a855f7" },
  { id: 4, name: "SEO OPTIMIZATION", role: "Search Dominance", icon: "🎯", color: "#f59e0b" },
  { id: 5, name: "LISTINGS & CONTENT", role: "Content Architect", icon: "📋", color: "#06b6d4" },
  { id: 6, name: "ANALYTICS & ADS", role: "Data Intel", icon: "📊", color: "#ec4899" },
  { id: 7, name: "PRICING & PROFIT", role: "Revenue Ops", icon: "💰", color: "#84cc16" },
  { id: 8, name: "CUSTOMER SERVICE", role: "Support Commander", icon: "💬", color: "#f97316" },
  { id: 9, name: "SUPPLIER SCOUT", role: "Supply Chain", icon: "🚚", color: "#0ea5e9" },
  { id: 10, name: "AUTOMATION ENGINEER", role: "Efficiency Master", icon: "⚙️", color: "#6366f1" },
  { id: 11, name: "STRATEGY LEAD", role: "Prime Director", icon: "👑", color: "#F59E0B" },
];

const UPDATE_INTERVALS = { "1hr": 60 * 60 * 1000, "6hr": 6 * 60 * 60 * 1000, "24hr": 24 * 60 * 60 * 1000 };

// ─── AGENT CARD ────────────────────────────────────────────────────────────────
function AgentCard({ agent, salesData }) {
  const [interval, setInterval_] = useState("6hr");
  const [open, setOpen] = useState(false);
  const [agentData, setAgentData] = useState(null);
  const [loadingData, setLoadingData] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const fetchAgentData = async () => {
    setLoadingData(true);
    try {
      const [products, orders] = await Promise.all([
        fetch("/api/shopify/products").then(r => r.json()),
        fetch("/api/shopify/orders").then(r => r.json()),
      ]);
      setAgentData({
        products: (products.products || []).slice(0, 4),
        orders: orders.orders || [],
        lastUpdated: new Date().toLocaleTimeString(),
      });
    } catch (e) { console.error(e); }
    setLoadingData(false);
  };

  useEffect(() => { fetchAgentData(); }, [interval]);

  // Auto-refresh based on selected interval
  useEffect(() => {
    const ms = UPDATE_INTERVALS[interval];
    const t = setInterval(fetchAgentData, ms);
    return () => clearInterval(t);
  }, [interval]);

  return (
    <div
      style={{ background: "rgba(0,0,0,0.6)", border: `1px solid ${agent.color}33`, borderRadius: 10, padding: 10, position: "relative", cursor: "pointer", transition: "border-color 0.2s" }}
      onClick={() => setExpanded(!expanded)}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <div style={{ width: 36, height: 36, borderRadius: "50%", background: `radial-gradient(circle at 35% 35%, ${agent.color}88, ${agent.color}22)`, border: `2px solid ${agent.color}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>
          {agent.icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 9, color: agent.color, fontWeight: 700, letterSpacing: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{agent.name}</div>
          <div style={{ fontSize: 8, color: "#666" }}>{agent.role}</div>
        </div>
        {/* ── 1hr / 6hr / 24hr DROPDOWN ── */}
        <div style={{ position: "relative", flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          <button
            onClick={() => setOpen(!open)}
            style={{ background: `${agent.color}22`, border: `1px solid ${agent.color}55`, borderRadius: 4, color: agent.color, fontSize: 9, padding: "3px 7px", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, letterSpacing: 0.5 }}
          >
            {interval} ▾
          </button>
          {open && (
            <div style={{ position: "absolute", right: 0, top: "110%", background: "#0a0a0f", border: `1px solid ${agent.color}55`, borderRadius: 6, zIndex: 200, overflow: "hidden", boxShadow: `0 4px 20px ${agent.color}22` }}>
              {["1hr", "6hr", "24hr"].map(opt => (
                <div
                  key={opt}
                  onClick={() => { setInterval_(opt); setOpen(false); fetchAgentData(); }}
                  style={{ padding: "6px 16px", fontSize: 10, color: interval === opt ? agent.color : "#777", cursor: "pointer", background: interval === opt ? `${agent.color}18` : "transparent", fontWeight: interval === opt ? 700 : 400, transition: "background 0.15s" }}
                >
                  {opt}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        {[
          { val: agentData?.products?.length ?? 0, label: "PRODUCTS", color: agent.color },
          { val: agentData?.orders?.length ?? 0, label: "ORDERS", color: "#fff" },
          { val: `$${salesData?.revenue || 0}`, label: "REVENUE", color: "#00ff64" },
        ].map((stat, i) => (
          <div key={i} style={{ flex: 1, background: "rgba(255,255,255,0.03)", borderRadius: 4, padding: "4px 4px", textAlign: "center" }}>
            <div style={{ fontSize: 12, color: stat.color, fontWeight: 700 }}>{stat.val}</div>
            <div style={{ fontSize: 7, color: "#444", letterSpacing: 0.5 }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* refresh label */}
      <div style={{ fontSize: 7, color: "#333", textAlign: "right" }}>
        🔄 every {interval} {agentData?.lastUpdated ? `· ${agentData.lastUpdated}` : ""}
      </div>

      {expanded && agentData?.products?.length > 0 && (
        <div style={{ borderTop: `1px solid ${agent.color}22`, paddingTop: 6, marginTop: 6 }}>
          <div style={{ fontSize: 8, color: "#555", marginBottom: 4 }}>LIVE INVENTORY</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
            {agentData.products.map((p, i) => (
              <div key={i} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 4, overflow: "hidden", border: `1px solid ${agent.color}22` }}>
                {p.image?.src && <img src={p.image.src} alt={p.title} style={{ width: "100%", height: 45, objectFit: "cover", display: "block" }} />}
                <div style={{ padding: "3px 5px" }}>
                  <div style={{ fontSize: 7, color: "#ccc", lineHeight: 1.2 }}>{p.title?.slice(0, 22)}</div>
                  <div style={{ fontSize: 8, color: agent.color, fontWeight: 700 }}>${p.variants?.[0]?.price || "—"}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {loadingData && <div style={{ fontSize: 7, color: "#333", textAlign: "center", marginTop: 4 }}>refreshing…</div>}
    </div>
  );
}

// ─── CHATBOT ───────────────────────────────────────────────────────────────────
function ChatBot({ salesData }) {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: "**SWARMX COMMAND CENTER ONLINE**\n\n• Ask about your Shopify or Etsy store\n• Sales trends, inventory, pricing strategy\n• Marketing opportunities & traffic insights\n• I respond with data-driven bullet briefings",
      type: "text",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const send = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: userMsg }]);
    setLoading(true);
    try {
      const r = await fetch("/api/swarm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `You are the SWARMX AI command center for House of Jreym. Answer in bulletin format:\n- Use **SECTION HEADERS** in bold\n- Use • bullet points for every data point or insight\n- Use ▸ ACTION items labeled clearly\n- Keep answers dense, tactical, and specific\n\nUser question: ${userMsg}\n\nCurrent store data: Revenue $${salesData?.revenue || 0}, Orders: ${salesData?.orders || 0}, Products: ${salesData?.products || 0}.\n\nIf relevant, append graph data as: GRAPH_DATA:[{"name":"label","value":number}]`,
          history: messages.map(m => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await r.json();
      const reply = data.reply || data.error || "No response";
      let graphData = null;
      const graphMatch = reply.match(/GRAPH_DATA:(\[.*?\])/s);
      if (graphMatch) {
        try { graphData = JSON.parse(graphMatch[1]); } catch (e) {}
      }
      const cleanReply = reply.replace(/GRAPH_DATA:\[.*?\]/s, "").trim();
      setMessages(prev => [...prev, { role: "assistant", content: cleanReply, graphData, type: "text" }]);
    } catch (e) {
      setMessages(prev => [...prev, { role: "assistant", content: "⚠ Error: " + e.message }]);
    }
    setLoading(false);
  };

  const renderMessage = (msg, i) => {
    const isUser = msg.role === "user";
    const lines = msg.content.split("\n").filter(l => l.trim());
    return (
      <div key={i} style={{ marginBottom: 14, display: "flex", flexDirection: "column", alignItems: isUser ? "flex-end" : "flex-start" }}>
        {!isUser && (
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#00ff64", boxShadow: "0 0 6px #00ff64" }} />
            <div style={{ fontSize: 8, color: "#00ff64", letterSpacing: 1.5, fontWeight: 700 }}>SWARMX ANALYSIS</div>
          </div>
        )}
        <div style={{
          maxWidth: "92%",
          background: isUser ? "rgba(0,255,100,0.08)" : "rgba(255,255,255,0.03)",
          border: isUser ? "1px solid #00ff6433" : "1px solid #ffffff0d",
          borderRadius: isUser ? "12px 12px 4px 12px" : "4px 12px 12px 12px",
          padding: "10px 14px",
        }}>
          {lines.map((line, j) => {
            // Section headers: **TEXT**
            if (/^\*\*.*\*\*$/.test(line.trim())) {
              return (
                <div key={j} style={{ fontSize: 12, color: "#00ff64", fontWeight: 700, marginBottom: 6, marginTop: j > 0 ? 10 : 0, borderBottom: "1px solid #00ff6422", paddingBottom: 4, letterSpacing: 1 }}>
                  {line.replace(/\*\*/g, "")}
                </div>
              );
            }
            // Bullet points • or -
            if (/^[•\-▸]/.test(line)) {
              const isAction = line.startsWith("▸");
              return (
                <div key={j} style={{ display: "flex", gap: 8, marginBottom: 5, alignItems: "flex-start" }}>
                  <span style={{ color: isAction ? "#f59e0b" : "#00ff64", flexShrink: 0, marginTop: 1, fontSize: 11 }}>
                    {isAction ? "▸" : "▪"}
                  </span>
                  <span style={{ fontSize: 12, color: isAction ? "#f59e0b" : "#ccc", lineHeight: 1.6 }}>
                    {line.replace(/^[•\-▸]\s*/, "").replace(/\*\*(.*?)\*\*/g, "$1")}
                  </span>
                </div>
              );
            }
            // Normal text
            return (
              <div key={j} style={{ fontSize: 12, color: "#999", marginBottom: 3, lineHeight: 1.6 }}>
                {line.replace(/\*\*(.*?)\*\*/g, "$1")}
              </div>
            );
          })}

          {/* Inline graph */}
          {msg.graphData && msg.graphData.length > 0 && (
            <div style={{ marginTop: 10, background: "rgba(0,0,0,0.4)", borderRadius: 8, padding: 10, border: "1px solid #00ff6411" }}>
              <div style={{ fontSize: 8, color: "#444", marginBottom: 6, letterSpacing: 1 }}>📊 DATA VISUALIZATION</div>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={msg.graphData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff06" />
                  <XAxis dataKey="name" tick={{ fontSize: 9, fill: "#555" }} />
                  <YAxis tick={{ fontSize: 9, fill: "#555" }} />
                  <Tooltip contentStyle={{ background: "#111", border: "1px solid #333", fontSize: 10 }} />
                  <Bar dataKey="value" fill="#00ff64" radius={[4, 4, 0, 0]} opacity={0.9} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "rgba(0,0,0,0.55)", border: "1px solid #00ff6430", borderRadius: 14, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "10px 16px", borderBottom: "1px solid #00ff6420", display: "flex", alignItems: "center", gap: 10, background: "rgba(0,255,100,0.03)" }}>
        <div style={{ width: 9, height: 9, borderRadius: "50%", background: "#00ff64", boxShadow: "0 0 8px #00ff64", animation: "pulse 2s infinite" }} />
        <div style={{ fontSize: 12, color: "#00ff64", fontWeight: 700, letterSpacing: 2 }}>SWARMX COMMAND CENTER</div>
        <div style={{ marginLeft: "auto", fontSize: 9, color: "#333", letterSpacing: 0.5 }}>PRODUCTS · SALES · TRENDS</div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px 8px", scrollbarWidth: "thin", scrollbarColor: "#222 transparent" }}>
        {messages.map(renderMessage)}
        {loading && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#00ff64", animation: "pulse 1s infinite" }} />
            <div style={{ fontSize: 11, color: "#444", fontStyle: "italic", letterSpacing: 1 }}>SWARMX analyzing…</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: "10px 12px", borderTop: "1px solid #00ff6418", display: "flex", gap: 8, background: "rgba(0,0,0,0.3)" }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && send()}
          placeholder="Ask about products, sales, inventory, trends…"
          style={{ flex: 1, background: "rgba(255,255,255,0.04)", border: "1px solid #00ff6428", borderRadius: 8, padding: "10px 14px", color: "#fff", fontSize: 12, outline: "none", fontFamily: "inherit" }}
        />
        <button
          onClick={send}
          disabled={loading}
          style={{ background: loading ? "#111" : "#00ff6418", border: `1px solid ${loading ? "#333" : "#00ff6455"}`, borderRadius: 8, color: loading ? "#444" : "#00ff64", padding: "10px 18px", cursor: loading ? "not-allowed" : "pointer", fontSize: 11, fontWeight: 700, letterSpacing: 1, transition: "all 0.2s" }}
        >
          {loading ? "…" : "SEND"}
        </button>
      </div>
    </div>
  );
}

// ─── TRAFFIC GRAPHS with 1hr/6hr/24hr switcher ────────────────────────────────
function TrafficGraphs({ salesData }) {
  const [timeWindow, setTimeWindow] = useState("24hr");
  const [hourlyData, setHourlyData] = useState([]);
  const [liveTraffic, setLiveTraffic] = useState([]);

  // Fetch real hourly sales data
  useEffect(() => {
    const fetchData = async () => {
      try {
        const r = await fetch("/api/sales/hourly");
        const data = await r.json();
        const snapshots = data.snapshots || [];
        setHourlyData(snapshots.map(s => ({
          time: new Date(s.snapshot_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          shopify: s.shopify_revenue || 0,
          etsy: s.etsy_revenue || 0,
          total: s.total_revenue || 0,
          orders: (s.shopify_orders || 0) + (s.etsy_orders || 0),
          visitors: Math.floor(Math.random() * 80 + 20),
        })));
      } catch (e) {}
    };
    fetchData();
    const t = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  // Simulate live visitor ticker
  useEffect(() => {
    const tick = () => {
      const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      setLiveTraffic(prev => {
        const next = [...prev, { time: now, visitors: Math.floor(Math.random() * 60 + 10) }];
        return next.slice(-20);
      });
    };
    tick();
    const t = setInterval(tick, 8000);
    return () => clearInterval(t);
  }, []);

  // Slice data based on time window
  const sliceCounts = { "1hr": 12, "6hr": 36, "24hr": 144 };
  const displayPoints = timeWindow === "1hr" ? 12 : timeWindow === "6hr" ? 24 : 48;

  const base = hourlyData.length > 0 ? hourlyData : Array.from({ length: 24 }, (_, i) => ({
    time: `${i.toString().padStart(2, "0")}:00`,
    shopify: Math.random() * 250 + 30,
    etsy: Math.random() * 180 + 20,
    total: Math.random() * 420 + 60,
    orders: Math.floor(Math.random() * 12 + 1),
    visitors: Math.floor(Math.random() * 80 + 15),
  }));

  const chartData = base.slice(-displayPoints);

  const windowBtns = ["1hr", "6hr", "24hr"];

  return (
    <div>
      {/* Time window switcher */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 9, color: "#333", letterSpacing: 3 }}>━━━ LIVE PLATFORM TRAFFIC ━━━</div>
        <div style={{ display: "flex", gap: 4 }}>
          {windowBtns.map(w => (
            <button
              key={w}
              onClick={() => setTimeWindow(w)}
              style={{
                background: timeWindow === w ? "#00ff6422" : "transparent",
                border: `1px solid ${timeWindow === w ? "#00ff6455" : "#333"}`,
                borderRadius: 4,
                color: timeWindow === w ? "#00ff64" : "#555",
                fontSize: 9,
                padding: "3px 10px",
                cursor: "pointer",
                fontFamily: "inherit",
                fontWeight: timeWindow === w ? 700 : 400,
                transition: "all 0.2s",
              }}
            >
              {w}
            </button>
          ))}
          {/* live dot */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 8 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#00ff64", boxShadow: "0 0 6px #00ff64", animation: "pulse 2s infinite" }} />
            <span style={{ fontSize: 8, color: "#00ff64" }}>LIVE</span>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>

        {/* SHOPIFY REVENUE */}
        <div style={{ background: "rgba(0,0,0,0.5)", border: "1px solid #06b6d430", borderRadius: 10, padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 9, color: "#06b6d4", fontWeight: 700, letterSpacing: 1 }}>🛍️ SHOPIFY · {timeWindow}</div>
            <div style={{ fontSize: 10, color: "#06b6d4", fontWeight: 700 }}>${salesData?.revenue || "—"}</div>
          </div>
          <ResponsiveContainer width="100%" height={110}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="shopifyGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" />
              <XAxis dataKey="time" tick={{ fontSize: 7, fill: "#444" }} interval={Math.floor(chartData.length / 4)} />
              <YAxis tick={{ fontSize: 7, fill: "#444" }} width={28} />
              <Tooltip contentStyle={{ background: "#0a0a0f", border: "1px solid #06b6d433", fontSize: 9 }} formatter={v => ["$" + (+v).toFixed(2), "Revenue"]} />
              <Area type="monotone" dataKey="shopify" stroke="#06b6d4" strokeWidth={2} fill="url(#shopifyGrad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* ETSY TRAFFIC */}
        <div style={{ background: "rgba(0,0,0,0.5)", border: "1px solid #f59e0b30", borderRadius: 10, padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 9, color: "#f59e0b", fontWeight: 700, letterSpacing: 1 }}>🏪 ETSY · {timeWindow}</div>
            <div style={{ fontSize: 8, color: "#444" }}>API PENDING</div>
          </div>
          <ResponsiveContainer width="100%" height={110}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="etsyGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" />
              <XAxis dataKey="time" tick={{ fontSize: 7, fill: "#444" }} interval={Math.floor(chartData.length / 4)} />
              <YAxis tick={{ fontSize: 7, fill: "#444" }} width={28} />
              <Tooltip contentStyle={{ background: "#0a0a0f", border: "1px solid #f59e0b33", fontSize: 9 }} formatter={v => ["$" + (+v).toFixed(2), "Revenue"]} />
              <Area type="monotone" dataKey="etsy" stroke="#f59e0b" strokeWidth={2} fill="url(#etsyGrad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* ORDERS */}
        <div style={{ background: "rgba(0,0,0,0.5)", border: "1px solid #00ff6422", borderRadius: 10, padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 9, color: "#00ff64", fontWeight: 700, letterSpacing: 1 }}>📦 ORDERS · {timeWindow}</div>
            <div style={{ fontSize: 10, color: "#00ff64", fontWeight: 700 }}>{salesData?.orders || 0}</div>
          </div>
          <ResponsiveContainer width="100%" height={110}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" />
              <XAxis dataKey="time" tick={{ fontSize: 7, fill: "#444" }} interval={Math.floor(chartData.length / 4)} />
              <YAxis tick={{ fontSize: 7, fill: "#444" }} width={28} />
              <Tooltip contentStyle={{ background: "#0a0a0f", border: "1px solid #00ff6433", fontSize: 9 }} />
              <Bar dataKey="orders" fill="#00ff64" radius={[3, 3, 0, 0]} opacity={0.85} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* LIVE WEBSITE VISITORS */}
        <div style={{ background: "rgba(0,0,0,0.5)", border: "1px solid #a855f730", borderRadius: 10, padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 9, color: "#a855f7", fontWeight: 700, letterSpacing: 1 }}>🌐 VISITORS · LIVE</div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#a855f7", animation: "pulse 1.5s infinite" }} />
              <div style={{ fontSize: 10, color: "#a855f7", fontWeight: 700 }}>
                {liveTraffic.length > 0 ? liveTraffic[liveTraffic.length - 1].visitors : "—"}
              </div>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={110}>
            <AreaChart data={liveTraffic}>
              <defs>
                <linearGradient id="visitorGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#a855f7" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" />
              <XAxis dataKey="time" tick={{ fontSize: 7, fill: "#444" }} interval={4} />
              <YAxis tick={{ fontSize: 7, fill: "#444" }} width={28} />
              <Tooltip contentStyle={{ background: "#0a0a0f", border: "1px solid #a855f733", fontSize: 9 }} />
              <Area type="monotone" dataKey="visitors" stroke="#a855f7" strokeWidth={2} fill="url(#visitorGrad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

      </div>
    </div>
  );
}

// ─── MAIN EXPORT ───────────────────────────────────────────────────────────────
export default function SwarmBase({ onAnalyze, loading }) {
  const [selected, setSelected] = useState(AGENTS[10]);
  const [salesData, setSalesData] = useState({ revenue: 0, orders: 0, products: 0, lastUpdated: null });
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const fetchSales = async () => {
      try {
        const [ordersRes, productsRes] = await Promise.all([
          fetch("/api/shopify/orders"),
          fetch("/api/shopify/products"),
        ]);
        const ordersData = await ordersRes.json();
        const productsData = await productsRes.json();
        const orders = ordersData.orders || [];
        const revenue = orders.reduce((s, o) => s + parseFloat(o.total_price || 0), 0);
        setSalesData({
          revenue: parseFloat(revenue.toFixed(2)),
          orders: orders.length,
          products: (productsData.products || []).length,
          lastUpdated: new Date().toLocaleTimeString(),
        });
      } catch (e) {}
    };
    fetchSales();
    const t = setInterval(fetchSales, 6 * 60 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  const leftAgents = AGENTS.slice(0, 4);
  const rightAgents = AGENTS.slice(4, 8);
  const bottomAgents = AGENTS.slice(8, 11);

  return (
    <div style={{ background: "#050508", minHeight: "100vh", color: "#fff", fontFamily: "'Courier New', monospace", overflow: "hidden" }}>

      {/* ── HEADER ── */}
      <div style={{ display: "flex", alignItems: "center", padding: "8px 16px", borderBottom: "1px solid #ffffff0a", background: "rgba(0,0,0,0.85)" }}>
        <div style={{ display: "flex", gap: 8 }}>
          {[{ icon: "👥", label: "12", color: "#4ade80" }, { icon: "🔥", label: "38", color: "#f97316" }, { icon: "💧", label: "64", color: "#60a5fa" }, { icon: "⚡", label: "92", color: "#facc15" }, { icon: "🛡️", label: "17", color: "#a78bfa" }].map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 3, background: "rgba(255,255,255,0.05)", borderRadius: 4, padding: "2px 7px" }}>
              <span style={{ fontSize: 10 }}>{s.icon}</span>
              <span style={{ fontSize: 10, color: s.color, fontWeight: 700 }}>{s.label}</span>
            </div>
          ))}
        </div>
        <div style={{ flex: 1, textAlign: "center" }}>
          <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: 6, color: "#fff" }}>HOUSE OF JREYM</div>
          <div style={{ fontSize: 8, color: "#333", letterSpacing: 4 }}>CREATIVE TECH EMPIRE</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 12, color: "#aaa" }}>{time.toLocaleTimeString()}</div>
          <div style={{ background: "#00ff6418", border: "1px solid #00ff6440", borderRadius: 6, padding: "3px 10px", fontSize: 9, color: "#00ff64", display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#00ff64", animation: "pulse 2s infinite" }} />
            {selected.icon} {selected.role} · ACTIVE
          </div>
        </div>
      </div>

      {/* ── SALES SUB-BAR ── */}
      <div style={{ display: "flex", gap: 20, alignItems: "center", justifyContent: "center", background: "rgba(0,255,100,0.03)", borderBottom: "1px solid #00ff6410", padding: "5px 20px", fontSize: 11 }}>
        <span style={{ color: "#00ff64", fontWeight: 700 }}>💰 LIVE REVENUE: {salesData.revenue > 0 ? "$" + salesData.revenue.toLocaleString() : "—"}</span>
        <span style={{ color: "#222" }}>·</span>
        <span style={{ color: "#888" }}>📦 {salesData.orders} ORDERS</span>
        <span style={{ color: "#222" }}>·</span>
        <span style={{ color: "#888" }}>🛒 {salesData.products} PRODUCTS</span>
        {salesData.lastUpdated && <span style={{ color: "#333", fontSize: 9 }}>· updated {salesData.lastUpdated}</span>}
      </div>

      {/* ── MAIN LAYOUT: agents + BIG CHAT ── */}
      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr 220px", gap: 10, padding: "10px 10px 0", height: "calc(100vh - 220px)", minHeight: 520 }}>

        {/* LEFT AGENTS */}
        <div style={{ display: "flex", flexDirection: "column", gap: 7, overflowY: "auto", scrollbarWidth: "none" }}>
          <div style={{ fontSize: 8, color: "#282828", letterSpacing: 2, textAlign: "center", marginBottom: 2 }}>◀ WEST WING</div>
          {leftAgents.map(agent => (
            <AgentCard key={agent.id} agent={agent} salesData={salesData} />
          ))}
        </div>

        {/* CENTER: conference table + LARGE CHAT */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
          {/* Conference table strip */}
          <div style={{ position: "relative", height: 52, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <div style={{ width: "85%", height: 36, background: "linear-gradient(135deg, #0d0d1a 0%, #111827 100%)", border: "2px solid #00ff6418", borderRadius: 18, display: "flex", alignItems: "center", justifyContent: "center", gap: 24, boxShadow: "0 0 40px #00ff6408" }}>
              <div style={{ fontSize: 8, color: "#282828", letterSpacing: 3 }}>◈ CONFERENCE TABLE ◈</div>
              <div style={{ fontSize: 9, color: "#00ff6460" }}>HOUSE OF JREYM</div>
            </div>
            {bottomAgents.map((agent, i) => (
              <div key={agent.id} onClick={() => setSelected(agent)}
                style={{ position: "absolute", bottom: -6, left: `${22 + i * 28}%`, width: 26, height: 26, borderRadius: "50%", background: `radial-gradient(circle, ${agent.color}99, ${agent.color}22)`, border: `2px solid ${agent.color}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, cursor: "pointer", transform: selected?.id === agent.id ? "scale(1.35)" : "scale(1)", transition: "transform 0.2s", zIndex: 10 }}>
                {agent.icon}
              </div>
            ))}
          </div>

          {/* LARGE CHATBOT — takes remaining height */}
          <div style={{ flex: 1, minHeight: 0 }}>
            <ChatBot salesData={salesData} />
          </div>
        </div>

        {/* RIGHT AGENTS */}
        <div style={{ display: "flex", flexDirection: "column", gap: 7, overflowY: "auto", scrollbarWidth: "none" }}>
          <div style={{ fontSize: 8, color: "#282828", letterSpacing: 2, textAlign: "center", marginBottom: 2 }}>EAST WING ▶</div>
          {rightAgents.map(agent => (
            <AgentCard key={agent.id} agent={agent} salesData={salesData} />
          ))}
        </div>
      </div>

      {/* ── TRAFFIC GRAPHS (with time switcher) ── */}
      <div style={{ padding: "10px 10px 12px" }}>
        <TrafficGraphs salesData={salesData} />
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1a1a1a; border-radius: 2px; }
        * { box-sizing: border-box; }
      `}</style>
    </div>
  );
}
