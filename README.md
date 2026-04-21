# FTTH Fiber Optic Network Planner

A professional web-based FTTH (Fiber to the Home) network planning tool with Google Maps integration, real-time dB loss calculation, and full topology management.

## Features

- 🗺️ **Google Maps integration** with dark map style
- 🏗️ **FTTH topology**: OLT (root) → Splitters → ONU/ONT endpoints
- 🔌 **Draw fiber connections** between network nodes
- 📊 **Real-time dB budget analysis** with full loss breakdown:
  - Fiber attenuation (configurable: 0.20–0.40 dB/km)
  - Optical splitter insertion loss (1:2 to 1:64)
  - Connector loss per span
- 🎨 **Color-coded ONU status**: Green (OK) / Yellow (Marginal) / Red (Fail)
- 💾 **Save/load** network to server memory
- ⌨️ **Keyboard shortcuts**

## Quick Start

```bash
# Install dependencies
npm install

# Start server
npm start
```

Open http://localhost:3000 in your browser.

You'll be prompted to enter your **Google Maps JavaScript API key**.

## Getting a Google Maps API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create or select a project
3. Enable **Maps JavaScript API** and **Geometry library**
4. Create credentials → API Key
5. (Optional) Restrict the key to your domain

## Network Components

| Component | Description | Loss |
|-----------|-------------|------|
| **OLT** | Optical Line Terminal — root node, TX power configurable | Source |
| **Splitter 1:2** | Optical splitter, 2 outputs | 3.7 dB |
| **Splitter 1:4** | Optical splitter, 4 outputs | 7.2 dB |
| **Splitter 1:8** | Optical splitter, 8 outputs | 10.5 dB |
| **Splitter 1:16** | Optical splitter, 16 outputs | 13.8 dB |
| **Splitter 1:32** | Optical splitter, 32 outputs | 17.1 dB |
| **ONU/ONT** | Customer endpoint device | Endpoint |

## dB Budget Formula

```
RX Power = OLT_TX - Σ(fiber_loss) - Σ(splitter_loss) - Σ(connector_loss)

Where:
  fiber_loss     = distance_km × attenuation_dB_per_km
  connector_loss = 2 × 0.5 dB (per span)
  splitter_loss  = per splitter ratio table
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| S | Select tool |
| O | OLT tool |
| P | Splitter tool |
| U | ONU tool |
| F | Fiber draw tool |
| Del | Delete selected |
| Esc | Cancel / Select tool |

## Default Settings

| Parameter | Default |
|-----------|---------|
| OLT TX Power | +7 dBm |
| Fiber Attenuation | 0.35 dB/km (SM 1310nm) |
| Connector Loss | 0.5 dB |
| Min RX Power (ONU) | −27 dBm |
