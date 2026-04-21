// ─── STATE ──────────────────────────────────────────────────────────────
let map;
let nodes = [];   // { id, type, name, lat, lng, splitRatio?, marker, dbResult?, tag? }
let edges = [];   // { id, from, to, distance, color, isFeeder, polyline, labelMarker }
let settings = { oltPower: 7, fiberAttenuation: 0.35, connectorLoss: 0.5, spliceLoss: 0.1, minRxPower: -27 };

let activeTool = 'select';
let fiberStart = null;
let pendingSplitterLatLng = null;
let pendingLandmarkLatLng = null;
let selectedLandmarkSymbol = 'house';
let selectedElement = null;
let nodeCounter = 0;
let currentCableColor = '#0088cc';

// ─── LANDMARKS (decorative map markers) ──────────────────────────────────
let landmarks = []; // { id, symbol, name, lat, lng, marker }
let landmarkCounter = 0;

const LANDMARK_EMOJI = {
  house:    '🏠', mosque:   '🕌', church:   '⛪',
  school:   '🏫', hospital: '🏥', shop:     '🏪',
  office:   '🏢', factory:  '🏭', hotel:    '🏨',
  park:     '🌳', tower:    '📡', pin:      '📍'
};

function selectLandmarkSymbol(btn) {
  document.querySelectorAll('.lm-sym-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedLandmarkSymbol = btn.dataset.sym;
}

function openLandmarkDialog(lat, lng) {
  pendingLandmarkLatLng = { lat, lng };
  selectedLandmarkSymbol = 'house';
  document.querySelectorAll('.lm-sym-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.lm-sym-btn[data-sym="house"]').classList.add('active');
  document.getElementById('landmark-name-input').value = '';
  document.getElementById('landmarkDialog').classList.remove('hidden');
  setTimeout(() => {
    const inp = document.getElementById('landmark-name-input');
    inp.focus();
    inp.onkeydown = e => { if (e.key === 'Enter') confirmLandmark(); };
  }, 100);
}

function closeLandmarkDialog() {
  pendingLandmarkLatLng = null;
  document.getElementById('landmarkDialog').classList.add('hidden');
}

function confirmLandmark() {
  if (!pendingLandmarkLatLng) return;
  const name = document.getElementById('landmark-name-input').value.trim() || LANDMARK_EMOJI[selectedLandmarkSymbol];
  addLandmark({ lat: pendingLandmarkLatLng.lat, lng: pendingLandmarkLatLng.lng, symbol: selectedLandmarkSymbol, name });
  closeLandmarkDialog();
}

function restoreLandmark(data) {
  const emoji = LANDMARK_EMOJI[data.symbol] || '📍';

  const icon = L.divIcon({
    html: `<div class="landmark-marker">
      <div class="lm-icon">${emoji}</div>
      <div class="lm-label">${data.name}</div>
    </div>`,
    className: '', iconAnchor: [20, 36], popupAnchor: [0, -38]
  });

  const marker = L.marker([data.lat, data.lng], { icon, draggable: true }).addTo(map);
  const lm = { id: data.id, symbol: data.symbol, name: data.name, lat: data.lat, lng: data.lng, marker };

  marker.on('click', e => {
    L.DomEvent.stopPropagation(e);
    if (activeTool === 'delete') { deleteLandmark(data.id); }
  });

  marker.on('dragstart', () => commitState());

  marker.on('dragend', e => {
    const ll = e.target.getLatLng();
    lm.lat = ll.lat; lm.lng = ll.lng;
    saveToServer();
  });

  landmarks.push(lm);
}

function addLandmark({ lat, lng, symbol, name }) {
  commitState();
  const id = `lm_${++landmarkCounter}`;
  restoreLandmark({ id, lat, lng, symbol, name });
  saveToServer();
}

function deleteLandmark(id) {
  commitState();
  const idx = landmarks.findIndex(l => l.id === id);
  if (idx === -1) return;
  landmarks[idx].marker.remove();
  landmarks.splice(idx, 1);
  saveToServer();
}

// ─── CABLE COLORS ────────────────────────────────────────────────────────
function generateNewCableColor() {
  const colors = [
    '#0000ff','#ffa500','#008000','#8b4513','#808080','#ff0000','#ffff00','#800080','#ffc0cb','#00ffff',
    '#e6194b','#3cb44b','#4363d8','#f58231','#911eb4','#46f0f0','#f032e6','#bcf60c','#008080','#9a6324',
    '#800000','#808000','#000075','#0088cc','#ff1493','#7fffd4','#dc143c','#00fa9a','#1e90ff','#ff69b4',
    '#cd5c5c','#4b0082','#ff4500','#2e8b57','#da70d6','#d2691e','#9acd32','#6495ed','#ff8c00','#8a2be2',
    '#00ced1','#adff2f','#ff00ff','#191970','#fa8072','#00ff00','#ffb6c1','#db7093','#40e0d0','#ee82ee',
    '#7cfc00','#8b008b','#ff6347','#4682b4','#b22222'
  ];
  currentCableColor = colors[Math.floor(Math.random() * colors.length)];
}

// ─── UNDO STATE ──────────────────────────────────────────────────────────
let undoStack = [];

function commitState() {
  const state = {
    nodeCounter,
    landmarkCounter,
    nodes: nodes.map(n => ({ id: n.id, type: n.type, name: n.name, lat: n.lat, lng: n.lng, splitRatio: n.splitRatio })),
    edges: edges.map(e => ({ id: e.id, from: e.from, to: e.to, distance: e.distance, color: e.color })),
    landmarks: landmarks.map(l => ({ id: l.id, symbol: l.symbol, name: l.name, lat: l.lat, lng: l.lng }))
  };
  undoStack.push(JSON.stringify(state));
  if (undoStack.length > 50) undoStack.shift();
}

function undo() {
  if (undoStack.length === 0) return;
  const prevState = JSON.parse(undoStack.pop());
  nodes.forEach(n => n.marker.remove());
  edges.forEach(e => { e.polyline.remove(); e.labelMarker?.remove(); });
  landmarks.forEach(lm => lm.marker.remove());
  nodes = []; edges = []; landmarks = [];
  nodeCounter = prevState.nodeCounter || 0;
  landmarkCounter = prevState.landmarkCounter || 0;
  prevState.nodes.forEach(nData => restoreNode(nData));
  prevState.edges.forEach(eData => restoreEdge(eData));
  if (prevState.landmarks) prevState.landmarks.forEach(lData => restoreLandmark(lData));
  clearSelection();
  recalcAll();
  updateStats();
  saveToServer();
}

// ─── MAP INIT ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  map = L.map('map', { zoomControl: true, attributionControl: true }).setView([-6.966, 110.416], 14);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 20
  }).addTo(map);

  map.on('click', e => {
    onMapClick(e.latlng.lat, e.latlng.lng);
    if (activeTool === 'select') clearSelection();
  });

  initSplitterTable();
  updateStats();
  setupKeyboardShortcuts();
  initTheme();
  loadFromServer();
});

