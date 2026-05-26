import { useState, useEffect, useRef } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area, CartesianGrid } from "recharts";

const AGENTS = [
  { id: 1, name: "TREND HUNTER", role: "Market Intel", icon: "🔍", color: "#00ff64", x: 15, y: 30, size: 64 },
  { id: 2, name: "PRODUCT CREATOR", role: "Innovation", icon: "⚡", color: "#ff6b35", x: 35, y: 30, size: 64 },
  { id: 3, name: "MARKETING", role: "Brand Strategy", icon: "📣", color: "#a855f7", x: 55, y: 30, size: 64 },
  { id: 4, name: "SEO OPTIMIZATION", role: "Search Dominance", icon: "🎯", color: "#f59e0b", x: 75, y: 30, size: 64 },
  { id: 5, name: "LISTINGS & CONTENT", role: "Content Architect", icon: "📋", color: "#06b6d4", x: 15, y: 60, size: 64 },
  { id: 6, name: "ANALYTICS & ADS", role: "Data Intel", icon: "📊", color: "#ec4899", x: 35, y: 60, size: 64 },
  { id: 7, name: "PRICING & PROFIT", role: "Revenue Ops", icon: "💰", color: "#84cc16", x: 55, y: 60, size: 64 },
  { id: 8, name: "CUSTOMER SERVICE", role: "Support Commander", icon: "💬", color: "#f97316", x: 75, y: 60, size: 64 },
  { id: 9, name: "SUPPLIER SCOUT", role: "Supply Chain", icon: "🚚", color: "#0ea5e9", x: 25, y: 75, size: 56 },
  { id: 10, name: "AUTOMATION ENGINEER", role: "Efficiency Master", icon: "⚙️", color: "#6366f1", x: 50, y: 75, size: 72 },
  { id: 11, name: "STRATEGY LEAD", role: "Prime Director", icon: "👑", color: "#F59E0B", x: 75, y: 75, size: 72 },
];

const UPDATE_INTERVALS = { "1hr": 60 * 60 * 1000, "6hr": 6 * 60 * 60 * 1000, "24hr": 24 * 60 * 60 * 1000 };

