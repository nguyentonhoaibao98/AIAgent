import React, { useEffect, useState } from "react";
import { AlertTriangle, Bot, Box, Grid2x2, History, Play, Plus, Radio, Square, Users, Volume2, VolumeX } from "lucide-react";
import { useOfficeSocket } from "./hooks/useOfficeSocket";
import { PixelOfficeCanvas } from "./canvas/PixelOfficeCanvas";
import { VoxelOffice3D } from "./canvas/VoxelOffice3D";
import { MissionControlPanel } from "./components/MissionControlPanel";
import { MissionLauncherModal } from "./components/MissionLauncherModal";
import { OfficeChatPanel } from "./components/OfficeChatPanel";
import { soundFx } from "./utils/soundFx";

export const App: React.FC = () => {
  const {
    snapshot,
    connected,
    beams,
    liveLogs,
    loadMission,
    startMission,
    stopMission,
    refreshDevices,
    connectTcpDevice,
    saveSettings,
    sendChatMessage
  } = useOfficeSocket();

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>("qa-lead");
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [viewMode, setViewMode] = useState<"3d" | "2d">("3d");

  const agents = snapshot?.agents ?? [];
  const devices = snapshot?.devices ?? [];
  const testCases = snapshot?.testCases ?? [];
  const mission = snapshot?.mission ?? null;
  const missions = snapshot?.missions ?? [];
  const events = snapshot?.events ?? [];
  const settings = snapshot?.settings ?? {
    adbPath: "adb",
    maestroPath: "maestro",
    useWslMaestro: false,
    cursorModel: "composer-2.5",
    maxConcurrency: 9,
    maxRetries: 3,
    hasCursorApiKey: false,
    adbDetected: false,
    maestroDetected: false
  };

  const alertAgents = agents.filter((a) => a.status === "debugging" || a.status === "error");

  // Keyboard shortcut 'N' to jump to the next agent needing attention (inspired by AgentSystemLabs/agent-office)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key.toLowerCase() === "n" && alertAgents.length > 0) {
        setSelectedAgentId(alertAgents[0].id);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [alertAgents]);

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    soundFx.enabled = next;
    if (next) soundFx.playHandoff();
  };

  const selectedAgent = agents.find((a) => a.id === selectedAgentId) ?? agents[0] ?? null;
  const selectedAgentCases = selectedAgent
    ? testCases.filter((tc) => tc.assignedAgentId === selectedAgent.id)
    : [];

  const passedCount = testCases.filter((t) => t.status === "passed").length;
  const activeCount = agents.filter((a) => !["idle", "done"].includes(a.status)).length;
  const isRunning = mission && (mission.status === "planning" || mission.status === "executing");

  const handleQuickSimulate = async () => {
    await startMission({
      title: "Maestro 10-Agent Live Demo",
      appId: "com.demo.shopapp",
      repoPath: ".",
      flowsDir: "./data/flows",
      specText:
        "Verify Login, Bottom Tab Navigation, Form Validation, Search & Filter, Checkout Flow, Profile Settings, Offline Banner, Deep Links, and Full Smoke Regression.",
      mode: "simulation"
    });
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1520px] flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-sky-500 text-slate-950 shadow-lg">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold tracking-tight text-white">Maestro 10-Agent Pixel Office</h1>
                <span className="rounded bg-sky-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-sky-300">
                  CURSOR HYBRID
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                1 QA Lead (Manual Spec) + 9 Maestro Engineers (Auto YAML · Device Queue · Verify & Debug)
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Mission History Switcher (inspired by AgentSystemLabs/agent-office & agent-mission-control) */}
            {missions.length > 0 && (
              <div className="hidden items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1 text-xs md:flex">
                <History className="h-3.5 w-3.5 text-slate-400" />
                <select
                  value={mission?.id || ""}
                  onChange={(e) => loadMission(e.target.value)}
                  className="max-w-44 bg-transparent text-xs text-slate-200 focus:outline-none"
                >
                  {missions.map((m) => (
                    <option key={m.id} value={m.id} className="bg-slate-900 text-slate-200">
                      {m.title} ({m.status})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="hidden items-center gap-3 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs lg:flex">
              <span className="flex items-center gap-1.5">
                <Radio className={`h-3.5 w-3.5 ${connected ? "text-emerald-400" : "text-rose-400"}`} />
                <span className="text-slate-300">{connected ? "Live WS" : "Reconnecting..."}</span>
              </span>
              <span className="text-slate-700">|</span>
              <span className="flex items-center gap-1 text-slate-300">
                <Users className="h-3.5 w-3.5 text-sky-400" />
                Active: <strong className="text-white">{activeCount}/10</strong>
              </span>
              <span className="text-slate-700">|</span>
              <span className="text-slate-300">
                Passed: <strong className="text-emerald-400">{passedCount}/{testCases.length}</strong>
              </span>
            </div>

            {/* 3D Voxel / 2D Pixel View Switcher */}
            <div className="inline-flex rounded-lg border border-slate-700 bg-slate-900 p-0.5 text-xs">
              <button
                onClick={() => setViewMode("3d")}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition ${
                  viewMode === "3d" ? "bg-sky-500 text-slate-950" : "text-slate-300 hover:text-white"
                }`}
              >
                <Box className="h-3.5 w-3.5" /> 3D Voxel
              </button>
              <button
                onClick={() => setViewMode("2d")}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition ${
                  viewMode === "2d" ? "bg-sky-500 text-slate-950" : "text-slate-300 hover:text-white"
                }`}
              >
                <Grid2x2 className="h-3.5 w-3.5" /> 2D Pixel
              </button>
            </div>

            {/* 8-bit Sound Toggle (inspired by pixel-agents) */}
            <button
              onClick={toggleSound}
              title={soundOn ? "Tắt âm thanh 8-bit" : "Bật âm thanh 8-bit"}
              className={`rounded-lg border px-2.5 py-1.5 text-xs transition ${
                soundOn
                  ? "border-sky-500/40 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20"
                  : "border-slate-700 bg-slate-900 text-slate-400 hover:text-white"
              }`}
            >
              {soundOn ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
            </button>

            <button
              onClick={handleQuickSimulate}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
            >
              <Play className="h-3.5 w-3.5" />
              Simulate 10 Agents
            </button>

            <button
              onClick={() => setLauncherOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400"
            >
              <Plus className="h-3.5 w-3.5" />
              New Mission
            </button>

            {isRunning && mission && (
              <button
                onClick={() => stopMission(mission.id)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/15 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/25"
              >
                <Square className="h-3 w-3" />
                Stop
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-[1520px] space-y-4 p-4">
        {/* Alert Banner when any agent is debugging / error (inspired by AgentSystemLabs/agent-office) */}
        {alertAgents.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-orange-500/40 bg-orange-500/10 px-4 py-2 text-xs text-orange-200">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 animate-pulse text-orange-400" />
              <span>
                <strong>{alertAgents.map((a) => a.shortName).join(", ")}</strong> đang tự debug / cần chú ý:{" "}
                <span className="font-mono text-orange-100">{alertAgents[0].speech}</span>
              </span>
            </div>
            <button
              onClick={() => setSelectedAgentId(alertAgents[0].id)}
              className="rounded-lg bg-orange-500/25 px-2.5 py-1 font-mono text-[11px] font-semibold text-orange-100 hover:bg-orange-500/35"
            >
              Nhảy tới Agent (Phím N)
            </button>
          </div>
        )}

        {/* Top Row: 3D Voxel / 2D Pixel Office + Agent Inspector */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <div className="xl:col-span-9">
            {viewMode === "3d" ? (
              <VoxelOffice3D
                agents={agents}
                devices={devices}
                testCases={testCases}
                beams={beams}
                selectedAgentId={selectedAgentId}
                onSelectAgent={setSelectedAgentId}
              />
            ) : (
              <PixelOfficeCanvas
                agents={agents}
                devices={devices}
                testCases={testCases}
                beams={beams}
                selectedAgentId={selectedAgentId}
                onSelectAgent={setSelectedAgentId}
              />
            )}
          </div>

          {/* Agent Inspector Sidebar */}
          <aside className="flex flex-col rounded-xl border border-slate-800 bg-slate-900/90 p-4 xl:col-span-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Agent Inspector (10 Crew)
              </span>
              {mission && (
                <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-amber-300">
                  {mission.mode}
                </span>
              )}
            </div>

            {/* Quick 10-agent switcher pills */}
            <div className="mt-2.5 flex flex-wrap gap-1">
              {agents.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setSelectedAgentId(a.id)}
                  className={`rounded px-2 py-1 font-mono text-[10px] transition ${
                    selectedAgent?.id === a.id
                      ? "bg-sky-500 font-bold text-slate-950"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  {a.shortName}
                </button>
              ))}
            </div>

            {selectedAgent && (
              <div className="mt-4 flex-1 space-y-3">
                <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold text-white">{selectedAgent.name}</h2>
                    <span className="rounded-full bg-slate-800 px-2 py-0.5 font-mono text-[10px] uppercase text-sky-300">
                      {selectedAgent.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">{selectedAgent.specialty}</p>
                  <div className="mt-2.5 rounded bg-slate-900 p-2 font-mono text-[11px] text-amber-200">
                    {selectedAgent.speech || "Standing by in the lounge..."}
                  </div>
                  <div className="mt-2.5 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded bg-slate-900 py-1.5">
                      <div className="text-xs font-bold text-emerald-400">{selectedAgent.stats.completed}</div>
                      <div className="text-[10px] text-slate-500">Passed</div>
                    </div>
                    <div className="rounded bg-slate-900 py-1.5">
                      <div className="text-xs font-bold text-orange-400">{selectedAgent.stats.retries}</div>
                      <div className="text-[10px] text-slate-500">Debugs</div>
                    </div>
                    <div className="rounded bg-slate-900 py-1.5">
                      <div className="text-xs font-bold text-rose-400">{selectedAgent.stats.failed}</div>
                      <div className="text-[10px] text-slate-500">Failed</div>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Assigned Flows ({selectedAgentCases.length})
                  </div>
                  <div className="max-h-48 space-y-1.5 overflow-y-auto">
                    {selectedAgentCases.length === 0 ? (
                      <div className="text-xs text-slate-500">
                        {selectedAgent.role === "qa_lead"
                          ? "Agent 01 phân tích app + đặc tả và chia Manual Testcase cho 9 engineer."
                          : "Chưa nhận test case nào."}
                      </div>
                    ) : (
                      selectedAgentCases.map((tc) => (
                        <div key={tc.id} className="rounded border border-slate-800 bg-slate-950 px-2.5 py-2 text-xs">
                          <div className="flex items-center justify-between">
                            <span className="font-mono font-bold text-sky-400">{tc.code}</span>
                            <span className="font-mono text-[10px] text-slate-400">{tc.status}</span>
                          </div>
                          <div className="mt-0.5 truncate text-slate-200">{tc.title}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </aside>
        </div>

        {/* Middle Row: Slack-Style Office Chat & QA Analytics */}
        <OfficeChatPanel
          agents={agents}
          testCases={testCases}
          events={events}
          onSendChat={sendChatMessage}
          onSelectAgent={setSelectedAgentId}
        />

        {/* Bottom Row: Mission Control Panel */}
        <MissionControlPanel
          mission={mission}
          agents={agents}
          testCases={testCases}
          devices={devices}
          events={events}
          settings={settings}
          liveLogs={liveLogs}
          onRefreshDevices={refreshDevices}
          onConnectTcpDevice={connectTcpDevice}
          onSaveSettings={saveSettings}
        />
      </main>

      <MissionLauncherModal
        open={launcherOpen}
        onClose={() => setLauncherOpen(false)}
        settings={settings}
        onSubmit={startMission}
      />
    </div>
  );
};

export default App;
