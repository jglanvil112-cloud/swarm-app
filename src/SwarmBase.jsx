import { useState, useEffect, useRef } from "react";

const AGENTS = [
  { id: 1, name: "TREND HUNTER", role: "Market Intelligence", icon: "🔍", color: "#A855F7", glow: "#A855F766", x: 20, y: 15, size: 64 },
  { id: 2, name: "PRODUCT CREATOR", role: "Innovation Lab", icon: "🎨", color: "#3B82F6", glow: "#3B82F666", x: 50, y: 10, size: 64 },
  { id: 3, name: "MARKETING", role: "Brand Strategy", icon: "📢", color: "#EC4899", glow: "#EC489966", x: 80, y: 15, size: 64 },
  { id: 4, name: "SEO OPTIMIZATION", role: "Search Dominance", icon: "🎯", color: "#10B981", glow: "#10B98166", x: 90, y: 40, size: 64 },
  { id: 5, name: "LISTINGS & CONTENT", role: "Content Engine", icon: "📝", color: "#F59E0B", glow: "#F59E0B66", x: 80, y: 65, size: 64 },
  { id: 6, name: "ANALYTICS & ADS", role: "Data Intelligence", icon: "📊", color: "#06B6D4", glow: "#06B6D466", x: 50, y: 75, size: 64 },
  { id: 7, name: "PRICING & PROFIT", role: "Revenue Optimizer", icon: "💰", color: "#EAB308", glow: "#EAB30866", x: 20, y: 65, size: 64 },
  { id: 8, name: "CUSTOMER SERVICE", role: "Support Champion", icon: "🤝", color: "#F472B6", glow: "#F472B666", x: 10, y: 40, size: 64 },
  { id: 9, name: "SUPPLIER SCOUT", role: "Supply Chain", icon: "🔗", color: "#8B5CF6", glow: "#8B5CF666", x: 35, y: 30, size: 64 },
  { id: 10, name: "AUTOMATION ENGINEER", role: "Efficiency Master", icon: "⚙️", color: "#6366F1", glow: "#6366F166", x: 65, y: 30, size: 64 },
  { id: 11, name: "STRATEGY LEAD", role: "Prime Director", icon: "👑", color: "#F59E0B", glow: "#F59E0B66", x: 50, y: 45, size: 72 },
];