function initTheme() {
  const saved = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  const btn = document.getElementById('btn-theme');
  if (btn) btn.textContent = saved === 'dark' ? '☀️' : '🌙';
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  const btn = document.getElementById('btn-theme');
  if (btn) btn.textContent = next === 'dark' ? '☀️' : '🌙';
}

async function loadFromServer() {
  try {
    const res  = await fetch('/api/network');
    const data = await res.json();
    if (!data.nodes?.length && !data.edges?.length) return; // nothing saved yet

    // Restore settings
    if (data.settings) {
      Object.assign(settings, data.settings);
      document.getElementById('set-oltPower').value      = settings.oltPower;
      document.getElementById('set-attenuation').value   = settings.fiberAttenuation;
      document.getElementById('set-connectorLoss').value = settings.connectorLoss;
      document.getElementById('set-minRxPower').value    = settings.minRxPower;
    }

    // Restore nodes (track highest counter)
    data.nodes.forEach(n => {
      const num = parseInt(n.id.replace('node_', '')) || 0;
      if (num > nodeCounter) nodeCounter = num;
      restoreNode(n);
    });

    // Restore landmarks
    if (data.landmarks) {
      data.landmarks.forEach(lm => {
        const num = parseInt(lm.id.replace('lm_', '')) || 0;
        if (num > landmarkCounter) landmarkCounter = num;
        restoreLandmark(lm);
      });
    }

    // Restore edges
    data.edges.forEach(e => restoreEdge(e));

    // Fit map to loaded network
    const allNodes = nodes;
    if (allNodes.length > 0) {
      const lats = allNodes.map(n => n.lat);
      const lngs = allNodes.map(n => n.lng);
      map.fitBounds([
        [Math.min(...lats), Math.min(...lngs)],
        [Math.max(...lats), Math.max(...lngs)]
      ], { padding: [60, 60] });
    }

    recalcAll();
    updateStats();
    console.log(`Restored ${data.nodes.length} nodes, ${data.edges.length} edges from server.`);
  } catch (err) {
    console.warn('Could not load saved network:', err.message);
  }
}


// ─── TOOL SELECTION ──────────────────────────────────────────────────────
function setTool(tool) {
  if (tool === 'fiber' && activeTool !== 'fiber') generateNewCableColor();
  activeTool = tool;
  fiberStart = null;

  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById(`tool-${tool}`);
  if (btn) btn.classList.add('active');

  const cursor = (tool === 'select') ? '' : 'crosshair';
  if (map) map.getContainer().style.cursor = cursor;

  const hints = {
    select:   'Click any element to select and view properties',
    olt:      'Click on map to place the OLT (root node) — only one allowed',
    splitter: 'Click on map to place an optical splitter',
    onu:      'Click on map to place an ONU/ONT customer endpoint',
    pole:     'Click on map to place a utility pole for routing',
    landmark: 'Click on map to place a landmark marker (house, mosque, etc.)',
    fiber:    'Click a source node, then a destination node to draw fiber',
    delete:   'Click any node or fiber line to delete it'
  };
  setHint(hints[tool] || '');
}

document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => { if (btn.dataset.tool) setTool(btn.dataset.tool); });
});

function setHint(msg) {
  const el = document.getElementById('map-hint');
  el.textContent = msg;
  el.classList.toggle('hidden', !msg);
}

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { undo(); e.preventDefault(); return; }
    const mapKeys = { s: 'select', o: 'olt', p: 'splitter', u: 'onu', l: 'pole', f: 'fiber', m: 'landmark' };
    if (mapKeys[e.key]) setTool(mapKeys[e.key]);
    if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
    if (e.key === 'Escape') { setTool('select'); fiberStart = null; generateNewCableColor(); }
  });
}

// ─── MAP CLICK ───────────────────────────────────────────────────────────
function onMapClick(lat, lng) {
  if (activeTool === 'olt') {
    if (nodes.find(n => n.type === 'OLT')) {
      alert('Only one OLT is allowed per network. Delete the existing OLT first.');
      return;
    }
    addNode({ type: 'OLT', name: 'OLT-01', lat, lng });
    setTool('select');

  } else if (activeTool === 'splitter') {
    pendingSplitterLatLng = { lat, lng };
    document.getElementById('splitterDialog').classList.remove('hidden');

  } else if (activeTool === 'onu') {
    const count = nodes.filter(n => n.type === 'ONU').length + 1;
    addNode({ type: 'ONU', name: `ONU-${String(count).padStart(2, '0')}`, lat, lng });

  } else if (activeTool === 'pole') {
    const count = nodes.filter(n => n.type === 'POLE').length + 1;
    addNode({ type: 'POLE', name: `POLE-${String(count).padStart(2, '0')}`, lat, lng });

  } else if (activeTool === 'landmark') {
    openLandmarkDialog(lat, lng);
  }
}

