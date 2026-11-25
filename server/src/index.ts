import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import type { MissionMode, OfficeSettings, OfficeSnapshot } from "@maestro-office/shared";
import { OfficeDatabase } from "./db/database.js";
import { WsHub } from "./ws/hub.js";
import { DeviceManager } from "./devices/deviceManager.js";
import { MaestroRunner } from "./devices/maestroRunner.js";
import { MissionSimulator } from "./orchestrator/simulator.js";
import { CursorSdkOrchestrator } from "./orchestrator/sdkRunner.js";

const PORT = Number(process.env.PORT || 4800);
const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

const db = new OfficeDatabase();
const hub = new WsHub();
const deviceManager = new DeviceManager((devices) => {
  hub.broadcast({ type: "devices_update", payload: devices });
});
const maestroRunner = new MaestroRunner(deviceManager);
const simulator = new MissionSimulator(db, hub, deviceManager);
const sdkOrchestrator = new CursorSdkOrchestrator(db, hub, deviceManager, maestroRunner);

// Load persisted settings into DeviceManager
deviceManager.configure({
  adbPath: db.getSetting("adbPath") ?? undefined,
  maestroPath: db.getSetting("maestroPath") ?? undefined,
  useWslMaestro: db.getSetting("useWslMaestro") === "true"
});
deviceManager.startPolling(6000);

app.use("/artifacts", express.static(maestroRunner.getArtifactsDir()));

function getSettings(): OfficeSettings {
  const tools = deviceManager.getToolPaths();
  return {
    adbPath: db.getSetting("adbPath") ?? tools.adbPath,
    maestroPath: db.getSetting("maestroPath") ?? tools.maestroPath,
    useWslMaestro: db.getSetting("useWslMaestro") === "true",
    cursorModel: db.getSetting("cursorModel") ?? "composer-2.5",
    maxConcurrency: Number(db.getSetting("maxConcurrency") ?? "9"),
    maxRetries: Number(db.getSetting("maxRetries") ?? "3"),
    hasCursorApiKey: Boolean(db.getSetting("cursorApiKey") || process.env.CURSOR_API_KEY),
    adbDetected: tools.adbDetected,
    maestroDetected: tools.maestroDetected
  };
}

function buildSnapshot(missionId?: string): OfficeSnapshot {
  const mission = missionId ? db.getMission(missionId) : db.getLatestMission();
  return {
    mission,
    missions: db.listMissions(20),
    agents: db.listAgents(),
    testCases: mission ? db.listTestCases(mission.id) : [],
    devices: deviceManager.listDevices(),
    events: db.listEvents(mission?.id ?? null, 150),
    settings: getSettings()
  };
}

// --- Core Snapshot & Settings ---
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, port: PORT, simulatorRunning: simulator.isRunning(), sdkRunning: sdkOrchestrator.isRunning() });
});

app.get("/api/snapshot", (req, res) => {
  const missionId = typeof req.query.missionId === "string" ? req.query.missionId : undefined;
  res.json(buildSnapshot(missionId));
});

app.get("/api/settings", (_req, res) => {
  res.json(getSettings());
});

app.post("/api/settings", (req, res) => {
  const body = req.body ?? {};
  if (typeof body.adbPath === "string") db.setSetting("adbPath", body.adbPath);
  if (typeof body.maestroPath === "string") db.setSetting("maestroPath", body.maestroPath);
  if (typeof body.useWslMaestro === "boolean") db.setSetting("useWslMaestro", String(body.useWslMaestro));
  if (typeof body.cursorModel === "string") db.setSetting("cursorModel", body.cursorModel);
  if (typeof body.maxConcurrency === "number") db.setSetting("maxConcurrency", String(body.maxConcurrency));
  if (typeof body.maxRetries === "number") db.setSetting("maxRetries", String(body.maxRetries));
  if (typeof body.cursorApiKey === "string" && body.cursorApiKey.trim()) {
    db.setSetting("cursorApiKey", body.cursorApiKey.trim());
  }

  deviceManager.configure({
    adbPath: db.getSetting("adbPath") ?? undefined,
    maestroPath: db.getSetting("maestroPath") ?? undefined,
    useWslMaestro: db.getSetting("useWslMaestro") === "true"
  });
  deviceManager.refreshDevices().catch(() => {});

  res.json(getSettings());
});

// --- Devices ---
app.get("/api/devices", (_req, res) => {
  res.json(deviceManager.listDevices());
});

app.post("/api/devices/refresh", async (_req, res) => {
  const devices = await deviceManager.refreshDevices();
  res.json(devices);
});

