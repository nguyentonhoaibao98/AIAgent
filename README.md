# Maestro 10-Agent 3D Voxel Office & Cursor Orchestrator

A local-first multi-agent QA automation studio featuring a **3D Voxel Office (Three.js)** and **2D Pixel Office** for orchestrating a 10-agent Maestro mobile testing team connected to **Cursor** (via both MCP Server and `@cursor/sdk`).

## 10-Agent QA Team Architecture

- **Agent 01 (`qa-lead`)**: Inspects the target mobile app repository and specification to generate structured Manual Test Cases.
- **Agents 02–10 (`maestro-01` .. `maestro-09`)**: Specialized Maestro Automation Engineers (Auth, Navigation, Forms, Search, Checkout, Profile, Edge Cases, Deep Links, Regression) who write `.yaml` flows, take turns acquiring **Device Lab Mutex Locks** on connected/hosted ADB devices, run `maestro test`, verify assertions, and self-debug failures.

## Features

- **3D Voxel Office & 2D Pixel Toggle**: Four themed rooms (*Planning Room*, *Automation Wing*, *Device Lab*, *Coffee Lounge*), corridor pathfinding, 3D handoff arcs, alert beacons (`N` shortcut), orbit camera presets, and procedural 8-bit Web Audio sound effects.
- **Hybrid Cursor Integration**:
  - **Cursor MCP Mode** (zero extra API key): Built-in MCP server (`.cursor/mcp.json` + `.cursor/rules/maestro-qa-team.mdc`) for orchestrating directly from Cursor Chat.
  - **Cursor SDK Auto Mode**: Autonomous execution via `@cursor/sdk` using your own `CURSOR_API_KEY` (stored locally in SQLite or env var, never committed).
  - **Demo Simulation Mode**: Built-in 10-agent dry-run simulator.
- **Device Lab & Turn-Taking Queue**: Auto-detects `adb` and `maestro` (plus configurable paths and ADB over Wi-Fi/TCP), serializing device runs per physical/hosted device so agents never collide.
- **Mission Control**: Kanban pipeline, YAML & Maestro log viewer, Slack-style `#maestro-qa-office` steering chat, mission history switcher, and QA analytics.

## Quick Start

Requirements: **Node.js 22+ / 24+** (uses built-in `node:sqlite`), **ADB**, and **Maestro CLI** for real device runs.

```bash
npm install
npm run build
npm run dev
```

Open `http://localhost:5173` in your browser (backend API/WebSocket runs on `http://localhost:4800`).

### Optional: Cursor SDK Mode
Set `CURSOR_API_KEY` in your environment (or enter it in the **Settings** tab — saved locally in `data/maestro-office.db`, which is gitignored):

```bash
export CURSOR_API_KEY="your_cursor_api_key"
```