// ─── ADD / RESTORE NODE ──────────────────────────────────────────────────
function restoreNode(data) {
  const icon = getMarkerIcon(data.type, data.splitRatio);
  const marker = L.marker([data.lat, data.lng], { icon, draggable: true, title: data.name }).addTo(map);

  const node = { id: data.id, type: data.type, name: data.name, lat: data.lat, lng: data.lng, splitRatio: data.splitRatio, dbResult: null, tag: null, marker };

  marker.on('click', e => {
    L.DomEvent.stopPropagation(e);
    if (activeTool === 'delete') { deleteNode(node.id); return; }
    if (activeTool === 'fiber') { handleFiberClick(node.id); return; }
    if (activeTool === 'select') selectElement('node', node.id);
  });

  marker.on('dragstart', () => commitState());

  marker.on('dragend', e => {
    const ll = e.target.getLatLng();
    node.lat = ll.lat;
    node.lng = ll.lng;
    edges.filter(edge => edge.from === node.id || edge.to === node.id).forEach(updateEdgeGeometry);
    recalcAll();
    saveToServer();
  });

  if (data.type !== 'POLE') {
    marker.bindTooltip(data.name, { permanent: false, direction: 'top', offset: [0, -16] });
  }

  nodes.push(node);
}

function addNode({ type, name, lat, lng, splitRatio = 8 }) {
  commitState();
  const id = `node_${++nodeCounter}`;
  restoreNode({ id, type, name, lat, lng, splitRatio });
  recalcAll();
  updateStats();
  saveToServer();
  return nodes[nodes.length - 1];
}

function confirmSplitter(ratio) {
  if (!pendingSplitterLatLng) return;
  const count = nodes.filter(n => n.type === 'SPLITTER').length + 1;
  addNode({ type: 'SPLITTER', name: `SP-${String(count).padStart(2, '0')}`, lat: pendingSplitterLatLng.lat, lng: pendingSplitterLatLng.lng, splitRatio: ratio });
  pendingSplitterLatLng = null;
  document.getElementById('splitterDialog').classList.add('hidden');
}

function closeSplitterDialog() {
  pendingSplitterLatLng = null;
  document.getElementById('splitterDialog').classList.add('hidden');
}

// ─── FIBER DRAWING ───────────────────────────────────────────────────────
function handleFiberClick(nodeId) {
  if (!fiberStart) {
    fiberStart = nodeId;
    const node = nodes.find(n => n.id === nodeId);
    if (node) {
      const status = node.dbResult && !node.dbResult.error ? node.dbResult.status : (node.type === 'ONU' ? 'lost' : null);
      const rxPower = node.dbResult && !node.dbResult.error ? node.dbResult.rxPower : null;
      node.marker.setIcon(getMarkerIcon(node.type, node.splitRatio, true, status, rxPower));
    }
    setHint(`Source: ${node?.name}. Now click the destination node.`);
  } else {
    if (fiberStart === nodeId) {
      const node = nodes.find(n => n.id === nodeId);
      if (node) {
        const status = node.dbResult && !node.dbResult.error ? node.dbResult.status : (node.type === 'ONU' ? 'lost' : null);
        const rxPower = node.dbResult && !node.dbResult.error ? node.dbResult.rxPower : null;
        node.marker.setIcon(getMarkerIcon(node.type, node.splitRatio, false, status, rxPower));
      }
      fiberStart = null;
      setHint('Click the source node to start a fiber connection.');
      generateNewCableColor();
      return;
    }

    const fromNode = nodes.find(n => n.id === fiberStart);
    if (fromNode) {
      const status = fromNode.dbResult && !fromNode.dbResult.error ? fromNode.dbResult.status : (fromNode.type === 'ONU' ? 'lost' : null);
      const rxPower = fromNode.dbResult && !fromNode.dbResult.error ? fromNode.dbResult.rxPower : null;
      fromNode.marker.setIcon(getMarkerIcon(fromNode.type, fromNode.splitRatio, false, status, rxPower));
    }

    addEdge(fiberStart, nodeId);

    const toNode = nodes.find(n => n.id === nodeId);
    if (toNode && toNode.type === 'POLE') {
      fiberStart = nodeId;
      toNode.marker.setIcon(getMarkerIcon(toNode.type, toNode.splitRatio, true));
      setHint(`Continuing from: ${toNode.name}. Click next node to continue routing, or click it again to stop.`);
    } else {
      fiberStart = null;
      setHint('Click another source node to continue, or switch tools.');
      generateNewCableColor();
    }
  }
}

// ─── ADD / RESTORE EDGE ──────────────────────────────────────────────────
function restoreEdge(data) {
  const from = nodes.find(n => n.id === data.from);
  const to   = nodes.find(n => n.id === data.to);
  if (!from || !to) return;

  const c = data.color || '#0088cc';
  const polyline = L.polyline([[from.lat, from.lng], [to.lat, to.lng]], {
    color: c, weight: 2.5, opacity: 0.85
  }).addTo(map);

  const midLat = (from.lat + to.lat) / 2;
  const midLng = (from.lng + to.lng) / 2;
  const labelIcon = L.divIcon({
    html: `<div style="color:${c};font-family:'Share Tech Mono',monospace;font-size:10px;font-weight:700;white-space:nowrap;text-shadow:0 0 3px #fff,0 0 3px #fff">${(data.distance * 1000).toFixed(0)}m</div>`,
    className: '', iconAnchor: [20, 8]
  });
  const labelMarker = L.marker([midLat, midLng], { icon: labelIcon, interactive: false }).addTo(map);

  const edge = { id: data.id, from: data.from, to: data.to, distance: data.distance, color: c, isFeeder: false, polyline, labelMarker };

  polyline.on('click', e => {
    L.DomEvent.stopPropagation(e);
    if (activeTool === 'delete') { deleteEdge(edge.id); return; }
    if (activeTool === 'select') selectElement('edge', edge.id);
  });

  edges.push(edge);
}

function addEdge(fromId, toId) {
  commitState();
  const from = nodes.find(n => n.id === fromId);
  const to   = nodes.find(n => n.id === toId);
  if (!from || !to) return;
  const id = `edge_${Date.now()}`;
  const distance = calcDistance(from.lat, from.lng, to.lat, to.lng);
  restoreEdge({ id, from: fromId, to: toId, distance, color: currentCableColor });
  recalcAll();
  updateStats();
  saveToServer();
  return edges[edges.length - 1];
}

