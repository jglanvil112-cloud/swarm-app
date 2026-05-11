import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

const AGENTS = {
  STATS: { icon: "📊", color: "#00ff88", label: "Stats Edge" },
  INJURY: { icon: "🏥", color: "#00d4ff", label: "Injury/Lineup" },
  ODDS: { icon: "📈", color: "#ffd700", label: "Odds Movement" },
  TREND: { icon: "🔥", color: "#ff8c00", label: "Trend Edge" },
  TRAP: { icon: "⚠️", color: "#ff3a3a", label: "Trap Risk" },
};

function ConfidenceRing({ value, size = 80 }) {
  const r = size / 2 - 8;
  const circ = 2 * Math.PI * r;
  const fill = (value / 100) * circ;
  const color = value >= 75 ? "#00ff88" : value >= 65 ? "#ffd700" : value >= 55 ? "#ff8c00" : "#ff3a3a";
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1a2040" strokeWidth="6"/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color}
        strokeWidth="6" strokeDasharray={`${fill} ${circ}`}
        strokeLinecap="round" transform={`rotate(-90 ${size/2} ${size/2})`}
        style={{ filter: `drop-shadow(0 0 6px ${color})` }}/>
      <text x={size/2} y={size/2 + 5} textAnchor="middle" fill={color}
        style={{ fontSize: 16, fontWeight: 700, fontFamily: "'Orbitron', monospace" }}>{value}%</text>
    </svg>
  );
}

function StatBar({ label, value, color }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#6080a0", marginBottom: 4, fontFamily: "'Share Tech Mono', monospace" }}>
        <span>{label}</span><span style={{ color }}>{value}%</span>
      </div>
      <div style={{ height: 4, background: "#1a2040", borderRadius: 2, overflow: "hidden" }}>
        <motion.div initial={{ width: 0 }} animate={{ width: `${value}%` }} transition={{ duration: 1, ease: "easeOut" }}
          style={{ height: "100%", background: color, borderRadius: 2, boxShadow: `0 0 8px ${color}` }}/>
      </div>
    </div>
  );
}

function ActionBadge({ action }) {
  const styles = {
    "STRONG PLAY": { bg: "rgba(0,255,136,0.15)", color: "#00ff88", border: "#00ff8844" },
    "LEAN":        { bg: "rgba(255,215,0,0.15)",  color: "#ffd700",  border: "#ffd70044" },
    "SMALL BET":   { bg: "rgba(255,140,0,0.15)",  color: "#ff8c00",  border: "#ff8c0044" },
    "PASS":        { bg: "rgba(255,58,58,0.15)",   color: "#ff3a3a",  border: "#ff3a3a44" },
  };
  const s = styles[action] || styles["PASS"];
  return (
    <span style={{ padding: "3px 10px", borderRadius: 4, fontSize: 10, fontWeight: 700,
      letterSpacing: 2, fontFamily: "'Orbitron', monospace", background: s.bg,
      color: s.color, border: `1px solid ${s.border}` }}>{action}</span>
  );
}