function AgentCard({ agent, salesData }) {
  const [interval, setInterval_] = useState("6hr");
  const [open, setOpen] = useState(false);
  const [agentData, setAgentData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const fetchAgentData = async () => {
    setLoading(true);
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
    setLoading(false);
  };

  useEffect(() => { fetchAgentData(); }, [interval]);

  return (
    <div style={{ background: "rgba(0,0,0,0.6)", border: `1px solid ${agent.color}33`, borderRadius: 10, padding: 10, position: "relative", cursor: "pointer" }}
      onClick={() => setExpanded(!expanded)}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <div style={{ width: 36, height: 36, borderRadius: "50%", background: `radial-gradient(circle at 35% 35%, ${agent.color}88, ${agent.color}22)`, border: `2px solid ${agent.color}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>
          {agent.icon}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, color: agent.color, fontWeight: 700, letterSpacing: 1 }}>{agent.name}</div>
          <div style={{ fontSize: 8, color: "#666" }}>{agent.role}</div>
        </div>
        <div style={{ position: "relative" }}>
          <button onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
            style={{ background: `${agent.color}22`, border: `1px solid ${agent.color}44`, borderRadius: 4, color: agent.color, fontSize: 9, padding: "2px 6px", cursor: "pointer" }}>
            {interval} ▾
          </button>
          {open && (
            <div style={{ position: "absolute", right: 0, top: "100%", background: "#111", border: `1px solid ${agent.color}44`, borderRadius: 4, zIndex: 100 }}>
              {["1hr", "6hr", "24hr"].map(opt => (
                <div key={opt} onClick={(e) => { e.stopPropagation(); setInterval_(opt); setOpen(false); fetchAgentData(); }}
                  style={{ padding: "4px 12px", fontSize: 9, color: interval === opt ? agent.color : "#888", cursor: "pointer", background: interval === opt ? `${agent.color}11` : "transparent" }}>
                  {opt}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        <div style={{ flex: 1, background: "rgba(255,255,255,0.03)", borderRadius: 4, padding: "3px 6px", textAlign: "center" }}>
          <div style={{ fontSize: 12, color: agent.color, fontWeight: 700 }}>{agentData?.products?.length || 0}</div>
          <div style={{ fontSize: 7, color: "#555" }}>PRODUCTS</div>
        </div>
        <div style={{ flex: 1, background: "rgba(255,255,255,0.03)", borderRadius: 4, padding: "3px 6px", textAlign: "center" }}>
          <div style={{ fontSize: 12, color: "#fff", fontWeight: 700 }}>{agentData?.orders?.length || 0}</div>
          <div style={{ fontSize: 7, color: "#555" }}>ORDERS</div>
        </div>
        <div style={{ flex: 1, background: "rgba(255,255,255,0.03)", borderRadius: 4, padding: "3px 6px", textAlign: "center" }}>
          <div style={{ fontSize: 12, color: "#00ff64", fontWeight: 700 }}>${salesData?.revenue || 0}</div>
          <div style={{ fontSize: 7, color: "#555" }}>REVENUE</div>
        </div>
      </div>

      {expanded && agentData?.products?.length > 0 && (
        <div style={{ borderTop: `1px solid ${agent.color}22`, paddingTop: 6, marginTop: 4 }}>
          <div style={{ fontSize: 8, color: "#555", marginBottom: 4 }}>LIVE INVENTORY · updated {agentData.lastUpdated}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
            {agentData.products.map((p, i) => (
              <div key={i} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 4, overflow: "hidden", border: `1px solid ${agent.color}22` }}>
                {p.image?.src && <img src={p.image.src} alt={p.title} style={{ width: "100%", height: 45, objectFit: "cover", display: "block" }} />}
                <div style={{ padding: "3px 4px" }}>
                  <div style={{ fontSize: 7, color: "#ccc", lineHeight: 1.2 }}>{p.title?.slice(0, 22)}</div>
                  <div style={{ fontSize: 8, color: agent.color, fontWeight: 700 }}>${p.variants?.[0]?.price || "—"}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {loading && <div style={{ fontSize: 7, color: "#555", textAlign: "center", marginTop: 4 }}>refreshing...</div>}
    </div>
  );
}

function ChatBot({ salesData }) {
  const [messages, setMessages] = useState([
    { role: "assistant", content: "**SWARMX COMMAND CENTER ONLINE**\n\nAsk me anything about your Etsy or Shopify store — products, sales trends, inventory, pricing strategy, or marketing opportunities. I respond with data-driven insights.", type: "text" }
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
          prompt: `${userMsg}\n\nCurrent store data: Revenue $${salesData?.revenue || 0}, Orders: ${salesData?.orders || 0}, Products: ${salesData?.products || 0}. Format your response with bullet points using • for each point. If relevant, suggest graph data as JSON in format: GRAPH_DATA:[{"name":"label","value":number}]`,
          history: messages.map(m => ({ role: m.role, content: m.content }))
        })
      });
      const data = await r.json();
      const reply = data.reply || data.error || "No response";
      let graphData = null;
      const graphMatch = reply.match(/GRAPH_DATA:(\[.*?\])/s);
      if (graphMatch) {
        try { graphData = JSON.parse(graphMatch[1]); } catch(e) {}
      }
      const cleanReply = reply.replace(/GRAPH_DATA:\[.*?\]/s, "").trim();
      setMessages(prev => [...prev, { role: "assistant", content: cleanReply, graphData, type: "text" }]);
    } catch (e) {
      setMessages(prev => [...prev, { role: "assistant", content: "Error: " + e.message }]);
    }
    setLoading(false);
  };

  const renderMessage = (msg, i) => {
    const isUser = msg.role === "user";
    const lines = msg.content.split("\n").filter(l => l.trim());
    return (
      <div key={i} style={{ marginBottom: 12, display: "flex", flexDirection: "column", alignItems: isUser ? "flex-end" : "flex-start" }}>
        {!isUser && <div style={{ fontSize: 8, color: "#00ff64", marginBottom: 3, letterSpacing: 1 }}>⚡ SWARMX</div>}
        <div style={{ maxWidth: "90%", background: isUser ? "rgba(0,255,100,0.1)" : "rgba(255,255,255,0.04)", border: isUser ? "1px solid #00ff6433" : "1px solid #ffffff11", borderRadius: 8, padding: "8px 12px" }}>
          {lines.map((line, j) => {
            if (line.startsWith("•") || line.startsWith("-")) {
              return <div key={j} style={{ display: "flex", gap: 6, marginBottom: 3 }}>
                <span style={{ color: "#00ff64", flexShrink: 0 }}>▸</span>
                <span style={{ fontSize: 11, color: "#ccc", lineHeight: 1.5 }}>{line.replace(/^[•\-]\s*/, "").replace(/\*\*(.*?)\*\*/g, "$1")}</span>
              </div>;
            }
            if (line.startsWith("**") && line.endsWith("**")) {
              return <div key={j} style={{ fontSize: 12, color: "#fff", fontWeight: 700, marginBottom: 4, borderBottom: "1px solid #ffffff11", paddingBottom: 3 }}>{line.replace(/\*\*/g, "")}</div>;
            }
            return <div key={j} style={{ fontSize: 11, color: "#aaa", marginBottom: 2, lineHeight: 1.5 }}>{line.replace(/\*\*(.*?)\*\*/g, "$1")}</div>;
          })}
          {msg.graphData && msg.graphData.length > 0 && (
            <div style={{ marginTop: 8, background: "rgba(0,0,0,0.3)", borderRadius: 6, padding: 8 }}>
              <div style={{ fontSize: 8, color: "#555", marginBottom: 4 }}>DATA VISUALIZATION</div>
              <ResponsiveContainer width="100%" height={120}>
                <BarChart data={msg.graphData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                  <XAxis dataKey="name" tick={{ fontSize: 8, fill: "#666" }} />
                  <YAxis tick={{ fontSize: 8, fill: "#666" }} />
                  <Tooltip contentStyle={{ background: "#111", border: "1px solid #333", fontSize: 10 }} />
                  <Bar dataKey="value" fill="#00ff64" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "rgba(0,0,0,0.5)", border: "1px solid #00ff6422", borderRadius: 12, overflow: "hidden" }}>
      <div style={{ padding: "8px 14px", borderBottom: "1px solid #00ff6422", display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#00ff64", boxShadow: "0 0 6px #00ff64" }} />
        <div style={{ fontSize: 11, color: "#00ff64", fontWeight: 700, letterSpacing: 2 }}>SWARMX COMMAND CENTER</div>
        <div style={{ marginLeft: "auto", fontSize: 9, color: "#444" }}>ASK ABOUT PRODUCTS · SALES · TRENDS</div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 14, scrollbarWidth: "thin", scrollbarColor: "#333 transparent" }}>
        {messages.map(renderMessage)}
        {loading && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ fontSize: 8, color: "#00ff64" }}>⚡ SWARMX</div>
            <div style={{ fontSize: 11, color: "#555", fontStyle: "italic" }}>analyzing...</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div style={{ padding: 10, borderTop: "1px solid #00ff6422", display: "flex", gap: 8 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && send()}
          placeholder="Ask about products, sales, inventory, trends..."
          style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid #00ff6433", borderRadius: 6, padding: "8px 12px", color: "#fff", fontSize: 11, outline: "none" }}
        />
        <button onClick={send} disabled={loading}
          style={{ background: loading ? "#333" : "#00ff6422", border: "1px solid #00ff6444", borderRadius: 6, color: "#00ff64", padding: "8px 16px", cursor: loading ? "not-allowed" : "pointer", fontSize: 11, fontWeight: 700 }}>
          {loading ? "..." : "SEND"}
        </button>
      </div>
    </div>
  );
}

function TrafficGraphs({ salesData }) {
  const [shopifyData, setShopifyData] = useState([]);
  const [etsyData, setEtsyData] = useState([]);
  const [hourlyData, setHourlyData] = useState([]);

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
        })));
      } catch (e) {}
    };
    fetchData();
    const t = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  const mockHourly = hourlyData.length > 0 ? hourlyData : Array.from({ length: 12 }, (_, i) => ({
    time: `${(i * 2).toString().padStart(2, "0")}:00`,
    shopify: Math.random() * 200,
    etsy: Math.random() * 150,
    total: Math.random() * 350,
    orders: Math.floor(Math.random() * 10),
  }));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
      <div style={{ background: "rgba(0,0,0,0.5)", border: "1px solid #06b6d422", borderRadius: 10, padding: 12 }}>
        <div style={{ fontSize: 9, color: "#06b6d4", fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>🛍️ SHOPIFY REVENUE · 24HR</div>
        <ResponsiveContainer width="100%" height={120}>
          <AreaChart data={mockHourly}>
            <defs>
              <linearGradient id="shopifyGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff06" />
            <XAxis dataKey="time" tick={{ fontSize: 7, fill: "#444" }} interval={2} />
            <YAxis tick={{ fontSize: 7, fill: "#444" }} />
            <Tooltip contentStyle={{ background: "#111", border: "1px solid #333", fontSize: 9 }} formatter={v => ["$" + v.toFixed(2), "Revenue"]} />
            <Area type="monotone" dataKey="shopify" stroke="#06b6d4" fill="url(#shopifyGrad)" strokeWidth={2} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
          <div style={{ fontSize: 8, color: "#555" }}>LIVE</div>
          <div style={{ fontSize: 10, color: "#06b6d4", fontWeight: 700 }}>${salesData?.revenue || 0} total</div>
        </div>
      </div>

      <div style={{ background: "rgba(0,0,0,0.5)", border: "1px solid #f59e0b22", borderRadius: 10, padding: 12 }}>
        <div style={{ fontSize: 9, color: "#f59e0b", fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>🏪 ETSY TRAFFIC · 24HR</div>
        <ResponsiveContainer width="100%" height={120}>
          <AreaChart data={mockHourly}>
            <defs>
              <linearGradient id="etsyGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff06" />
            <XAxis dataKey="time" tick={{ fontSize: 7, fill: "#444" }} interval={2} />
            <YAxis tick={{ fontSize: 7, fill: "#444" }} />
            <Tooltip contentStyle={{ background: "#111", border: "1px solid #333", fontSize: 9 }} formatter={v => ["$" + v.toFixed(2), "Revenue"]} />
            <Area type="monotone" dataKey="etsy" stroke="#f59e0b" fill="url(#etsyGrad)" strokeWidth={2} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
          <div style={{ fontSize: 8, color: "#555" }}>PENDING API APPROVAL</div>
          <div style={{ fontSize: 10, color: "#f59e0b", fontWeight: 700 }}>—</div>
        </div>
      </div>

      <div style={{ background: "rgba(0,0,0,0.5)", border: "1px solid #00ff6422", borderRadius: 10, padding: 12 }}>
        <div style={{ fontSize: 9, color: "#00ff64", fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>📦 ORDERS · 24HR</div>
        <ResponsiveContainer width="100%" height={120}>
          <BarChart data={mockHourly}>
            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff06" />
            <XAxis dataKey="time" tick={{ fontSize: 7, fill: "#444" }} interval={2} />
            <YAxis tick={{ fontSize: 7, fill: "#444" }} />
            <Tooltip contentStyle={{ background: "#111", border: "1px solid #333", fontSize: 9 }} />
            <Bar dataKey="orders" fill="#00ff64" radius={[2, 2, 0, 0]} opacity={0.8} />
          </BarChart>
        </ResponsiveContainer>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
          <div style={{ fontSize: 8, color: "#555" }}>COMBINED</div>
          <div style={{ fontSize: 10, color: "#00ff64", fontWeight: 700 }}>{salesData?.orders || 0} orders</div>
        </div>
      </div>
    </div>
  );
}

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
        setSalesData({ revenue: parseFloat(revenue.toFixed(2)), orders: orders.length, products: (productsData.products || []).length, lastUpdated: new Date().toLocaleTimeString() });
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
      {/* HEADER */}
      <div style={{ display: "flex", alignItems: "center", padding: "8px 16px", borderBottom: "1px solid #ffffff0a", background: "rgba(0,0,0,0.8)" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {[{ icon: "👥", label: "12", color: "#4ade80" }, { icon: "🔥", label: "38", color: "#f97316" }, { icon: "💧", label: "64", color: "#60a5fa" }, { icon: "⚡", label: "92", color: "#facc15" }, { icon: "🛡️", label: "17", color: "#a78bfa" }].map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 3, background: "rgba(255,255,255,0.05)", borderRadius: 4, padding: "2px 6px" }}>
              <span style={{ fontSize: 10 }}>{s.icon}</span>
              <span style={{ fontSize: 10, color: s.color }}>{s.label}</span>
            </div>
          ))}
        </div>
        <div style={{ flex: 1, textAlign: "center" }}>
          <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: 6, color: "#fff" }}>HOUSE OF JREYM</div>
          <div style={{ fontSize: 8, color: "#444", letterSpacing: 4 }}>CREATIVE TECH EMPIRE</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 13, color: "#fff", fontWeight: 700 }}>{time.toLocaleTimeString()}</div>
          <div style={{ background: "#00ff6422", border: "1px solid #00ff6444", borderRadius: 6, padding: "3px 10px", fontSize: 9, color: "#00ff64", display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#00ff64", animation: "pulse 2s infinite" }} />
            {selected.icon} {selected.role} · ACTIVE
          </div>
        </div>
      </div>

      {/* SALES SUB-BAR */}
      <div style={{ display: "flex", gap: 20, alignItems: "center", justifyContent: "center", background: "rgba(0,255,100,0.04)", borderBottom: "1px solid #00ff6411", padding: "4px 20px", fontSize: 11 }}>
        <span style={{ color: "#00ff64", fontWeight: 700 }}>💰 LIVE REVENUE: {salesData.revenue > 0 ? "$" + salesData.revenue.toLocaleString() : "—"}</span>
        <span style={{ color: "#333" }}>·</span>
        <span style={{ color: "#aaa" }}>📦 {salesData.orders} ORDERS</span>
        <span style={{ color: "#333" }}>·</span>
        <span style={{ color: "#aaa" }}>🛒 {salesData.products} PRODUCTS</span>
        {salesData.lastUpdated && <span style={{ color: "#333", fontSize: 9 }}>· updated {salesData.lastUpdated}</span>}
      </div>

      {/* MAIN MEETING ROOM */}
      <div style={{ display: "grid", gridTemplateColumns: "240px 1fr 240px", gap: 10, padding: "10px 10px 0", height: "calc(100vh - 200px)", minHeight: 500 }}>

        {/* LEFT AGENTS */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 8, color: "#333", letterSpacing: 2, textAlign: "center", marginBottom: 2 }}>◀ WEST WING</div>
          {leftAgents.map(agent => (
            <AgentCard key={agent.id} agent={agent} salesData={salesData} />
          ))}
        </div>

        {/* CENTER: CONFERENCE TABLE + CHATBOT */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {/* Conference table visual */}
          <div style={{ position: "relative", height: 60, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: "80%", height: 40, background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)", border: "2px solid #00ff6422", borderRadius: 20, display: "flex", alignItems: "center", justifyContent: "center", gap: 20, boxShadow: "0 0 30px #00ff6411" }}>
              <div style={{ fontSize: 8, color: "#444", letterSpacing: 3 }}>◈ CONFERENCE TABLE ◈</div>
              <div style={{ fontSize: 9, color: "#00ff6488" }}>HOUSE OF JREYM</div>
            </div>
            {bottomAgents.map((agent, i) => (
              <div key={agent.id} onClick={() => setSelected(agent)}
                style={{ position: "absolute", bottom: -8, left: `${25 + i * 25}%`, width: 28, height: 28, borderRadius: "50%", background: `radial-gradient(circle, ${agent.color}88, ${agent.color}22)`, border: `2px solid ${agent.color}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, cursor: "pointer", transform: selected?.id === agent.id ? "scale(1.3)" : "scale(1)", transition: "transform 0.2s", zIndex: 10 }}>
                {agent.icon}
              </div>
            ))}
          </div>

          {/* Main Chatbot */}
          <div style={{ flex: 1, minHeight: 0 }}>
            <ChatBot salesData={salesData} />
          </div>
        </div>

        {/* RIGHT AGENTS */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 8, color: "#333", letterSpacing: 2, textAlign: "center", marginBottom: 2 }}>EAST WING ▶</div>
          {rightAgents.map(agent => (
            <AgentCard key={agent.id} agent={agent} salesData={salesData} />
          ))}
        </div>
      </div>

      {/* LIVE TRAFFIC SECTION */}
      <div style={{ padding: "10px 10px 10px" }}>
        <div style={{ fontSize: 9, color: "#333", letterSpacing: 3, marginBottom: 8, textAlign: "center" }}>━━━ LIVE PLATFORM TRAFFIC ━━━</div>
        <TrafficGraphs salesData={salesData} />
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
        * { box-sizing: border-box; }
      `}</style>
    </div>
  );
}