function updateEdgeGeometry(edge) {
  const from = nodes.find(n => n.id === edge.from);
  const to   = nodes.find(n => n.id === edge.to);
  if (!from || !to) return;
  edge.distance = calcDistance(from.lat, from.lng, to.lat, to.lng);
  edge.polyline.setLatLngs([[from.lat, from.lng], [to.lat, to.lng]]);
  const midLat = (from.lat + to.lat) / 2;
  const midLng = (from.lng + to.lng) / 2;
  edge.labelMarker.setLatLng([midLat, midLng]);
  updateEdgeLabelIcon(edge);
}

function updateEdgeLabelIcon(edge) {
  const c = edge.isFeeder ? '#000000' : (edge.color || '#0088cc');
  edge.labelMarker.setIcon(L.divIcon({
    html: `<div style="color:${c};font-family:'Share Tech Mono',monospace;font-size:10px;font-weight:700;white-space:nowrap;text-shadow:0 0 3px #fff,0 0 3px #fff">${(edge.distance * 1000).toFixed(0)}m</div>`,
    className: '', iconAnchor: [20, 8]
  }));
}

// ─── DELETE ───────────────────────────────────────────────────────────────
function deleteNode(id) {
  commitState();
  const idx = nodes.findIndex(n => n.id === id);
  if (idx === -1) return;
  nodes[idx].marker.remove();
  edges.filter(e => e.from === id || e.to === id).forEach(e => { e.polyline.remove(); e.labelMarker?.remove(); });
  edges = edges.filter(e => e.from !== id && e.to !== id);
  nodes.splice(idx, 1);
  clearSelection(); updateStats(); recalcAll(); saveToServer();
}

function deleteEdge(id) {
  commitState();
  const idx = edges.findIndex(e => e.id === id);
  if (idx === -1) return;
  edges[idx].polyline.remove();
  edges[idx].labelMarker?.remove();
  edges.splice(idx, 1);
  clearSelection(); recalcAll(); updateStats(); saveToServer();
}

function deleteSelected() {
  if (!selectedElement) return;
  if (selectedElement.type === 'node') deleteNode(selectedElement.id);
  else if (selectedElement.type === 'edge') deleteEdge(selectedElement.id);
}

// ─── SELECTION ────────────────────────────────────────────────────────────
function selectElement(type, id) {
  selectedElement = { type, id };
  if (type === 'node') {
    const node = nodes.find(n => n.id === id);
    if (!node) return;
    renderSelectedNode(node);
    if (node.type === 'ONU') renderDbResults(node);
    else document.getElementById('db-panel').style.display = 'none';
    map.panTo([node.lat, node.lng]);
  } else if (type === 'edge') {
    const edge = edges.find(e => e.id === id);
    if (!edge) return;
    renderSelectedEdge(edge);
    document.getElementById('db-panel').style.display = 'none';
  }
}