const CONNECTIONS = [
  [11, 1], [11, 2], [11, 3], [11, 4], [11, 5], [11, 6], [11, 7], [11, 8], [11, 9], [11, 10],
  [1, 9], [2, 10], [3, 4], [5, 6], [7, 8], [1, 2], [3, 5], [4, 6], [7, 9], [8, 10],
];
  const isSelected = selected?.id === agent.id;
  return (
    <div
      onClick={() => onClick(agent)}
      style={{
        position: "absolute",
        left: `${agent.x}%`,
        top: `${agent.y}%`,
        transform: "translate(-50%, -50%)",
        cursor: "pointer",
        zIndex: isSelected ? 10 : 5,
        transition: "all 0.3s",
      }}
    >
      {/* Outer ring */}
      <div style={{
        position: "absolute",
        inset: -8,
        borderRadius: "50%",
        border: `1px solid ${agent.color}44`,
        animation: "spin 8s linear infinite",
      }}/>
      {/* Pulse ring */}
      <div style={{
        position: "absolute",
        inset: isSelected ? -16 : -4,
        borderRadius: "50%",
        border: `2px solid ${agent.color}`,
        opacity: isSelected ? 0.8 : 0.3,
        transition: "all 0.3s",
        animation: `pulse-ring 2s ease-out infinite`,
        animationDelay: `${agent.id * 0.2}s`,
      }}/>
      {/* Main node */}
      <div style={{
        width: agent.size,
        height: agent.size,
        borderRadius: "50%",
        background: `radial-gradient(circle at 35% 35%, ${agent.color}33, #080c14 70%)`,
        border: `2px solid ${isSelected ? agent.color : agent.color + "88"}`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: isSelected
          ? `0 0 30px ${agent.glow}, 0 0 60px ${agent.glow}, inset 0 0 20px ${agent.color}11`
          : `0 0 10px ${agent.glow}`,
        transition: "all 0.3s",
        position: "relative",
        overflow: "hidden",
      }}>
        {/* Scanline inside node */}
        <div style={{
          position: "absolute",
          inset: 0,
          background: `repeating-linear-gradient(0deg, transparent, transparent 3px, ${agent.color}08 3px, ${agent.color}08 4px)`,
          borderRadius: "50%",
        }}/>
        <span style={{ fontSize: agent.id === 1 ? 22 : 16, zIndex: 1 }}>{agent.icon}</span>
        {agent.id === 1 && (
          <div style={{ fontSize: 7, color: agent.color, fontFamily: "monospace", letterSpacing: 1, zIndex: 1, marginTop: 2 }}>CORE</div>
        )}
        {/* Activity dot */}
        <div style={{
          position: "absolute",
          bottom: 6,
          right: 6,
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: agent.color,
          boxShadow: `0 0 6px ${agent.color}`,
          animation: `blink ${1 + agent.id * 0.3}s ease-in-out infinite`,
        }}/>
      </div>
      {/* Label */}
      <div style={{
        position: "absolute",
        top: "100%",
        left: "50%",
        transform: "translateX(-50%)",
        marginTop: 6,
        textAlign: "center",
        whiteSpace: "nowrap",
        pointerEvents: "none",
      }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: agent.color, fontFamily: "monospace", letterSpacing: 1.5 }}>{agent.name}</div>
        <div style={{ fontSize: 7, color: "#404060", fontFamily: "monospace", letterSpacing: 1 }}>{agent.role}</div>
      </div>
    </div>
  );
}


  // Fetch real Shopify sales data every 6 hours
  useEffect(() => {
    const fetchSales = async () => {
      try {
        const [ordersRes, productsRes] = await Promise.all([
          fetch('/api/shopify/orders'),
          fetch('/api/shopify/products')
        ]);
        const ordersData = await ordersRes.json();
        const productsData = await productsRes.json();
        const orders = ordersData.orders || [];
        const revenue = orders.reduce((s, o) => s + parseFloat(o.total_price || 0), 0);
        setSalesData({ revenue: parseFloat(revenue.toFixed(2)), orders: orders.length, products: (productsData.products || []).length, lastUpdated: new Date().toLocaleTimeString() });
      } catch(e) { console.error('[Sales]', e); }
    };
    fetchSales();
    const interval = setInterval(fetchSales, 6 * 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

export default function SwarmBase({ onAnalyze, loading }) {
  const [selected, setSelected] = useState(null);
  const [dataPackets, setDataPackets] = useState([]);
  const [logs, setLogs] = useState([
    { text: "> SWARM-X BASE INITIALIZED", color: "#00ff88" },
    { text: "> 9 agents deployed and active", color: "#00d4ff" },
    { text: "> Quantum Edge standing by", color: "#ffd700" },
    { text: "> Awaiting mission directive...", color: "#6080a0" },
  ]);
  const [input, setInput] = useState("");
  const [salesData, setSalesData] = useState({ revenue: 0, orders: 0, products: 0, lastUpdated: null });
  const [bankroll, setBankroll] = useState("1000");
  const svgRef = useRef();
  const logRef = useRef();

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => {
    // Animate data packets along connections
    const interval = setInterval(() => {
      const conn = CONNECTIONS[Math.floor(Math.random() * CONNECTIONS.length)];
      const from = AGENTS.find(a => a.id === conn[0]);
      const to = AGENTS.find(a => a.id === conn[1]);
      const id = Date.now();
      setDataPackets(prev => [...prev.slice(-8), { id, from, to, progress: 0, color: from.color }]);
    }, 800);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setDataPackets(prev => prev
        .map(p => ({ ...p, progress: p.progress + 0.05 }))
        .filter(p => p.progress <= 1)
      );
    }, 50);
    return () => clearInterval(interval);
  }, []);

  const addLog = (text, color = "#6080a0") => {
    setLogs(prev => [...prev.slice(-20), { text, color }]);
  };

  const handleAnalyze = async () => {
    if (!input.trim() || loading) return;
    const prompt = input.trim();
    setInput("");
    addLog(`> Analyzing: "${prompt}"`, "#00d4ff");
    addLog("> Deploying all 9 agents...", "#ff6a00");
    setSelected(AGENTS[0]);

    try {
      const result = await onAnalyze(prompt, bankroll);
      if (result?.plays?.length) {
        result.plays.forEach(p => {
          addLog(`> ${p.action}: ${p.pick} (${p.confidence}%)`,
            p.action === "STRONG PLAY" ? "#00ff88" : p.action === "PASS" ? "#ff3a3a" : "#ffd700");
        });
      }
    } catch {
      addLog("> Analysis error. Retrying...", "#ff3a3a");
    }
  };

  const handleKey = (e) => { if (e.key === "Enter") handleAnalyze(); };

  return (
    <div style={{
      width: "100%",
      minHeight: "100vh",
      background: "#060810",
      fontFamily: "monospace",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      position: "relative",
    }}>
      <style>{`
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.2} }
        @keyframes pulse-ring { 0%{transform:scale(1);opacity:0.6} 100%{transform:scale(1.8);opacity:0} }
        @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
        @keyframes scanline { 0%{top:-10%} 100%{top:110%} }
        @keyframes data-flow { 0%{opacity:0} 10%{opacity:1} 90%{opacity:1} 100%{opacity:0} }
        .agent-node:hover { transform: translate(-50%,-50%) scale(1.1) !important; }
      `}</style>

      {/* SCANLINE OVERLAY */}
      <div style={{
        position: "fixed",
        inset: 0,
        background: "repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,212,255,0.015) 2px,rgba(0,212,255,0.015) 4px)",
        pointerEvents: "none",
        zIndex: 100,
      }}/>

      {/* GRID BACKGROUND */}
      <div style={{
        position: "fixed",
        inset: 0,
        backgroundImage: `
          linear-gradient(rgba(0,212,255,0.04) 1px, transparent 1px),
          linear-gradient(90deg, rgba(0,212,255,0.04) 1px, transparent 1px)`,
        backgroundSize: "40px 40px",
        pointerEvents: "none",
      }}/>

      {/* HEADER */}
      <div style={{
        background: "linear-gradient(180deg,#0a0e1a,#060810)",
        borderBottom: "1px solid #00d4ff22",
        padding: "10px 20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 10,
        position: "relative",
        zIndex: 10,
      }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 900, color: "#ff6a00", letterSpacing: 5, textShadow: "0 0 20px #ff6a0066" }}>
            SWARM<span style={{ color: "#00d4ff" }}>-X</span>
          </div>
          <div style={{ fontSize: 7, color: "#404060", letterSpacing: 4 }}>QUANTUM EDGE · 9-AGENT BASE</div>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          {[
            { label: "AGENTS", value: "9", color: "#00d4ff" },
            { label: "STATUS", value: "LIVE", color: "#00ff88" },
            { label: "MODE", value: "ANALYSIS", color: "#ff6a00" },
          ].map(s => (
            <div key={s.label} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: s.color, fontFamily: "monospace" }}>{s.value}</div>
              <div style={{ fontSize: 7, color: "#404060", letterSpacing: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 9, color: "#404060" }}>BANKROLL</span>
          <input value={bankroll} onChange={e => setBankroll(e.target.value)}
            style={{ width: 80, background: "#0a0e1a", border: "1px solid #ff6a0044", borderRadius: 3, padding: "4px 8px", color: "#ff6a00", fontSize: 12, fontFamily: "monospace", outline: "none", textAlign: "center" }}/>
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", flex: 1, overflow: "hidden" }}>

        {/* BASE MAP */}
        <div style={{ position: "relative", overflow: "hidden" }}>

          {/* SVG CONNECTION LINES */}
          <svg ref={svgRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 1 }}>
            <defs>
              {AGENTS.map(a => (
                <radialGradient key={a.id} id={`grad-${a.id}`}>
                  <stop offset="0%" stopColor={a.color} stopOpacity="0.8"/>
                  <stop offset="100%" stopColor={a.color} stopOpacity="0"/>
                </radialGradient>
              ))}
            </defs>
            {CONNECTIONS.map(([fromId, toId], i) => {
              const from = AGENTS.find(a => a.id === fromId);
              const to = AGENTS.find(a => a.id === toId);
              return (
                <line key={i}
                  x1={`${from.x}%`} y1={`${from.y}%`}
                  x2={`${to.x}%`} y2={`${to.y}%`}
                  stroke={from.color} strokeWidth="0.5" opacity="0.2"
                  strokeDasharray="4 8"/>
              );
            })}
            {/* Data packets */}
            {dataPackets.map(p => {
              const x = p.from.x + (p.to.x - p.from.x) * p.progress;
              const y = p.from.y + (p.to.y - p.from.y) * p.progress;
              return (
                <circle key={p.id}
                  cx={`${x}%`} cy={`${y}%`} r="3"
                  fill={p.color} opacity={Math.sin(p.progress * Math.PI)}
                  style={{ filter: `drop-shadow(0 0 4px ${p.color})` }}/>
              );
            })}
          </svg>

          {/* AGENT NODES */}
          <div style={{ position: "absolute", inset: "0 0 60px 0" }}>
            {AGENTS.map(agent => (
              <AgentNode key={agent.id} agent={agent} selected={selected}
                onClick={setSelected} pulse={loading}/>
            ))}
          </div>

          {/* SELECTED AGENT INFO */}
          {selected && (
            <div style={{
              position: "absolute",
              bottom: 70,
              left: "50%",
              transform: "translateX(-50%)",
              background: "#0a0e1a",
              border: `1px solid ${selected.color}44`,
              borderRadius: 6,
              padding: "10px 20px",
              textAlign: "center",
              whiteSpace: "nowrap",
              zIndex: 20,
              boxShadow: `0 0 20px ${selected.glow}`,
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: selected.color, letterSpacing: 2 }}>{selected.icon} {selected.name}</div>
              <div style={{ fontSize: 9, color: "#6080a0", letterSpacing: 1, marginTop: 3 }}>{selected.role} · ACTIVE</div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', background: 'rgba(0,255,100,0.07)', border: '1px solid #00ff6433', borderRadius: 6, padding: '3px 10px', fontSize: 10, marginLeft: 8 }}>
              <span style={{ color: '#00ff64' }}>💰 {salesData.revenue > 0 ? '$' + salesData.revenue.toLocaleString() : '—'}</span>
              <span style={{ color: '#555' }}>|</span>
              <span style={{ color: '#aaa' }}>📦 {salesData.orders} orders</span>
              <span style={{ color: '#555' }}>|</span>
              <span style={{ color: '#aaa' }}>🛒 {salesData.products} products</span>
            </div>
            </div>
          )}

          {/* INPUT BAR */}
          <div style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            padding: "10px 16px",
            background: "linear-gradient(0deg,#060810,transparent)",
            display: "flex",
            gap: 10,
            zIndex: 20,
          }}>
            <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKey}
              placeholder='Enter bet: "Celtics ML -135 vs Knicks"'
              style={{
                flex: 1,
                background: "#0a0e1a",
                border: "1px solid #00d4ff33",
                borderRadius: 4,
                padding: "10px 16px",
                color: "#00d4ff",
                fontSize: 12,
                fontFamily: "monospace",
                outline: "none",
                caretColor: "#ff6a00",
              }}/>
            <button onClick={handleAnalyze} disabled={loading || !input.trim()}
              style={{
                padding: "10px 24px",
                background: loading ? "#0a0e1a" : "rgba(255,106,0,0.15)",
                border: `1px solid ${loading ? "#1a2040" : "#ff6a00"}`,
                borderRadius: 4,
                color: loading ? "#404060" : "#ff6a00",
                cursor: loading ? "not-allowed" : "pointer",
                fontSize: 11,
                fontFamily: "monospace",
                letterSpacing: 2,
                boxShadow: loading ? "none" : "0 0 10px #ff6a0033",
              }}>
              {loading ? "ANALYZING..." : "⚡ DEPLOY"}
            </button>
          </div>
        </div>

        {/* RIGHT PANEL */}
        <div style={{
          background: "#08090f",
          borderLeft: "1px solid #00d4ff11",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}>

          {/* AGENT ROSTER */}
          <div style={{ padding: "12px 14px", borderBottom: "1px solid #0f1428" }}>
            <div style={{ fontSize: 8, color: "#404060", letterSpacing: 3, marginBottom: 10 }}>// AGENT ROSTER</div>
            {AGENTS.map(agent => (
              <div key={agent.id} onClick={() => setSelected(agent)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "5px 8px",
                  borderRadius: 3,
                  cursor: "pointer",
                  background: selected?.id === agent.id ? `${agent.color}11` : "transparent",
                  borderLeft: `2px solid ${selected?.id === agent.id ? agent.color : "transparent"}`,
                  marginBottom: 2,
                  transition: "all 0.2s",
                }}>
                <span style={{ fontSize: 12 }}>{agent.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: agent.color, letterSpacing: 1 }}>{agent.name}</div>
                  <div style={{ height: 2, background: "#1a2040", borderRadius: 1, marginTop: 2 }}>
                    <div style={{
                      height: "100%",
                      width: `${70 + agent.id * 3}%`,
                      background: agent.color,
                      borderRadius: 1,
                      boxShadow: `0 0 4px ${agent.color}`,
                    }}/>
                  </div>
                </div>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: agent.color, boxShadow: `0 0 6px ${agent.color}`, animation: `blink ${1 + agent.id * 0.2}s infinite` }}/>
              </div>
            ))}
          </div>

          {/* TERMINAL LOG */}
          <div style={{ flex: 1, padding: "12px 14px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 8, color: "#404060", letterSpacing: 3, marginBottom: 8 }}>// LIVE FEED</div>
            <div ref={logRef} style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
              {logs.map((log, i) => (
                <div key={i} style={{ fontSize: 9, color: log.color, fontFamily: "monospace", lineHeight: 1.5, borderLeft: `1px solid ${log.color}33`, paddingLeft: 6 }}>
                  {log.text}
                </div>
              ))}
              {loading && (
                <div style={{ fontSize: 9, color: "#ff6a00", fontFamily: "monospace", animation: "blink 0.8s infinite" }}>
                  &gt; agents processing...
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
