import { useState } from "react";
import SwarmBase from "./SwarmBase";

export default function App() {
  const [plays, setPlays] = useState([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState("base"); // "base" | "plays"

  const handleAnalyze = async (prompt, bankroll) => {
    setLoading(true);
    try {
      const res = await fetch("/api/swarm/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, bankroll }),
      });
      const data = await res.json();
      if (data.plays) {
        setPlays(prev => [...data.plays, ...prev]);
        setView("plays");
      }
      return data;
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const actionColor = (action) => ({
    "STRONG PLAY": "#00ff88",
    "LEAN": "#ffd700",
    "SMALL BET": "#ff8c00",
    "PASS": "#ff3a3a",
  }[action] || "#6080a0");

  return (
    <div style={{ background: "#060810", minHeight: "100vh", fontFamily: "monospace" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Orbitron:wght@700;900&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-thumb { background: #ff6a00; border-radius: 2px; }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.2} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes pulse-ring { 0%{transform:scale(1);opacity:0.6} 100%{transform:scale(2);opacity:0} }
      `}</style>

      {/* NAV TABS */}
      <div style={{
        position: "fixed",
        top: 0,
        right: 0,
        zIndex: 999,
        display: "flex",
        gap: 4,
        padding: "8px 12px",
      }}>
        {["base", "plays"].map(v => (
          <button key={v} onClick={() => setView(v)}
            style={{
              padding: "4px 14px",
              background: view === v ? "rgba(255,106,0,0.2)" : "rgba(6,8,16,0.8)",
              border: `1px solid ${view === v ? "#ff6a00" : "#1a2040"}`,
              borderRadius: 3,
              color: view === v ? "#ff6a00" : "#404060",
              fontSize: 9,
              fontFamily: "monospace",
              letterSpacing: 2,
              cursor: "pointer",
              backdropFilter: "blur(4px)",
            }}>
            {v === "base" ? "⬡ BASE" : `📊 PLAYS (${plays.length})`}
          </button>
        ))}
      </div>

      {view === "base" && (
        <div style={{ height: "100vh" }}>
          <SwarmBase onAnalyze={handleAnalyze} loading={loading}/>
        </div>
      )}

      {view === "plays" && (
        <div style={{ padding: "60px 20px 20px", maxWidth: 900, margin: "0 auto" }}>
          <div style={{ fontSize: 9, color: "#404060", letterSpacing: 3, marginBottom: 16 }}>
            // QUANTUM EDGE · {plays.length} PLAYS ANALYZED
          </div>

          {plays.length === 0 ? (
            <div style={{ textAlign: "center", padding: 60, color: "#404060" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>⚡</div>
              <div style={{ letterSpacing: 2 }}>NO PLAYS YET · GO TO BASE AND ANALYZE A BET</div>
            </div>
          ) : plays.map((play, i) => (
            <div key={play.id || i} style={{
              background: "#0a0e18",
              border: `1px solid ${actionColor(play.action)}22`,
              borderLeft: `3px solid ${actionColor(play.action)}`,
              borderRadius: 6,
              padding: 16,
              marginBottom: 12,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
                <div>
                  <div style={{ display: "flex", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 8, padding: "2px 8px", border: "1px solid #1a2040", borderRadius: 2, color: "#6080a0" }}>{play.sport}</span>
                    <span style={{ fontSize: 8, padding: "2px 8px", border: "1px solid #1a2040", borderRadius: 2, color: "#6080a0" }}>{play.betType}</span>
                    <span style={{ fontSize: 9, padding: "2px 10px", borderRadius: 2, fontWeight: 700, letterSpacing: 1, background: `${actionColor(play.action)}15`, color: actionColor(play.action), border: `1px solid ${actionColor(play.action)}44` }}>{play.action}</span>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#e0e8ff" }}>{play.pick}</div>
                  <div style={{ fontSize: 11, color: "#6080a0", marginTop: 3 }}>{play.game} · {play.odds}</div>
                </div>
                {/* Confidence */}
                <div style={{ textAlign: "center", flexShrink: 0 }}>
                  <div style={{ fontSize: 28, fontWeight: 900, color: actionColor(play.action), fontFamily: "'Orbitron', monospace" }}>{play.confidence}%</div>
                  <div style={{ fontSize: 7, color: "#404060", letterSpacing: 2 }}>CONFIDENCE</div>
                </div>
              </div>

              {/* Agent scores */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, marginBottom: 12 }}>
                {[
                  { label: "STATS", value: play.statsEdge, color: "#00ff88" },
                  { label: "INJURY", value: play.injuryEdge, color: "#00d4ff" },
                  { label: "ODDS", value: play.oddsEdge, color: "#ffd700" },
                  { label: "TREND", value: play.trendEdge, color: "#ff8c00" },
                ].map(s => (
                  <div key={s.label} style={{ background: "#060810", border: "1px solid #1a2040", borderRadius: 4, padding: "6px 8px", textAlign: "center" }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: s.color }}>{s.value}%</div>
                    <div style={{ fontSize: 7, color: "#404060", letterSpacing: 1, marginTop: 2 }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Reasons & Flags */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 8, color: "#00ff88", letterSpacing: 2, marginBottom: 6 }}>✅ WHY PLAY IT</div>
                  {play.reasons?.map((r, i) => <div key={i} style={{ fontSize: 10, color: "#a0b0c0", marginBottom: 3, paddingLeft: 8, borderLeft: "1px solid #00ff8833" }}>{r}</div>)}
                </div>
                <div>
                  <div style={{ fontSize: 8, color: "#ff3a3a", letterSpacing: 2, marginBottom: 6 }}>🚩 RED FLAGS</div>
                  {play.redFlags?.map((r, i) => <div key={i} style={{ fontSize: 10, color: "#a0b0c0", marginBottom: 3, paddingLeft: 8, borderLeft: "1px solid #ff3a3a33" }}>{r}</div>)}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 12, paddingTop: 12, borderTop: "1px solid #1a2040", flexWrap: "wrap" }}>
                <span style={{ fontSize: 9, padding: "3px 10px", borderRadius: 3, border: `1px solid #ff3a3a44`, color: "#ff3a3a" }}>TRAP: {play.trapRisk}%</span>
                <span style={{ fontSize: 9, padding: "3px 10px", borderRadius: 3, border: "1px solid #1a2040", color: "#6080a0" }}>RISK: {play.risk}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
