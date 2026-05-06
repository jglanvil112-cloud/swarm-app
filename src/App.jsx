import { useState, useRef, useEffect } from "react";

const AGENTS = {
  COMMANDER: { icon: "🎖️", color: "#FFD700" },
  RESEARCHER: { icon: "🔬", color: "#00BFFF" },
  BUILDER: { icon: "🛠️", color: "#FF8C00" },
  ANALYST: { icon: "📊", color: "#00FF7F" },
  "MEMORY CORE": { icon: "💾", color: "#DA70D6" },
  "AUTOMATION ENGINE": { icon: "⚙️", color: "#FF6347" },
  VISIONARY: { icon: "🔮", color: "#7B68EE" },
  "ARCHITECT CORE": { icon: "🧠", color: "#00FFFF" },
};

const MODES = ["BUILD", "RESEARCH", "AUTOMATION", "EXECUTION", "STRATEGY"];

function detectMode(text) {
  const t = text.toLowerCase();
  if (t.includes("build") || t.includes("code") || t.includes("deploy")) return "BUILD";
  if (t.includes("research") || t.includes("analyze") || t.includes("find")) return "RESEARCH";
  if (t.includes("automate") || t.includes("script") || t.includes("workflow")) return "AUTOMATION";
  if (t.includes("execute") || t.includes("run") || t.includes("do")) return "EXECUTION";
  return "STRATEGY";
}