function clearSelection() {
  selectedElement = null;
  document.getElementById('selected-panel').innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">◎</div>
      <div>Click an element on the map to view its properties</div>
    </div>`;
  document.getElementById('db-panel').style.display = 'none';
}

function renderSelectedNode(node) {
  const typeLabels = { OLT: 'Optical Line Terminal', SPLITTER: 'Optical Splitter', ONU: 'Optical Network Unit', POLE: 'Utility Pole' };
  let extra = '';
  if (node.type === 'SPLITTER') {
    const tagBadge = node.tag ? `<div class="prop-row"><span class="pk">Tag</span><span class="pv" style="font-weight:700;font-size:13px;color:var(--accent)">[${node.tag}]</span></div>` : '';
    extra = `${tagBadge}<div class="prop-edit-row">
      <label>Split Ratio</label>
      <select onchange="updateNodeRatio('${node.id}', this.value)">
        ${[2,4,8,16,32,64].map(r => `<option value="${r}" ${r == node.splitRatio ? 'selected' : ''}>${r}</option>`).join('')}
      </select>
    </div>`;
  }
  const connectedEdges = edges.filter(e => e.from === node.id || e.to === node.id);
  document.getElementById('selected-panel').innerHTML = `
    <div class="prop-card">
      <div class="prop-type">${typeLabels[node.type] || node.type}</div>
      <div class="prop-name">${node.name}</div>
      <div class="prop-row"><span class="pk">ID</span><span class="pv">${node.id}</span></div>
      <div class="prop-row"><span class="pk">Lat</span><span class="pv">${node.lat.toFixed(6)}</span></div>
      <div class="prop-row"><span class="pk">Lng</span><span class="pv">${node.lng.toFixed(6)}</span></div>
      ${node.type === 'SPLITTER' ? `<div class="prop-row"><span class="pk">Ratio</span><span class="pv">1:${node.splitRatio}</span></div>` : ''}
      <div class="prop-row"><span class="pk">Connections</span><span class="pv">${connectedEdges.length}</span></div>
      ${extra}
      <div class="prop-edit-row">
        <label>Label</label>
        <input type="text" value="${node.name}" onchange="renameNode('${node.id}', this.value)" />
      </div>
    </div>
    ${node.type === 'ONU' ? `<button class="btn-primary" style="width:100%;margin-top:8px;margin-bottom:4px" onclick="simulatePathToNode('${node.id}')">▶ Simulate Signal Path</button>` : ''}
    <button class="btn-secondary" style="width:100%;margin-top:4px" onclick="deleteNode('${node.id}')">🗑 Delete Node</button>`;
}

function renderSelectedEdge(edge) {
  const from = nodes.find(n => n.id === edge.from);
  const to   = nodes.find(n => n.id === edge.to);
  const c = edge.isFeeder ? '#000000' : (edge.color || '#0088cc');
  document.getElementById('selected-panel').innerHTML = `
    <div class="prop-card">
      <div class="prop-type">Fiber Cable</div>
      <div class="prop-name">${from?.name || '?'} → ${to?.name || '?'}</div>
      <div class="prop-row"><span class="pk">Color</span><span class="pv"><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${c};margin-right:6px;vertical-align:middle"></span>${c}</span></div>
      <div class="prop-row"><span class="pk">Type</span><span class="pv">${edge.isFeeder ? '⬛ Feeder Cable' : '🔵 Distribution'}</span></div>
      <div class="prop-row"><span class="pk">Distance</span><span class="pv">${(edge.distance * 1000).toFixed(1)} m</span></div>
      <div class="prop-row"><span class="pk">Distance</span><span class="pv">${edge.distance.toFixed(4)} km</span></div>
      <div class="prop-row"><span class="pk">Fiber Loss</span><span class="pv">${(edge.distance * settings.fiberAttenuation).toFixed(3)} dB</span></div>
    </div>
    <button class="btn-secondary" style="width:100%;margin-top:4px" onclick="deleteEdge('${edge.id}')">🗑 Delete Fiber</button>`;
}

// ─── dB CALCULATION ───────────────────────────────────────────────────────
const SPLITTER_LOSS = { 2: 3.7, 4: 7.2, 8: 10.5, 16: 13.8, 32: 17.1, 64: 20.4 };

function calcDbForNode(nodeId) {
  const adjList = {};
  edges.forEach(e => {
    if (!adjList[e.from]) adjList[e.from] = [];
    if (!adjList[e.to])   adjList[e.to]   = [];
    adjList[e.from].push({ id: e.to,   edge: e });
    adjList[e.to].push  ({ id: e.from, edge: e });
  });

  const olt = nodes.find(n => n.type === 'OLT');
  if (!olt) return null;

  const queue = [[olt.id, []]];
  const visited = new Set();
  let path = null;
  while (queue.length) {
    const [curr, p] = queue.shift();
    if (curr === nodeId) { path = p; break; }
    if (visited.has(curr)) continue;
    visited.add(curr);
    (adjList[curr] || []).forEach(({ id, edge }) => {
      if (!visited.has(id)) queue.push([id, [...p, { from: curr, to: id, edge }]]);
    });
  }
  if (!path) return { error: 'No path from OLT' };

  let totalLoss = 0;
  const breakdown = [];

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

    if (fromNode?.type === 'SPLITTER') {
      const sl = SPLITTER_LOSS[fromNode.splitRatio] || 10.5;
      totalLoss += sl;
      breakdown.push({ type: 'splitter', label: `Splitter 1:${fromNode.splitRatio}`, loss: sl });
    }
  });

  const rxPower = settings.oltPower - totalLoss;
  const margin  = rxPower - settings.minRxPower;
  const status  = margin > 3 ? 'excellent' : margin > 0 ? 'marginal' : 'fail';
  return { totalLoss, rxPower, margin, status, breakdown, hops: path.length, _path: path };
}

function renderDbResults(node) {
  const result = calcDbForNode(node.id);
  const panel = document.getElementById('db-panel');
  const container = document.getElementById('db-results');
  if (!result || result.error) {
    panel.style.display = 'block';
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠</div><div>${result?.error || 'Cannot calculate'}</div></div>`;
    return;
  }
  node.dbResult = result;
  panel.style.display = 'block';
  const statusLabel = { excellent: '✓ WITHIN BUDGET', marginal: '⚠ MARGINAL', fail: '✗ OVER BUDGET' };
  container.innerHTML = `
    <div class="db-summary">
      <div class="db-power ${result.status}">${result.rxPower.toFixed(2)} dBm</div>
      <div class="db-badge ${result.status}">${statusLabel[result.status]}</div>
      <div class="db-meta" style="margin-top:8px">
        OLT TX: <span>+${settings.oltPower} dBm</span> &nbsp;|&nbsp;
        Total Loss: <span>${result.totalLoss.toFixed(2)} dB</span>
      </div>
      <div class="db-meta">
        Margin: <span style="color:${result.margin > 0 ? 'var(--green)' : 'var(--red)'}">${result.margin.toFixed(2)} dB</span> &nbsp;|&nbsp;
        Hops: <span>${result.hops}</span>
      </div>
    </div>
    <div class="section-title" style="margin-bottom:8px">LOSS BREAKDOWN</div>
    <div class="db-breakdown">
      ${result.breakdown.map(b => `
        <div class="db-row ${b.type}">
          <span class="db-type">${b.label}</span>
          <span class="db-val">−${b.loss.toFixed(3)} dB</span>
        </div>`).join('')}
      <div class="db-row" style="background:var(--bg-base)">
        <span class="db-type" style="font-weight:700;color:var(--text-pri)">Total</span>
        <span class="db-val" style="color:var(--orange)">−${result.totalLoss.toFixed(3)} dB</span>
      </div>
    </div>`;
}

// ─── CABLE COLORS (feeder = black) ────────────────────────────────────────
function updateCableColors() {
  edges.forEach(e => e.isFeeder = false);
  const olt = nodes.find(n => n.type === 'OLT');
  if (olt) {
    const adjList = {};
    edges.forEach(e => {
      if (!adjList[e.from]) adjList[e.from] = [];
      if (!adjList[e.to])   adjList[e.to]   = [];
      adjList[e.from].push({ id: e.to, edge: e });
      adjList[e.to].push  ({ id: e.from, edge: e });
    });
    const queue = [olt.id];
    const visited = new Set([olt.id]);
    while (queue.length) {
      const currId = queue.shift();
      const currNode = nodes.find(n => n.id === currId);
      if (currNode && currNode.type === 'SPLITTER' && currId !== olt.id) continue;
      (adjList[currId] || []).forEach(({ id: nextId, edge }) => {
        edge.isFeeder = true;
        if (!visited.has(nextId)) { visited.add(nextId); queue.push(nextId); }
      });
    }
  }
  edges.forEach(e => {
    const c = e.isFeeder ? '#000000' : (e.color || '#0088cc');
    e.polyline.setStyle({ color: c });
    updateEdgeLabelIcon(e);
  });
}