function PlayCard({ play, bankroll, onApprove, onPass }) {
  const [expanded, setExpanded] = useState(false);
  const suggestSize = () => {
    const b = Number(bankroll) || 0;
    if (!b || play.action === "PASS" || play.risk === "High") return "$0 — skip";
    if (play.action === "STRONG PLAY") return `$${Math.round(b * 0.02)} (2% unit)`;
    if (play.action === "LEAN") return `$${Math.round(b * 0.01)} (1% unit)`;
    return `$${Math.round(b * 0.005)} (0.5% unit)`;
  };

  const riskColor = play.risk === "High" ? "#ff3a3a" : play.risk === "Medium" ? "#ffd700" : "#00ff88";

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      style={{ background: "#0a0e18", border: `1px solid ${play.action === "STRONG PLAY" ? "#00ff8833" : play.action === "PASS" ? "#ff3a3a22" : "#1a2040"}`,
        borderRadius: 8, marginBottom: 12, overflow: "hidden" }}>
      <div style={{ padding: "16px 20px", cursor: "pointer" }} onClick={() => setExpanded(!expanded)}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              <span style={{ fontSize: 9, padding: "2px 8px", border: "1px solid #1a2040", borderRadius: 3, color: "#6080a0", fontFamily: "monospace" }}>{play.sport}</span>
              <span style={{ fontSize: 9, padding: "2px 8px", border: "1px solid #1a2040", borderRadius: 3, color: "#6080a0", fontFamily: "monospace" }}>{play.betType}</span>
              <ActionBadge action={play.action}/>
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#e0e8ff", marginBottom: 4, fontFamily: "'Rajdhani', sans-serif" }}>{play.pick}</div>
            <div style={{ fontSize: 12, color: "#6080a0", fontFamily: "monospace" }}>{play.game} · Odds: {play.odds}</div>
          </div>
          <ConfidenceRing value={play.confidence}/>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginTop: 16 }}>
          {[
            { label: "Stats", value: play.statsEdge, color: "#00ff88" },
            { label: "Injury", value: play.injuryEdge, color: "#00d4ff" },
            { label: "Odds", value: play.oddsEdge, color: "#ffd700" },
            { label: "Trend", value: play.trendEdge, color: "#ff8c00" },
          ].map(s => (
            <div key={s.label} style={{ textAlign: "center", background: "#060810", padding: "6px 4px", borderRadius: 4, border: "1px solid #1a2040" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: s.color, fontFamily: "monospace" }}>{s.value}%</div>
              <div style={{ fontSize: 9, color: "#404060", letterSpacing: 1 }}>{s.label.toUpperCase()}</div>
            </div>
          ))}
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            style={{ borderTop: "1px solid #1a2040", padding: "16px 20px", overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 10, color: "#00ff88", letterSpacing: 2, fontFamily: "monospace", marginBottom: 8 }}>✅ WHY SWARM LIKES IT</div>
                {play.reasons?.map((r, i) => (
                  <div key={i} style={{ fontSize: 12, color: "#a0b0c0", marginBottom: 4, paddingLeft: 12, borderLeft: "2px solid #00ff8844" }}>{r}</div>
                ))}
              </div>
              <div>
                <div style={{ fontSize: 10, color: "#ff3a3a", letterSpacing: 2, fontFamily: "monospace", marginBottom: 8 }}>🚩 RED FLAGS</div>
                {play.redFlags?.map((r, i) => (
                  <div key={i} style={{ fontSize: 12, color: "#a0b0c0", marginBottom: 4, paddingLeft: 12, borderLeft: "2px solid #ff3a3a44" }}>{r}</div>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, color: "#6080a0", letterSpacing: 2, fontFamily: "monospace", marginBottom: 8 }}>AGENT BREAKDOWN</div>
              <StatBar label="Stats Edge" value={play.statsEdge} color="#00ff88"/>
              <StatBar label="Injury/Lineup" value={play.injuryEdge} color="#00d4ff"/>
              <StatBar label="Odds Movement" value={play.oddsEdge} color="#ffd700"/>
              <StatBar label="Trend Edge" value={play.trendEdge} color="#ff8c00"/>
              <StatBar label="Trap Risk (lower=better)" value={play.trapRisk} color="#ff3a3a"/>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, borderTop: "1px solid #1a2040", paddingTop: 12 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 10, padding: "3px 10px", borderRadius: 4, border: `1px solid ${riskColor}44`, color: riskColor, fontFamily: "monospace" }}>RISK: {play.risk}</span>
                <span style={{ fontSize: 10, padding: "3px 10px", borderRadius: 4, border: "1px solid #ff3a3a44", color: "#ff3a3a", fontFamily: "monospace" }}>TRAP: {play.trapRisk}%</span>
                <span style={{ fontSize: 10, padding: "3px 10px", borderRadius: 4, border: "1px solid #1a2040", color: "#6080a0", fontFamily: "monospace" }}>SIZE: {suggestSize()}</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={onPass} style={{ padding: "6px 16px", background: "transparent", border: "1px solid #ff3a3a44", color: "#ff3a3a", borderRadius: 4, cursor: "pointer", fontSize: 11, fontFamily: "monospace" }}>✗ PASS</button>
                <button onClick={onApprove} disabled={play.action === "PASS"}
                  style={{ padding: "6px 16px", background: play.action === "PASS" ? "#1a2040" : "rgba(0,255,136,0.15)", border: `1px solid ${play.action === "PASS" ? "#1a2040" : "#00ff8844"}`, color: play.action === "PASS" ? "#404060" : "#00ff88", borderRadius: 4, cursor: play.action === "PASS" ? "not-allowed" : "pointer", fontSize: 11, fontFamily: "monospace" }}>✓ APPROVE</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function App() {
  const [bankroll, setBankroll] = useState("1000");
  const [input, setInput] = useState("");
  const [plays, setPlays] = useState([]);
  const [loading, setLoading] = useState(false);
  const [approved, setApproved] = useState([]);
  const [passed, setPassed] = useState([]);
  const [minConf, setMinConf] = useState(60);
  const [activeTab, setActiveTab] = useState("analyze");
  const [agentLogs, setAgentLogs] = useState([]);
  const inputRef = useRef();

  const addLog = (msg, color = "#6080a0") => setAgentLogs(prev => [...prev.slice(-20), { msg, color, time: new Date().toLocaleTimeString() }]);

  const analyzePlay = async () => {
    if (!input.trim() || loading) return;
    const prompt = input.trim();
    setInput("");
    setLoading(true);
    addLog(`> Analyzing: "${prompt}"`, "#00d4ff");
    addLog("> Deploying STATS agent...", "#00ff88");

    try {
      const res = await fetch("/api/swarm/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, bankroll }),
      });
      const data = await res.json();

      if (data.plays) {
        setPlays(prev => [...data.plays, ...prev]);
        addLog(`> ${data.plays.length} play(s) analyzed`, "#00ff88");
        data.plays.forEach(p => addLog(`> ${p.action}: ${p.pick} (${p.confidence}% confidence)`,
          p.action === "STRONG PLAY" ? "#00ff88" : p.action === "PASS" ? "#ff3a3a" : "#ffd700"));
      } else {
        addLog(`> Error: ${data.error}`, "#ff3a3a");
      }
    } catch (err) {
      addLog(`> Connection failed: ${err.message}`, "#ff3a3a");
    }
    setLoading(false);
  };

  const handleKey = (e) => { if (e.key === "Enter") analyzePlay(); };

  const filteredPlays = plays.filter(p => p.confidence >= minConf && !passed.includes(p.id));
  const strongPlays = filteredPlays.filter(p => p.action === "STRONG PLAY");
  const trapAlerts = plays.filter(p => p.trapRisk >= 70 || p.action === "PASS");
  const totalApprovedBet = approved.reduce((sum, id) => {
    const p = plays.find(x => x.id === id);
    if (!p || p.action === "PASS") return sum;
    const b = Number(bankroll) || 0;
    const pct = p.action === "STRONG PLAY" ? 0.02 : p.action === "LEAN" ? 0.01 : 0.005;
    return sum + Math.round(b * pct);
  }, 0);

  const styles = {
    wrap: { background: "#060810", minHeight: "100vh", color: "#c0cce0", fontFamily: "'Rajdhani', sans-serif" },
    header: { background: "#0a0e18", borderBottom: "1px solid #1a2040", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 },
    logo: { fontFamily: "'Orbitron', monospace", fontSize: 20, fontWeight: 900, color: "#ff6a00", letterSpacing: 4, textShadow: "0 0 20px #ff6a0066" },
    tab: (active) => ({ padding: "6px 18px", borderRadius: 4, fontSize: 11, fontFamily: "monospace", letterSpacing: 2, cursor: "pointer", border: `1px solid ${active ? "#ff6a00" : "#1a2040"}`, background: active ? "rgba(255,106,0,0.1)" : "transparent", color: active ? "#ff6a00" : "#6080a0" }),
    statCard: (color) => ({ background: "#0a0e18", border: `1px solid ${color}22`, borderRadius: 6, padding: "12px 16px", textAlign: "center" }),
    input: { flex: 1, background: "#0a0e18", border: "1px solid #1a2040", borderRadius: 6, padding: "12px 16px", color: "#e0e8ff", fontSize: 13, fontFamily: "monospace", outline: "none" },
    btn: (active) => ({ padding: "10px 20px", background: active ? "rgba(255,106,0,0.2)" : "#0a0e18", border: `1px solid ${active ? "#ff6a00" : "#1a2040"}`, borderRadius: 6, color: active ? "#ff6a00" : "#6080a0", cursor: "pointer", fontSize: 11, fontFamily: "monospace", letterSpacing: 2 }),
  };

  return (
    <div style={styles.wrap}>
      <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@700;900&family=Share+Tech+Mono&family=Rajdhani:wght@400;500;600;700&display=swap" rel="stylesheet"/>

      {/* HEADER */}
      <div style={styles.header}>
        <div>
          <div style={styles.logo}>SWARM-X <span style={{ color: "#00d4ff", fontSize: 14 }}>QUANTUM EDGE</span></div>
          <div style={{ fontSize: 9, color: "#404060", letterSpacing: 3, fontFamily: "monospace" }}>AI SPORTS COMMAND CENTER · POWERED BY CLAUDE</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {["analyze", "approved", "traps", "logs"].map(t => (
            <button key={t} style={styles.tab(activeTab === t)} onClick={() => setActiveTab(t)}>
              {t.toUpperCase()}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 10, color: "#6080a0", fontFamily: "monospace" }}>BANKROLL</span>
          <input value={bankroll} onChange={e => setBankroll(e.target.value)}
            style={{ width: 100, background: "#060810", border: "1px solid #1a2040", borderRadius: 4, padding: "6px 10px", color: "#ff6a00", fontSize: 13, fontFamily: "monospace", outline: "none" }}
            placeholder="$1000"/>
        </div>
      </div>

      {/* STAT CARDS */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 8, padding: "12px 24px" }}>
        {[
          { label: "AGENTS ACTIVE", value: "7", color: "#00d4ff" },
          { label: "PLAYS ANALYZED", value: plays.length, color: "#ff6a00" },
          { label: "STRONG PLAYS", value: strongPlays.length, color: "#00ff88" },
          { label: "TRAP ALERTS", value: trapAlerts.length, color: "#ff3a3a" },
          { label: "APPROVED RISK", value: `$${totalApprovedBet}`, color: "#ffd700" },
        ].map(s => (
          <div key={s.label} style={styles.statCard(s.color)}>
            <div style={{ fontSize: 20, fontWeight: 700, color: s.color, fontFamily: "'Orbitron', monospace" }}>{s.value}</div>
            <div style={{ fontSize: 8, color: "#404060", letterSpacing: 2, fontFamily: "monospace" }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* INPUT BAR */}
      <div style={{ padding: "0 24px 12px", display: "flex", gap: 10 }}>
        <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKey}
          placeholder='Enter any bet: "Celtics ML -135 vs Knicks" or "Judge Over 1.5 TB +115"'
          style={styles.input}/>
        <button onClick={analyzePlay} disabled={loading || !input.trim()}
          style={{ padding: "10px 24px", background: loading ? "#0a0e18" : "rgba(255,106,0,0.2)", border: `1px solid ${loading ? "#1a2040" : "#ff6a00"}`, borderRadius: 6, color: loading ? "#404060" : "#ff6a00", cursor: loading ? "not-allowed" : "pointer", fontSize: 11, fontFamily: "monospace", letterSpacing: 2, minWidth: 100 }}>
          {loading ? "ANALYZING..." : "⚡ ANALYZE"}
        </button>
        <button onClick={() => setActiveTab("analyze")} style={{ padding: "10px 16px", background: "transparent", border: "1px solid #1a2040", borderRadius: 6, color: "#6080a0", cursor: "pointer", fontSize: 10, fontFamily: "monospace" }}
          title="Filter by confidence">
          {minConf}%+
        </button>
      </div>

      {/* CONFIDENCE FILTER */}
      <div style={{ padding: "0 24px 12px", display: "flex", gap: 6 }}>
        {[55, 60, 65, 70, 75].map(v => (
          <button key={v} style={styles.btn(minConf === v)} onClick={() => setMinConf(v)}>{v}%+</button>
        ))}
        <button style={styles.btn(false)} onClick={() => setPlays([])}>CLEAR ALL</button>
      </div>

      {/* MAIN CONTENT */}
      <div style={{ padding: "0 24px 24px", display: "grid", gridTemplateColumns: "1fr 320px", gap: 16 }}>

        {/* LEFT COLUMN */}
        <div>
          {activeTab === "analyze" && (
            <>
              {loading && (
                <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.5, repeat: Infinity }}
                  style={{ background: "#0a0e18", border: "1px solid #ff6a0033", borderRadius: 8, padding: 20, marginBottom: 12, textAlign: "center" }}>
                  <div style={{ fontFamily: "monospace", color: "#ff6a00", fontSize: 12, letterSpacing: 2 }}>
                    ⚡ SWARM-X AGENTS ANALYZING...
                  </div>
                  <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 12 }}>
                    {Object.values(AGENTS).map((a, i) => (
                      <div key={i} style={{ fontSize: 10, color: a.color, fontFamily: "monospace" }}>{a.icon} {a.label.split(" ")[0]}</div>
                    ))}
                  </div>
                </motion.div>
              )}
              {filteredPlays.length === 0 && !loading && (
                <div style={{ textAlign: "center", padding: 60, color: "#404060" }}>
                  <div style={{ fontSize: 48, marginBottom: 12 }}>⚡</div>
                  <div style={{ fontFamily: "monospace", letterSpacing: 2, fontSize: 13 }}>SWARM-X STANDING BY</div>
                  <div style={{ fontSize: 11, marginTop: 8 }}>Enter any bet above and the AI agents will analyze it</div>
                </div>
              )}
              {filteredPlays.map(play => (
                <PlayCard key={play.id} play={play} bankroll={bankroll}
                  onApprove={() => setApproved(prev => [...prev, play.id])}
                  onPass={() => setPassed(prev => [...prev, play.id])}/>
              ))}
            </>
          )}
          {activeTab === "approved" && (
            <>
              <div style={{ fontFamily: "monospace", color: "#00ff88", letterSpacing: 2, fontSize: 11, marginBottom: 12 }}>// APPROVED PLAYS · TOTAL AT RISK: ${totalApprovedBet}</div>
              {approved.length === 0 ? <div style={{ color: "#404060", fontFamily: "monospace", padding: 40, textAlign: "center" }}>No plays approved yet</div> :
                plays.filter(p => approved.includes(p.id)).map(play => <PlayCard key={play.id} play={play} bankroll={bankroll} onApprove={() => {}} onPass={() => {}}/>)}
            </>
          )}
          {activeTab === "traps" && (
            <>
              <div style={{ fontFamily: "monospace", color: "#ff3a3a", letterSpacing: 2, fontSize: 11, marginBottom: 12 }}>// TRAP ALERTS · AVOID THESE PLAYS</div>
              {trapAlerts.length === 0 ? <div style={{ color: "#404060", fontFamily: "monospace", padding: 40, textAlign: "center" }}>No traps detected</div> :
                trapAlerts.map(play => <PlayCard key={play.id} play={play} bankroll={bankroll} onApprove={() => {}} onPass={() => {}}/>)}
            </>
          )}
          {activeTab === "logs" && (
            <div style={{ background: "#0a0e18", border: "1px solid #1a2040", borderRadius: 8, padding: 16, fontFamily: "monospace" }}>
              <div style={{ fontSize: 10, color: "#404060", letterSpacing: 2, marginBottom: 12 }}>// AGENT ACTIVITY LOG</div>
              {agentLogs.length === 0 ? <div style={{ color: "#404060" }}>No activity yet</div> :
                agentLogs.map((log, i) => (
                  <div key={i} style={{ fontSize: 11, color: log.color, marginBottom: 4 }}>
                    <span style={{ color: "#404060", marginRight: 8 }}>[{log.time}]</span>{log.msg}
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* RIGHT COLUMN */}
        <div>
          {/* Agent Status */}
          <div style={{ background: "#0a0e18", border: "1px solid #1a2040", borderRadius: 8, padding: 16, marginBottom: 12 }}>
            <div style={{ fontSize: 9, color: "#6080a0", letterSpacing: 3, fontFamily: "monospace", marginBottom: 12 }}>// SWARM AGENTS</div>
            {Object.entries(AGENTS).map(([key, a]) => (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 14 }}>{a.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1, color: a.color }}>{key}</div>
                  <div style={{ height: 3, background: "#1a2040", borderRadius: 2, marginTop: 3 }}>
                    <motion.div animate={{ width: ["60%", "95%", "70%"] }} transition={{ duration: 3, repeat: Infinity, repeatType: "reverse" }}
                      style={{ height: "100%", background: a.color, borderRadius: 2, boxShadow: `0 0 6px ${a.color}` }}/>
                  </div>
                </div>
                <span style={{ fontSize: 9, color: a.color, fontFamily: "monospace" }}>ACTIVE</span>
              </div>
            ))}
          </div>

          {/* Bankroll Manager */}
          <div style={{ background: "#0a0e18", border: "1px solid #ffd70022", borderRadius: 8, padding: 16, marginBottom: 12 }}>
            <div style={{ fontSize: 9, color: "#ffd700", letterSpacing: 3, fontFamily: "monospace", marginBottom: 10 }}>// BANKROLL MANAGER</div>
            {[
              { label: "Starting Bankroll", value: `$${Number(bankroll).toLocaleString()}`, color: "#e0e8ff" },
              { label: "Approved at Risk", value: `$${totalApprovedBet}`, color: "#ff3a3a" },
              { label: "Remaining", value: `$${(Number(bankroll) - totalApprovedBet).toLocaleString()}`, color: "#00ff88" },
              { label: "Risk %", value: `${Number(bankroll) > 0 ? ((totalApprovedBet / Number(bankroll)) * 100).toFixed(1) : 0}%`, color: "#ffd700" },
            ].map(s => (
              <div key={s.label} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 12 }}>
                <span style={{ color: "#6080a0", fontFamily: "monospace" }}>{s.label}</span>
                <span style={{ color: s.color, fontWeight: 700, fontFamily: "monospace" }}>{s.value}</span>
              </div>
            ))}
          </div>

          {/* Quick Guide */}
          <div style={{ background: "#0a0e18", border: "1px solid #1a2040", borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 9, color: "#6080a0", letterSpacing: 3, fontFamily: "monospace", marginBottom: 10 }}>// HOW TO USE</div>
            {[
              { ex: '"Celtics ML -135 vs Knicks"', desc: "Moneyline analysis" },
              { ex: '"Lakers -6.5 spread vs Suns"', desc: "Spread analysis" },
              { ex: '"Under 44.5 Giants vs Eagles"', desc: "Total analysis" },
              { ex: '"Judge Over 1.5 TB +115"', desc: "Player prop" },
            ].map((e, i) => (
              <div key={i} style={{ marginBottom: 10, cursor: "pointer" }} onClick={() => setInput(e.ex)}>
                <div style={{ fontSize: 10, color: "#ff6a00", fontFamily: "monospace", padding: "3px 8px", background: "rgba(255,106,0,0.05)", border: "1px solid #ff6a0022", borderRadius: 3, marginBottom: 3 }}>{e.ex}</div>
                <div style={{ fontSize: 10, color: "#404060", fontFamily: "monospace" }}>{e.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