app.post("/api/devices/connect", async (req, res) => {
  const hostPort = String(req.body?.hostPort || "").trim();
  if (!hostPort) {
    res.status(400).json({ ok: false, output: "hostPort is required (e.g. 192.168.1.50:5555)" });
    return;
  }
  const result = await deviceManager.connectTcpDevice(hostPort);
  res.json({ ...result, devices: deviceManager.listDevices() });
});

// --- Missions ---
app.post("/api/missions", (req, res) => {
  const body = req.body ?? {};
  const title = String(body.title || "Maestro QA Automation Mission").trim();
  const appId = String(body.appId || "com.demo.mobileapp").trim();
  const repoPath = String(body.repoPath || process.cwd()).trim();
  const flowsDir = String(body.flowsDir || path.join(repoPath, "maestro", "flows")).trim();
  const specText = String(body.specText || "Verify core user journeys: Login, Navigation, Search, Checkout, Profile.").trim();
  const mode = (["cursor_mcp", "cursor_sdk", "simulation"].includes(body.mode) ? body.mode : "simulation") as MissionMode;

  simulator.stop();
  sdkOrchestrator.stop();
  deviceManager.cancelWaitersForMission();

  const agents = db.resetAllAgents();
  for (const a of agents) hub.broadcast({ type: "agent_update", payload: a });

  const mission = db.createMission({ title, appId, repoPath, flowsDir, specText, mode });
  hub.broadcast({ type: "mission_update", payload: mission });

  const evt = db.addEvent({
    missionId: mission.id,
    agentId: null,
    type: "mission_started",
    message: `Mission "${mission.title}" started in ${mode} mode (appId: ${appId})`
  });
  hub.broadcast({ type: "event", payload: evt });

  if (mode === "simulation") {
    void simulator.run(mission);
  } else if (mode === "cursor_sdk") {
    const apiKey = db.getSetting("cursorApiKey") || process.env.CURSOR_API_KEY || "";
    const settings = getSettings();
    void sdkOrchestrator.run(mission, {
      apiKey,
      model: settings.cursorModel,
      maxConcurrency: settings.maxConcurrency,
      maxRetries: settings.maxRetries
    });
  } else {
    // cursor_mcp mode: highlight QA Lead waiting for Cursor IDE MCP call
    const lead = db.updateAgent("qa-lead", {
      status: "analyzing",
      zone: "planning",
      speech: "Ready for Cursor MCP orchestration!",
      lastTool: "mcp_ready"
    });
    if (lead) hub.broadcast({ type: "agent_update", payload: lead });
  }

  res.status(201).json({ mission, snapshot: buildSnapshot(mission.id) });
});

app.post("/api/missions/:id/stop", (req, res) => {
  simulator.stop();
  sdkOrchestrator.stop();
  deviceManager.cancelWaitersForMission();
  const mission = db.updateMission(req.params.id, { status: "stopped", summary: "Stopped by user." });
  if (mission) hub.broadcast({ type: "mission_update", payload: mission });
  const agents = db.resetAllAgents();
  for (const a of agents) hub.broadcast({ type: "agent_update", payload: a });
  res.json({ ok: true, mission });
});

// --- Office Chat / Human Steering ---
app.post("/api/chat", (req, res) => {
  const { message, targetAgentId } = req.body ?? {};
  const text = String(message || "").trim();
  if (!text) {
    res.status(400).json({ error: "message is required" });
    return;
  }
  const latest = db.getLatestMission();
  const evt = db.addEvent({
    missionId: latest?.id ?? null,
    agentId: "user",
    toAgentId: targetAgentId || null,
    type: "agent_status",
    message: targetAgentId ? `@${targetAgentId} ${text}` : text
  });
  hub.broadcast({ type: "event", payload: evt });

  if (targetAgentId) {
    const updated = db.updateAgent(String(targetAgentId), {
      speech: `Noted: ${text.slice(0, 28)}`
    });
    if (updated) hub.broadcast({ type: "agent_update", payload: updated });
  }
  res.json({ ok: true, event: evt });
});

// --- Agent Status Updates ---
app.post("/api/agents/:id/status", (req, res) => {
  const { status, zone, speech, lastTool, currentTaskId } = req.body ?? {};
  const updated = db.updateAgent(req.params.id, { status, zone, speech, lastTool, currentTaskId });
  if (!updated) {
    res.status(404).json({ error: `Agent ${req.params.id} not found` });
    return;
  }
  hub.broadcast({ type: "agent_update", payload: updated });
  const latest = db.getLatestMission();
  const evt = db.addEvent({
    missionId: latest?.id ?? null,
    agentId: updated.id,
    type: "agent_status",
    message: `${updated.shortName}: ${updated.speech || updated.status}`
  });
  hub.broadcast({ type: "event", payload: evt });
  res.json(updated);
});

