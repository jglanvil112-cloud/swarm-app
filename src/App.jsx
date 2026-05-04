import { useState } from "react";

export default function App() {
  const [logs, setLogs] = useState([]);

  const runSwarm = () => {
    const agents = ["Queen", "Coder", "Tester", "Reviewer", "Planner"];

    agents.forEach((agent, i) => {
      setTimeout(() => {
        setLogs((prev) => [...prev, `${agent} agent running task...`]);
      }, i * 1000);
    });
  };

  return (
    <div style={{ padding: 20, color: "white", background: "#0c0c0c", minHeight: "100vh" }}>
      <h1>🧠 Swarm Control Panel</h1>
      <button onClick={runSwarm} style={{ padding: 10, marginTop: 10 }}>
        Launch Swarm
      </button>

      <div style={{ marginTop: 20 }}>
        {logs.map((log, i) => (
          <div key={i}>⚡ {log}</div>
        ))}
      </div>
    </div>
  );
}