// ─── SPLITTER TAGGING ─────────────────────────────────────────────────────
function computeSplitterTags() {
  nodes.forEach(n => { if (n.type === 'SPLITTER') n.tag = null; });
  const olt = nodes.find(n => n.type === 'OLT');
  if (!olt) return;

  const adjList = {};
  nodes.forEach(n => adjList[n.id] = []);
  edges.forEach(e => {
    if (!adjList[e.from]) adjList[e.from] = [];
    if (!adjList[e.to])   adjList[e.to]   = [];
    adjList[e.from].push(e.to);
    adjList[e.to].push(e.from);
  });

  const visited = new Set([olt.id]);
  const queue = [{ id: olt.id, parentTag: null }];
  const childCountMap = {};

  while (queue.length) {
    const { id: currId, parentTag } = queue.shift();
    const currNode = nodes.find(n => n.id === currId);

    if (currNode && currNode.type === 'SPLITTER') {
      currNode.tag = parentTag;
      currNode.marker.getTooltip()?.setContent(`[${parentTag}] ${currNode.name}`);
    }

    let myPrefix = null;
    if (currNode?.type === 'OLT') myPrefix = '';
    else if (currNode?.type === 'SPLITTER') myPrefix = currNode.tag;

    if (myPrefix !== null) {
      if (!childCountMap[currId]) childCountMap[currId] = 0;
      (adjList[currId] || []).forEach(nextId => {
        if (visited.has(nextId)) return;
        visited.add(nextId);
        const nextNode = nodes.find(n => n.id === nextId);
        if (nextNode?.type === 'SPLITTER') {
          const idx = childCountMap[currId]++;
          const childTag = currNode.type === 'OLT'
            ? String.fromCharCode(65 + idx)
            : `${myPrefix}.${idx + 1}`;
          queue.push({ id: nextId, parentTag: childTag });
        } else {
          queue.push({ id: nextId, parentTag: myPrefix });
        }
      });
    }
  }
}

// ─── RECALC ALL ───────────────────────────────────────────────────────────
function recalcAll() {
  updateCableColors();
  computeSplitterTags();
  const onus = nodes.filter(n => n.type === 'ONU');
  onus.forEach(node => {
    const result = calcDbForNode(node.id);
    node.dbResult = result;
    if (result && !result.error) {
      node.marker.setIcon(getMarkerIcon('ONU', null, false, result.status, result.rxPower));
    } else {
      node.marker.setIcon(getMarkerIcon('ONU', null, false, 'lost'));
    }
  });
  renderOnuList();
  if (selectedElement?.type === 'node') {
    const node = nodes.find(n => n.id === selectedElement.id);
    if (node?.type === 'ONU') renderDbResults(node);
  }
}

// ─── ONU LIST ─────────────────────────────────────────────────────────────
function renderOnuList() {
  const container = document.getElementById('onu-list');
  const onus = nodes.filter(n => n.type === 'ONU');
  if (!onus.length) {
    container.innerHTML = '<div style="font-size:11px;color:var(--text-dim);text-align:center;padding:8px">No ONU placed yet</div>';
    return;
  }
  container.innerHTML = onus.map(onu => {
    const r = onu.dbResult;
    const status   = r && !r.error ? r.status : 'lost';
    const powerStr = r && !r.error ? `${r.rxPower.toFixed(2)} dBm` : 'Loss of Signal';
    return `<div class="onu-item ${status}" onclick="selectElement('node','${onu.id}')">
      <div class="onu-name">${onu.name}</div>
      <div class="onu-power ${status}">${powerStr}</div>
    </div>`;
  }).join('');
}

// ─── STATS ────────────────────────────────────────────────────────────────
function updateStats() {
  document.getElementById('stat-olt').textContent      = nodes.filter(n => n.type === 'OLT').length;
  document.getElementById('stat-splitters').textContent = nodes.filter(n => n.type === 'SPLITTER').length;
  document.getElementById('stat-onus').textContent     = nodes.filter(n => n.type === 'ONU').length;
  document.getElementById('stat-km').textContent       = edges.reduce((s, e) => s + e.distance, 0).toFixed(2);
}

function initSplitterTable() {
  const tbody = document.getElementById('splitter-table-body');
  const rows = [[2,3.7],[4,7.2],[8,10.5],[16,13.8],[32,17.1],[64,20.4]];
  tbody.innerHTML = rows.map(([r, il]) => {
    const budget = (settings.oltPower - il - settings.connectorLoss * 2 - settings.minRxPower).toFixed(1);
    return `<tr><td>1:${r}</td><td>${il} dB</td><td>${budget} dB</td></tr>`;
  }).join('');
}

function updateSettings() {
  settings.oltPower        = parseFloat(document.getElementById('set-oltPower').value)      || 7;
  settings.fiberAttenuation = parseFloat(document.getElementById('set-attenuation').value)   || 0.35;
  settings.connectorLoss   = parseFloat(document.getElementById('set-connectorLoss').value)  || 0.5;
  settings.minRxPower      = parseFloat(document.getElementById('set-minRxPower').value)     || -27;
  initSplitterTable();
  recalcAll();
}

function updateNodeRatio(nodeId, ratio) {
  commitState();
  const node = nodes.find(n => n.id === nodeId);
  if (!node) return;
  node.splitRatio = parseInt(ratio);
  node.marker.setIcon(getMarkerIcon('SPLITTER', parseInt(ratio)));
  recalcAll();
}

function renameNode(nodeId, name) {
  commitState();
  const node = nodes.find(n => n.id === nodeId);
  if (!node) return;
  node.name = name;
  if (node.marker.getTooltip()) node.marker.getTooltip().setContent(name);
  else node.marker.bindTooltip(name, { permanent: false, direction: 'top', offset: [0, -16] });
}