// --- MCP Bridge Endpoints (called by mcp/src/index.ts from Cursor IDE) ---
app.post("/api/mcp/manual-cases", (req, res) => {
  const { missionId, cases } = req.body ?? {};
  const mission = missionId ? db.getMission(missionId) : db.getLatestMission();
  if (!mission) {
    res.status(400).json({ error: "No active mission found. Create a mission in the web UI first." });
    return;
  }
  if (!Array.isArray(cases) || cases.length === 0) {
    res.status(400).json({ error: "cases must be a non-empty array" });
    return;
  }

  const created = db.createTestCases(
    mission.id,
    cases.map((c: Record<string, unknown>, idx: number) => ({
      title: String(c.title || `Test Case ${idx + 1}`),
      module: String(c.module || "General"),
      priority: (["P0", "P1", "P2"].includes(String(c.priority)) ? c.priority : "P1") as "P0" | "P1" | "P2",
      preconditions: String(c.preconditions || ""),
      steps: Array.isArray(c.steps) ? c.steps.map(String) : [],
      expectedResult: String(c.expectedResult || ""),
      assignedAgentId: c.assignedAgentId ? String(c.assignedAgentId) : `maestro-0${(idx % 9) + 1}`
    }))
  );

  for (const tc of created) {
    hub.broadcast({ type: "test_case_update", payload: tc });
    if (tc.assignedAgentId) {
      hub.broadcast({
        type: "handoff",
        payload: { fromAgentId: "qa-lead", toAgentId: tc.assignedAgentId, label: tc.code }
      });
    }
  }

  const lead = db.updateAgent("qa-lead", {
    status: "done",
    zone: "lounge",
    speech: `Dispatched ${created.length} manual test cases`,
    lastTool: "qa_submit_manual_cases"
  });
  if (lead) hub.broadcast({ type: "agent_update", payload: lead });

  const updatedMission = db.updateMission(mission.id, { status: "executing" });
  if (updatedMission) hub.broadcast({ type: "mission_update", payload: updatedMission });

  const evt = db.addEvent({
    missionId: mission.id,
    agentId: "qa-lead",
    type: "manual_cases_created",
    message: `QA Lead published ${created.length} manual test cases via Cursor MCP.`
  });
  hub.broadcast({ type: "event", payload: evt });

  res.json({ missionId: mission.id, created });
});

app.post("/api/mcp/claim-case", (req, res) => {
  const { agentId, missionId } = req.body ?? {};
  const mission = missionId ? db.getMission(missionId) : db.getLatestMission();
  if (!mission || !agentId) {
    res.status(400).json({ error: "agentId and active mission are required" });
    return;
  }

  const claimed = db.claimNextTestCase(mission.id, String(agentId));
  if (!claimed) {
    res.json({ testCase: null, message: "No more manual_ready test cases available." });
    return;
  }

  hub.broadcast({ type: "test_case_update", payload: claimed });
  const agent = db.updateAgent(String(agentId), {
    status: "writing",
    zone: "automation",
    currentTaskId: claimed.id,
    speech: `Writing ${claimed.code}.yaml`,
    lastTool: "qa_claim_test_case"
  });
  if (agent) hub.broadcast({ type: "agent_update", payload: agent });

  res.json({ testCase: claimed, mission });
});

