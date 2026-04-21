const express = require('express');
const path    = require('path');
const fs      = require('fs');
const app     = express();
const PORT    = process.env.PORT || 3000;

const DATA_FILE = path.join(__dirname, 'network_data.json');

// ─── LOAD from disk on startup ─────────────────────────────────────────────
const DEFAULT_DATA = {
  nodes: [],
  edges: [],
  landmarks: [],
  settings: {
    oltPower: 7,
    fiberAttenuation: 0.35,
    connectorLoss: 0.5,
    spliceLoss: 0.1,
    minRxPower: -27
  }
};

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.warn('Could not read save file, starting fresh.', err.message);
  }
  return JSON.parse(JSON.stringify(DEFAULT_DATA));
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save data:', err.message);
  }
}

let networkData = loadData();
console.log(`Loaded network: ${networkData.nodes?.length || 0} nodes, ${networkData.edges?.length || 0} edges`);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── API ROUTES ────────────────────────────────────────────────────────────
app.get('/api/network', (req, res) => res.json(networkData));

app.post('/api/network', (req, res) => {
  networkData = req.body;
  saveData(networkData);
  res.json({ success: true });
});

app.post('/api/network/reset', (req, res) => {
  networkData = {
    nodes: [],
    edges: [],
    landmarks: [],
    settings: networkData.settings || DEFAULT_DATA.settings
  };
  saveData(networkData);
  res.json({ success: true });
});

// ─── dB CALCULATION (server-side) ─────────────────────────────────────────
app.post('/api/calculate', (req, res) => {
  const { nodeId } = req.body;
  const { nodes, edges, settings } = networkData;

  function findPath(targetId) {
    const adjList = {};
    edges.forEach(e => {
      if (!adjList[e.from]) adjList[e.from] = [];
      if (!adjList[e.to])   adjList[e.to]   = [];
      adjList[e.from].push({ id: e.to,   edge: e });
      adjList[e.to].push  ({ id: e.from, edge: e });
    });
    const olt = nodes.find(n => n.type === 'OLT');
    if (!olt) return null;
    const queue   = [[olt.id, []]];
    const visited = new Set();
    while (queue.length) {
      const [curr, p] = queue.shift();
      if (curr === targetId) return p;
      if (visited.has(curr)) continue;
      visited.add(curr);
      (adjList[curr] || []).forEach(({ id, edge }) => {
        if (!visited.has(id)) queue.push([id, [...p, { from: curr, to: id, edge }]]);
      });
    }
    return null;
  }

  const path = findPath(nodeId);
  if (!path) return res.json({ error: 'No path found from OLT' });

  let totalLoss = 0;
  const breakdown = [];
  const SPLITTER_LOSS = { 2: 3.7, 4: 7.2, 8: 10.5, 16: 13.8, 32: 17.1, 64: 20.4 };

  path.forEach(step => {
    const fromNode = nodes.find(n => n.id === step.from);
    const toNode   = nodes.find(n => n.id === step.to);

    const fiberLoss = step.edge.distance * settings.fiberAttenuation;
    totalLoss += fiberLoss;
    breakdown.push({ type: 'fiber', label: `Fiber ${(step.edge.distance * 1000).toFixed(0)}m`, loss: fiberLoss });

    if (fromNode && fromNode.type !== 'POLE') {
      totalLoss += settings.connectorLoss;
      breakdown.push({ type: 'connector', label: `Connector at ${fromNode.name}`, loss: settings.connectorLoss });
    }
    if (toNode && toNode.type !== 'POLE') {
      totalLoss += settings.connectorLoss;
      breakdown.push({ type: 'connector', label: `Connector at ${toNode.name}`, loss: settings.connectorLoss });
    }
    if (fromNode && fromNode.type === 'SPLITTER') {
      const sl = SPLITTER_LOSS[fromNode.splitRatio] || 10.5;
      totalLoss += sl;
      breakdown.push({ type: 'splitter', label: `Splitter 1:${fromNode.splitRatio}`, loss: sl });
    }
  });

  const rxPower = settings.oltPower - totalLoss;
  const margin  = rxPower - settings.minRxPower;
  const status  = margin > 3 ? 'excellent' : margin > 0 ? 'marginal' : 'fail';
  res.json({ totalLoss, rxPower, margin, status, breakdown, hops: path.length });
});

app.listen(PORT, () => {
  console.log(`\nFTTH Fiber Planner running at http://localhost:${PORT}\n`);
});