// ─── SAVE / RESET ──────────────────────────────────────────────────────────
function saveToServer() {
  const payload = {
    nodes: nodes.map(n => ({ id: n.id, type: n.type, name: n.name, lat: n.lat, lng: n.lng, splitRatio: n.splitRatio })),
    edges: edges.map(e => ({ id: e.id, from: e.from, to: e.to, distance: e.distance, color: e.color })),
    landmarks: landmarks.map(l => ({ id: l.id, symbol: l.symbol, name: l.name, lat: l.lat, lng: l.lng })),
    settings
  };
  fetch('/api/network', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
}

function saveNetwork() {
  saveToServer();
  const toast = document.createElement('div');
  toast.textContent = '✓ Network saved';
  toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#00d4ff;color:#000;padding:10px 20px;border-radius:6px;font-weight:700;z-index:9999;font-size:13px';
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

function resetNetwork() {
  if (!confirm('Clear all nodes, connections, and landmarks?')) return;
  commitState();
  nodes.forEach(n => n.marker.remove());
  edges.forEach(e => { e.polyline.remove(); e.labelMarker?.remove(); });
  landmarks.forEach(lm => lm.marker.remove());
  nodes = []; edges = []; landmarks = [];
  nodeCounter = 0;
  landmarkCounter = 0;
  clearSelection(); updateStats(); renderOnuList();
  fetch('/api/network/reset', { method: 'POST' });
}

// ─── DISTANCE CALC ────────────────────────────────────────────────────────
function calcDistance(lat1, lng1, lat2, lng2) {
  // Use Leaflet's built-in Haversine (returns metres)
  return map ? map.distance([lat1, lng1], [lat2, lng2]) / 1000 : haversine(lat1, lng1, lat2, lng2);
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── MARKER ICONS (L.divIcon SVG) ─────────────────────────────────────────
function getMarkerIcon(type, splitRatio, selected = false, status = null, rxPower = null) {
  const s = selected;

  // Splitter colors keyed by ratio — each ratio has a distinct hue
  const SPLITTER_COLORS = {
    2:  '#00b8a9',  // teal        — 1:2
    4:  '#27ae60',  // green       — 1:4
    8:  '#9933ff',  // purple      — 1:8
    16: '#e67e22',  // orange      — 1:16
    32: '#e74c3c',  // red         — 1:32
    64: '#8e1a1a',  // dark red    — 1:64
  };

  const palette = {
    OLT:      { fill: '#e67300' },
    SPLITTER: { fill: SPLITTER_COLORS[splitRatio] || '#9933ff' },
    POLE:     { fill: '#718096' },
    ONU: {
      excellent: { fill: '#00a854' },
      marginal:  { fill: '#d9a400' },
      fail:      { fill: '#e62e4a' },
      lost:      { fill: '#ff0000' },
      default:   { fill: '#0088cc' }
    }[status || 'default'] || { fill: '#0088cc' },
  };
  const c = palette[type] || palette.ONU;


  let inner = '';
  if (type === 'OLT') {
    inner = `<rect x="4" y="6" width="24" height="16" rx="2" fill="${c.fill}" opacity="0.9"/>
             <line x1="8" y1="22" x2="8" y2="26" stroke="${c.fill}" stroke-width="2"/>
             <line x1="24" y1="22" x2="24" y2="26" stroke="${c.fill}" stroke-width="2"/>
             <text x="16" y="17" fill="#fff" font-size="7" text-anchor="middle" font-weight="bold" font-family="sans-serif">OLT</text>`;
  } else if (type === 'SPLITTER') {
    const label = splitRatio ? `1:${splitRatio}` : 'SP';
    inner = `<circle cx="16" cy="16" r="11" fill="${c.fill}" opacity="0.9"/>
             <circle cx="16" cy="16" r="7" fill="none" stroke="#fff" stroke-width="1.5"/>
             <text x="16" y="20" fill="#fff" font-size="${splitRatio > 9 ? '6' : '7'}" text-anchor="middle" font-weight="bold" font-family="sans-serif">${label}</text>`;
  } else if (type === 'POLE') {
    inner = `<circle cx="16" cy="16" r="6" fill="${c.fill}" opacity="0.9"/>
             <circle cx="16" cy="16" r="2" fill="#fff"/>
             <text x="16" y="27" fill="#4a5568" font-size="5" text-anchor="middle" font-weight="bold" font-family="sans-serif">POLE</text>`;
  } else {
    inner = `<rect x="9" y="4" width="14" height="20" rx="2" fill="${c.fill}" opacity="0.9"/>
             <circle cx="16" cy="20" r="2" fill="#fff"/>
             <text x="16" y="15" fill="#fff" font-size="6" text-anchor="middle" font-weight="bold" font-family="sans-serif">ONU</text>`;
  }

  const glowFilter = s ? `<filter id="glow"><feGaussianBlur stdDeviation="2.5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` : '';
  const ring = s ? `<circle cx="16" cy="16" r="14" fill="none" stroke="${c.fill}" stroke-width="1.5" opacity="0.5"/>` : '';
  const filterAttr = s ? 'filter="url(#glow)"' : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" style="position:absolute;top:0;left:0;">
    <defs>${glowFilter}</defs>
    <g ${filterAttr}>${inner}</g>${ring}
  </svg>`;

  let labelHtml = '';
  if (type === 'ONU') {
    if (rxPower !== null && typeof rxPower === 'number') {
      labelHtml = `<div style="position:absolute;top:28px;left:50%;transform:translateX(-50%);color:${c.fill};font-family:'Share Tech Mono',monospace;font-size:10px;font-weight:700;white-space:nowrap;text-shadow:0 0 3px #fff,0 0 3px #fff;pointer-events:none;">${rxPower.toFixed(2)} dBm</div>`;
    } else if (status === 'lost') {
      labelHtml = `<div style="position:absolute;top:28px;left:50%;transform:translateX(-50%);color:#ff0000;font-family:'Share Tech Mono',monospace;font-size:10px;font-weight:700;white-space:nowrap;text-shadow:0 0 3px #fff,0 0 3px #fff;pointer-events:none;">LOSS</div>`;
    }
  }

  const html = `<div style="position:relative; width:32px; height:32px;">${svg}${labelHtml}</div>`;

  return L.divIcon({
    html: html,
    className: status === 'lost' ? 'blink-red' : '',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -18]
  });
}

// ─── SIMULATION ──────────────────────────────────────────────────────────

function simulatePathToNode(nodeId) {
  const r = calcDbForNode(nodeId);
  if (r && r.error) return alert("ONU is unable to reach the OLT. Fix the connection first!");
  if (!r || !r._path) return;

  const path = r._path; // Array of {from, to, edge}
  if (path.length === 0) return; // shouldn't happen unless OLT is selected

  let stepIdx = 0;

  function triggerStep() {
    if (stepIdx === 0) {
      // Pulse OLT
      const olt = nodes.find(n => n.id === path[0].from);
      if (olt) {
        const svgEl = olt.marker.getElement()?.querySelector('svg');
        if (svgEl) {
          svgEl.style.transition = 'transform 0.15s ease, filter 0.15s ease';
          svgEl.style.transform = 'scale(1.4)';
          svgEl.style.filter = 'drop-shadow(0 0 16px #ff8800)';
          setTimeout(() => { if (svgEl) { svgEl.style.transform = ''; svgEl.style.filter = ''; } }, 400);
        }
      }
    }

    if (stepIdx >= path.length) return;

    const step = path[stepIdx];
    const fromNode = nodes.find(n => n.id === step.from);
    const toNode = nodes.find(n => n.id === step.to);
    if (!fromNode || !toNode) return;

    const dist = calcDistance(fromNode.lat, fromNode.lng, toNode.lat, toNode.lng);
    const duration = Math.min(Math.max(dist * 5000, 700), 3000); 
    const color = fromNode.type === 'SPLITTER' ? '#00ffaa' : '#0088cc';

    animateDot(L.latLng(fromNode.lat, fromNode.lng), L.latLng(toNode.lat, toNode.lng), duration, color, () => {
      // Pulse toNode
      if (toNode.type !== 'POLE') {
        const svgEl = toNode.marker.getElement()?.querySelector('svg');
        if (svgEl) {
          svgEl.style.transition = 'transform 0.15s ease, filter 0.15s ease';
          svgEl.style.transform = 'scale(1.4)';
          svgEl.style.filter = 'drop-shadow(0 0 12px #00ffaa)';
          setTimeout(() => {
            if (svgEl) {
              svgEl.style.transform = '';
              svgEl.style.filter = '';
            }
          }, 400);
        }
      }
      stepIdx++;
      triggerStep();
    }, true); // isCustom = true
  }

  triggerStep();
}


let isSimulating = false;
let simulationInterval = null;

function animateDot(fromLatLng, toLatLng, duration, color, onComplete, isCustom = false) {
  const dot = L.circleMarker(fromLatLng, { radius: 3, color: '#fff', fillColor: color, fillOpacity: 1, weight: 1.5, pane: 'popupPane' }).addTo(map);
  const start = performance.now();
  function step(timestamp) {
    if (!isCustom && !isSimulating) {
      dot.remove();
      return;
    }
    const progress = Math.min((timestamp - start) / duration, 1);
    const lat = fromLatLng.lat + (toLatLng.lat - fromLatLng.lat) * progress;
    const lng = fromLatLng.lng + (toLatLng.lng - fromLatLng.lng) * progress;
    dot.setLatLng([lat, lng]);
    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      dot.remove();
      if (onComplete) onComplete();
    }
  }
  requestAnimationFrame(step);
}

function toggleSimulation() {
  const btn = document.getElementById('btn-simulate');
  if (isSimulating) {
    isSimulating = false;
    if (simulationInterval) clearInterval(simulationInterval);
    if (btn) {
      btn.innerHTML = '▶ Simulate';
      btn.style.background = '';
    }
  } else {
    const olt = nodes.find(n => n.type === 'OLT');
    if (!olt) return alert('No OLT found to start simulation. Place an OLT first.');
    isSimulating = true;
    if (btn) {
      btn.innerHTML = '⏹ Stop Sim';
      btn.style.background = 'var(--red)';
    }
    spawnWave();
    // Launch a new wave every 4 seconds repeatedly
    simulationInterval = setInterval(spawnWave, 4000);
  }
}

function spawnWave() {
  if (!isSimulating) return;
  const olt = nodes.find(n => n.type === 'OLT');
  if (!olt) return toggleSimulation();

  // Build Adjacency List for simulation traversal
  const adj = {};
  edges.forEach(e => {
    if (!adj[e.from]) adj[e.from] = [];
    if (!adj[e.to]) adj[e.to] = [];
    adj[e.from].push(e);
    adj[e.to].push(e);
  });

  function triggerNode(nodeId, visitedEdges) {
    if (!isSimulating) return;
    const currNode = nodes.find(n => n.id === nodeId);
    // Pulse animation for Splitters and ONUs
    if (currNode && currNode.type !== 'OLT' && currNode.type !== 'POLE') {
      const el = currNode.marker.getElement();
      if (el) {
        const svgEl = el.querySelector('svg');
        if (svgEl) {
          svgEl.style.transition = 'transform 0.15s ease, filter 0.15s ease';
          svgEl.style.transform = 'scale(1.4)';
          svgEl.style.filter = 'drop-shadow(0 0 12px #00ffaa)';
          setTimeout(() => {
            if (svgEl) {
              svgEl.style.transform = '';
              svgEl.style.filter = '';
            }
          }, 400);
        }
      }
    }

    const branches = adj[nodeId] || [];
    branches.forEach(edge => {
      if (visitedEdges.has(edge.id)) return;
      
      const newVisited = new Set(visitedEdges);
      newVisited.add(edge.id);
      
      const targetId = edge.from === nodeId ? edge.to : edge.from;
      const targetNode = nodes.find(n => n.id === targetId);
      if (!targetNode) return;
      
      const fromLL = L.latLng(currNode.lat, currNode.lng);
      const toLL = L.latLng(targetNode.lat, targetNode.lng);
      
      // Calculate duration: base 5000ms per km, minimum 700ms per hop, max 3000ms
      const dist = calcDistance(currNode.lat, currNode.lng, targetNode.lat, targetNode.lng);
      const duration = Math.min(Math.max(dist * 5000, 700), 3000); 
      const color = currNode.type === 'SPLITTER' ? '#00ffaa' : '#0088cc';

      animateDot(fromLL, toLL, duration, color, () => {
        triggerNode(targetId, newVisited);
      });
    });
  }

  // Flash OLT to indicate start
  const el = olt.marker.getElement();
  if (el) {
    const svgEl = el.querySelector('svg');
    if (svgEl) {
      svgEl.style.transition = 'transform 0.15s ease, filter 0.15s ease';
      svgEl.style.transform = 'scale(1.4)';
      svgEl.style.filter = 'drop-shadow(0 0 16px #ff8800)';
      setTimeout(() => { if (svgEl) { svgEl.style.transform = ''; svgEl.style.filter = ''; } }, 400);
    }
  }
  
  // Start simulation wave
  triggerNode(olt.id, new Set());
}