export default function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState("STRATEGY");
  const [history, setHistory] = useState([]);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const prompt = input.trim();
    setInput("");
    setMode(detectMode(prompt));

    const userMsg = { role: "user", content: prompt };
    setMessages((prev) => [...prev, { type: "user", text: prompt }]);
    setLoading(true);

    const newHistory = [...history, userMsg];

    try {
      const res = await fetch("/api/swarm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, history }),
      });
      const data = await res.json();
      const reply = data.reply || data.error;
      setMessages((prev) => [...prev, { type: "swarm", text: reply }]);
      setHistory([...newHistory, { role: "assistant", content: reply }]);
    } catch {
      setMessages((prev) => [...prev, { type: "error", text: "Connection failed. Check your server." }]);
    }
    setLoading(false);
  };

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    setMessages([]);
    setHistory([]);
    setMode("STRATEGY");
  };

  return (
    <div style={{
      background: "#0a0a0f",
      minHeight: "100vh",
      color: "#e0e0e0",
      fontFamily: "'Courier New', monospace",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{
        background: "linear-gradient(90deg, #0d0d1a, #1a0d2e)",
        borderBottom: "1px solid #00FFFF33",
        padding: "16px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: "bold", color: "#00FFFF", letterSpacing: 3 }}>
            ⬡ SWARM-X
          </div>
          <div style={{ fontSize: 11, color: "#666", letterSpacing: 2 }}>
            AUTONOMOUS MULTI-AGENT SYSTEM
          </div>
        </div>

        {/* Mode indicator */}
        <div style={{ display: "flex", gap: 8 }}>
          {MODES.map((m) => (
            <div key={m} style={{
              padding: "4px 10px",
              borderRadius: 4,
              fontSize: 10,
              letterSpacing: 1,
              border: `1px solid ${mode === m ? "#00FFFF" : "#333"}`,
              color: mode === m ? "#00FFFF" : "#444",
              background: mode === m ? "#00FFFF11" : "transparent",
              transition: "all 0.3s",
            }}>{m}</div>
          ))}
        </div>

        <button onClick={clearChat} style={{
          background: "transparent",
          border: "1px solid #333",
          color: "#666",
          padding: "6px 14px",
          borderRadius: 4,
          cursor: "pointer",
          fontSize: 11,
          letterSpacing: 1,
        }}>CLEAR</button>
      </div>

      {/* Agent roster */}
      <div style={{
        display: "flex",
        gap: 12,
        padding: "12px 24px",
        borderBottom: "1px solid #ffffff0a",
        overflowX: "auto",
      }}>
        {Object.entries(AGENTS).map(([name, { icon, color }]) => (
          <div key={name} style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 12px",
            borderRadius: 20,
            border: `1px solid ${color}33`,
            background: `${color}0a`,
            whiteSpace: "nowrap",
            fontSize: 11,
          }}>
            <span>{icon}</span>
            <span style={{ color, letterSpacing: 1 }}>{name}</span>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, boxShadow: `0 0 6px ${color}` }} />
          </div>
        ))}
      </div>

      {/* Chat area */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px", display: "flex", flexDirection: "column", gap: 16 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: "center", marginTop: 60, color: "#333" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⬡</div>
            <div style={{ fontSize: 14, letterSpacing: 2, color: "#444" }}>SWARM-X STANDING BY</div>
            <div style={{ fontSize: 11, color: "#333", marginTop: 8 }}>Enter your mission objective below</div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} style={{
            display: "flex",
            flexDirection: msg.type === "user" ? "row-reverse" : "row",
            gap: 12,
            alignItems: "flex-start",
          }}>
            <div style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: msg.type === "user" ? "#1a1a2e" : "#0d1117",
              border: `1px solid ${msg.type === "user" ? "#7B68EE" : "#00FFFF"}44`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
              flexShrink: 0,
            }}>
              {msg.type === "user" ? "👤" : "🧠"}
            </div>
            <div style={{
              maxWidth: "75%",
              padding: "12px 16px",
              borderRadius: 8,
              background: msg.type === "user" ? "#1a1a2e" : "#0d1117",
              border: `1px solid ${msg.type === "user" ? "#7B68EE22" : "#00FFFF22"}`,
              fontSize: 13,
              lineHeight: 1.7,
              whiteSpace: "pre-wrap",
              color: msg.type === "error" ? "#FF6347" : "#e0e0e0",
            }}>
              {msg.type === "swarm" && (
                <div style={{ fontSize: 10, color: "#00FFFF", letterSpacing: 2, marginBottom: 8 }}>
                  🧠 SWARM-X ARCHITECT CORE
                </div>
              )}
              {msg.text}
            </div>
          </div>
        ))}

        {loading && (
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <div style={{
              width: 36, height: 36, borderRadius: "50%",
              background: "#0d1117", border: "1px solid #00FFFF44",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
            }}>🧠</div>
            <div style={{
              padding: "12px 16px", borderRadius: 8,
              background: "#0d1117", border: "1px solid #00FFFF22",
            }}>
              <div style={{ fontSize: 10, color: "#00FFFF", letterSpacing: 2, marginBottom: 8 }}>
                🧠 SWARM-X ARCHITECT CORE
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {[0, 1, 2].map((i) => (
                  <div key={i} style={{
                    width: 8, height: 8, borderRadius: "50%", background: "#00FFFF",
                    animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
                  }} />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: "16px 24px",
        borderTop: "1px solid #00FFFF22",
        background: "#0a0a0f",
        display: "flex",
        gap: 12,
      }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Enter mission objective... (Enter to send, Shift+Enter for new line)"
          rows={2}
          style={{
            flex: 1,
            background: "#0d1117",
            border: "1px solid #00FFFF33",
            borderRadius: 8,
            padding: "12px 16px",
            color: "#e0e0e0",
            fontSize: 13,
            fontFamily: "'Courier New', monospace",
            resize: "none",
            outline: "none",
          }}
        />
        <button
          onClick={sendMessage}
          disabled={loading || !input.trim()}
          style={{
            padding: "0 24px",
            background: loading ? "#0d1117" : "linear-gradient(135deg, #00FFFF22, #7B68EE22)",
            border: `1px solid ${loading ? "#333" : "#00FFFF"}`,
            borderRadius: 8,
            color: loading ? "#444" : "#00FFFF",
            cursor: loading ? "not-allowed" : "pointer",
            fontSize: 13,
            letterSpacing: 2,
            fontFamily: "'Courier New', monospace",
          }}
        >
          {loading ? "..." : "EXECUTE"}
        </button>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.2; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1.2); }
        }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #0a0a0f; }
        ::-webkit-scrollbar-thumb { background: #00FFFF33; border-radius: 2px; }
      `}</style>
    </div>
  );
}
