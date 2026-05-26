import React, { useState } from 'react';

export default function SwarmXHybrid() {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [activeAgent, setActiveAgent] = useState(null);
  const [expandedAgent, setExpandedAgent] = useState(null);
  const [activeView, setActiveView] = useState('command');

  const agents = [
    {
      id: 'trends', name: 'TREND HUNTER', role: 'Data Scout', level: 17,
      score: '98%', metric: 'TREND SCORE', color: '#A855F7',
      borderColor: 'rgba(168,85,247,0.6)', icon: '🔍',
      characterBg: 'linear-gradient(135deg, rgba(168,85,247,0.2), rgba(109,40,217,0.1))',
      updates24h: [
        { time: '2h ago', task: 'Found 4 hot niches: Halloween SVG (97%)' },
        { time: '8h ago', task: 'Analyzed Etsy trends' }
      ],
      updates6h: [
        { time: '2h ago', task: 'Scanning: Holiday designs +45%' }
      ]
    },
    {
      id: 'products', name: 'PRODUCT CREATOR', role: 'Innovator', level: 17,
      score: '47', metric: 'CONCEPTS', color: '#3B82F6',
      borderColor: 'rgba(59,130,246,0.6)', icon: '🎨',
      characterBg: 'linear-gradient(135deg, rgba(59,130,246,0.2), rgba(37,99,235,0.1))',
      updates24h: [
        { time: '2h ago', task: 'Designed 12 new product concepts' }
      ],
      updates6h: [
        { time: '1h ago', task: 'Working on: Custom portraits' }
      ]
    }
  ];

  const AgentCard = ({ agent }) => (
    <div onClick={() => setExpandedAgent(expandedAgent === agent.id ? null : agent.id)}
      style={{
        background: agent.characterBg, border: `3px solid ${agent.color}`,
        borderRadius: '16px', padding: '16px', minHeight: '200px',
        boxShadow: `0 0 20px ${agent.color}40`, cursor: 'pointer'
      }}>
      <div style={{ fontSize: '10px', color: agent.color, fontWeight: 700 }}>
        {agent.icon} {agent.name}
      </div>
      <div style={{ fontSize: '48px', textAlign: 'center', margin: '16px 0' }}>
        {agent.icon}
      </div>
      <div style={{ fontSize: '24px', fontWeight: 900, color: agent.color, textAlign: 'center' }}>
        {agent.score}
      </div>
    </div>
  );

  return (
    <div style={{ background: 'linear-gradient(135deg, #0A0E1A, #1A1F2E)', minHeight: '100vh', color: '#E2E8F0' }}>
      <div style={{ padding: '16px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
        {agents.map(agent => <AgentCard key={agent.id} agent={agent} />)}
      </div>
    </div>
  );
}