app.post("/api/mcp/run-maestro", async (req, res) => {
  const { agentId, testCaseId, flowPath, yamlContent, deviceId } = req.body ?? {};
  if (!agentId || !testCaseId || !flowPath) {
    res.status(400).json({ error: "agentId, testCaseId, and flowPath are required" });
    return;
  }

  if (typeof yamlContent === "string" && yamlContent.trim()) {
    fs.mkdirSync(path.dirname(flowPath), { recursive: true });
    fs.writeFileSync(flowPath, yamlContent, "utf8");
  }

  const savedYaml = fs.existsSync(flowPath) ? fs.readFileSync(flowPath, "utf8") : yamlContent || "";
  const tcQueued = db.updateTestCase(testCaseId, {
    status: "waiting_device",
    yamlPath: flowPath,
    yamlContent: savedYaml
  });
  if (tcQueued) hub.broadcast({ type: "test_case_update", payload: tcQueued });

  const waitingAgent = db.updateAgent(agentId, {
    status: "waiting_device",
    zone: "device_lab",
    currentTaskId: testCaseId,
    speech: `Waiting for device lock...`,
    lastTool: "qa_run_maestro"
  });
  if (waitingAgent) hub.broadcast({ type: "agent_update", payload: waitingAgent });

  // Refresh devices first; if none connected, return clear guidance
  const currentDevices = await deviceManager.refreshDevices();
  if (currentDevices.length === 0) {
    res.status(409).json({
      error: "No ADB/hosted devices connected. Plug in an Android device/emulator or connect via ADB TCP in the Device Lab."
    });
    return;
  }

  const lock = await deviceManager.acquireLock(agentId, testCaseId, deviceId);
  const latest = db.getLatestMission();

  try {
    const testingAgent = db.updateAgent(agentId, {
      status: "testing",
      zone: "device_lab",
      speech: `maestro test (${lock.deviceId})`,
      lastTool: "maestro_test"
    });
    if (testingAgent) hub.broadcast({ type: "agent_update", payload: testingAgent });

    const tcTesting = db.updateTestCase(testCaseId, { status: "testing", deviceId: lock.deviceId });
    if (tcTesting) hub.broadcast({ type: "test_case_update", payload: tcTesting });

    const result = await maestroRunner.runFlow({
      flowPath,
      deviceId: lock.deviceId,
      testCaseId,
      onChunk: (chunk) => {
        hub.broadcast({
          type: "maestro_output",
          payload: { testCaseId, agentId, deviceId: lock.deviceId, chunk }
        });
      }
    });

    const tcAfter = db.updateTestCase(testCaseId, {
      status: result.passed ? "passed" : "debugging",
      lastError: result.passed ? null : `Exit code ${result.exitCode}`,
      lastLogs: result.logs,
      screenshotUrl: result.screenshotUrl,
      retryCount: result.passed ? undefined : (tcTesting?.retryCount ?? 0) + 1
    });
    if (tcAfter) hub.broadcast({ type: "test_case_update", payload: tcAfter });

    const afterAgent = db.updateAgent(agentId, {
      status: result.passed ? "done" : "debugging",
      zone: result.passed ? "lounge" : "automation",
      speech: result.passed ? `Verified on ${lock.deviceId}!` : `Debugging failure...`,
      incCompleted: result.passed ? 1 : 0,
      incRetries: result.passed ? 0 : 1
    });
    if (afterAgent) hub.broadcast({ type: "agent_update", payload: afterAgent });

    const evt = db.addEvent({
      missionId: latest?.id ?? null,
      agentId,
      type: result.passed ? "test_passed" : "test_failed",
      message: `${testCaseId} ${result.passed ? "PASSED" : "FAILED"} on ${lock.deviceId}`,
      testCaseId,
      deviceId: lock.deviceId
    });
    hub.broadcast({ type: "event", payload: evt });

    res.json({ deviceId: lock.deviceId, ...result });
  } finally {
    lock.release();
  }
});

app.post("/api/mcp/complete-case", (req, res) => {
  const { agentId, testCaseId, status, summary } = req.body ?? {};
  if (!agentId || !testCaseId || !["passed", "failed"].includes(status)) {
    res.status(400).json({ error: "agentId, testCaseId, and status ('passed'|'failed') are required" });
    return;
  }

  const tc = db.updateTestCase(testCaseId, {
    status,
    lastError: status === "failed" ? summary || "Marked failed" : null
  });
  if (tc) hub.broadcast({ type: "test_case_update", payload: tc });

  const agent = db.updateAgent(agentId, {
    status: "done",
    zone: "lounge",
    currentTaskId: null,
    speech: summary || `${tc?.code || testCaseId} ${status}`,
    incFailed: status === "failed" ? 1 : 0
  });
  if (agent) hub.broadcast({ type: "agent_update", payload: agent });

  // Check if entire mission is now complete
  if (tc) {
    const all = db.listTestCases(tc.missionId);
    const done = all.every((c) => c.status === "passed" || c.status === "failed");
    if (done && all.length > 0) {
      const passedCount = all.filter((c) => c.status === "passed").length;
      const m = db.updateMission(tc.missionId, {
        status: "completed",
        summary: `Completed: ${passedCount}/${all.length} tests passed.`
      });
      if (m) hub.broadcast({ type: "mission_update", payload: m });
    }
  }

  res.json({ testCase: tc, agent });
});

const httpServer = http.createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
hub.attach(wss, (ws) => {
  hub.send(ws, { type: "snapshot", payload: buildSnapshot() });
});

httpServer.listen(PORT, () => {
  console.log(`[Maestro Agent Office] Server running on http://localhost:${PORT}`);
});
