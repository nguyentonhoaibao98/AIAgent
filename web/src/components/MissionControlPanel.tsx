import React, { useState } from "react";
import {
  CheckCircle2,
  ClipboardCopy,
  Cpu,
  FileCode2,
  ListChecks,
  RefreshCw,
  Settings as SettingsIcon,
  Smartphone,
  Terminal,
  XCircle
} from "lucide-react";
import type {
  ActivityEvent,
  AgentInfo,
  DeviceInfo,
  Mission,
  OfficeSettings,
  TestCase,
  TestCaseStatus
} from "@maestro-office/shared";

interface Props {
  mission: Mission | null;
  agents: AgentInfo[];
  testCases: TestCase[];
  devices: DeviceInfo[];
  events: ActivityEvent[];
  settings: OfficeSettings;
  liveLogs: Record<string, string>;
  onRefreshDevices: () => Promise<void>;
  onConnectTcpDevice: (hostPort: string) => Promise<{ ok: boolean; output: string }>;
  onSaveSettings: (patch: Partial<OfficeSettings> & { cursorApiKey?: string }) => Promise<void>;
}

type Tab = "kanban" | "devices" | "feed" | "settings";

const KANBAN_COLUMNS: Array<{ id: TestCaseStatus; label: string; badge: string }> = [
  { id: "manual_ready", label: "Manual Ready", badge: "bg-amber-500/20 text-amber-300" },
  { id: "writing_yaml", label: "Writing YAML", badge: "bg-sky-500/20 text-sky-300" },
  { id: "waiting_device", label: "Device Queue", badge: "bg-yellow-500/20 text-yellow-300" },
  { id: "testing", label: "Running Maestro", badge: "bg-emerald-500/20 text-emerald-300" },
  { id: "debugging", label: "Debugging", badge: "bg-orange-500/20 text-orange-300" },
  { id: "passed", label: "Passed", badge: "bg-green-500/20 text-green-300" },
  { id: "failed", label: "Failed", badge: "bg-rose-500/20 text-rose-300" }
];

export const MissionControlPanel: React.FC<Props> = ({
  mission,
  agents,
  testCases,
  devices,
  events,
  settings,
  liveLogs,
  onRefreshDevices,
  onConnectTcpDevice,
  onSaveSettings
}) => {
  const [tab, setTab] = useState<Tab>("kanban");
  const [selectedCase, setSelectedCase] = useState<TestCase | null>(null);
  const [tcpHost, setTcpHost] = useState("");
  const [tcpMsg, setTcpMsg] = useState("");
  const [copied, setCopied] = useState(false);

  // Settings form state
  const [adbPath, setAdbPath] = useState(settings.adbPath);
  const [maestroPath, setMaestroPath] = useState(settings.maestroPath);
  const [useWslMaestro, setUseWslMaestro] = useState(settings.useWslMaestro);
  const [cursorModel, setCursorModel] = useState(settings.cursorModel);
  const [maxConcurrency, setMaxConcurrency] = useState(settings.maxConcurrency);
  const [maxRetries, setMaxRetries] = useState(settings.maxRetries);
  const [cursorApiKey, setCursorApiKey] = useState("");
  const [savedNotice, setSavedNotice] = useState(false);

  const activeCase = selectedCase ? testCases.find((t) => t.id === selectedCase.id) ?? selectedCase : null;

  const cursorPrompt = mission
    ? `Thực hiện Maestro QA Mission "${mission.title}" (ID: ${mission.id}, appId: ${mission.appId}) sử dụng MCP server "maestro-qa-office":\n1. Gọi qa_get_mission để đọc đặc tả và đường dẫn repo (${mission.repoPath}).\n2. Đóng vai Agent 01 (qa-lead): phân tích app + đặc tả, gọi qa_submit_manual_cases để tạo danh sách Manual Test Cases và chia cho 9 agent (maestro-01..maestro-09).\n3. Spawn subagents cho 9 Maestro Engineers: mỗi agent gọi qa_claim_test_case, viết Maestro YAML vào ${mission.flowsDir}, lần lượt gọi qa_run_maestro để chạy thử trên thiết bị thật/hosted, tự debug nếu fail (tối đa ${settings.maxRetries} lần), rồi gọi qa_complete_test_case.`
    : "Hãy tạo 1 Mission ở chế độ Cursor MCP Mode trước, sau đó copy prompt này vào Cursor Chat.";

  const handleCopyPrompt = async () => {
    await navigator.clipboard.writeText(cursorPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleConnectTcp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tcpHost.trim()) return;
    const res = await onConnectTcpDevice(tcpHost.trim());
    setTcpMsg(res.output || (res.ok ? "Connected" : "Failed"));
    if (res.ok) setTcpHost("");
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSaveSettings({
      adbPath,
      maestroPath,
      useWslMaestro,
      cursorModel,
      maxConcurrency,
      maxRetries,
      ...(cursorApiKey.trim() ? { cursorApiKey: cursorApiKey.trim() } : {})
    });
    setCursorApiKey("");
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2000);
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/90 shadow-xl">
      {/* Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-2.5">
        <div className="flex items-center gap-1">
          <TabButton active={tab === "kanban"} onClick={() => setTab("kanban")} icon={<ListChecks className="h-3.5 w-3.5" />}>
            Kanban Pipeline ({testCases.length})
          </TabButton>
          <TabButton active={tab === "devices"} onClick={() => setTab("devices")} icon={<Smartphone className="h-3.5 w-3.5" />}>
            Device Lab ({devices.length})
          </TabButton>
          <TabButton active={tab === "feed"} onClick={() => setTab("feed")} icon={<Terminal className="h-3.5 w-3.5" />}>
            Cursor MCP & Live Feed
          </TabButton>
          <TabButton active={tab === "settings"} onClick={() => setTab("settings")} icon={<SettingsIcon className="h-3.5 w-3.5" />}>
            Settings
          </TabButton>
        </div>

        <button
          onClick={handleCopyPrompt}
          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/20"
        >
          <ClipboardCopy className="h-3.5 w-3.5" />
          {copied ? "Đã copy Cursor Prompt!" : "Copy Prompt cho Cursor Chat (MCP)"}
        </button>
      </div>

      {/* KANBAN TAB */}
      {tab === "kanban" && (
        <div className="p-4">
          {testCases.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-800 py-10 text-center text-sm text-slate-400">
              Chưa có Test Case nào. Bấm <span className="font-semibold text-emerald-400">Simulate 10 Agents</span> hoặc{" "}
              <span className="font-semibold text-sky-400">New Mission</span> để Agent 01 bắt đầu viết Manual Test Cases.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4 xl:grid-cols-7">
              {KANBAN_COLUMNS.map((col) => {
                const items = testCases.filter((tc) => tc.status === col.id);
                return (
                  <div key={col.id} className="flex min-h-[210px] flex-col rounded-lg border border-slate-800 bg-slate-950/70 p-2.5">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">{col.label}</span>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${col.badge}`}>{items.length}</span>
                    </div>
                    <div className="space-y-2 overflow-y-auto">
                      {items.map((tc) => {
                        const owner = agents.find((a) => a.id === tc.assignedAgentId);
                        return (
                          <button
                            key={tc.id}
                            onClick={() => setSelectedCase(tc)}
                            className="w-full rounded-lg border border-slate-800 bg-slate-900 p-2 text-left transition hover:border-sky-500/60"
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="font-mono text-[11px] font-bold text-sky-400">{tc.code}</span>
                              <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">{tc.priority}</span>
                            </div>
                            <p className="mt-1 line-clamp-2 text-xs font-medium text-slate-100">{tc.title}</p>
                            <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
                              <span>{owner?.shortName || "Unassigned"}</span>
                              {tc.retryCount > 0 && <span className="text-orange-400">retry #{tc.retryCount}</span>}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Selected Test Case Inspector */}
          {activeCase && (
            <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                <div>
                  <span className="font-mono text-xs font-bold text-sky-400">{activeCase.code}</span>
                  <h3 className="text-sm font-semibold text-white">{activeCase.title}</h3>
                  <p className="text-xs text-slate-400">
                    Module: {activeCase.module} · Agent: {activeCase.assignedAgentId || "—"} · Device:{" "}
                    {activeCase.deviceId || "—"}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedCase(null)}
                  className="rounded border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
                >
                  Đóng
                </button>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-3">
                {/* Manual Test Case */}
                <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
                  <div className="mb-2 text-xs font-semibold text-amber-300">Manual Test Case (Agent 01)</div>
                  <p className="text-[11px] text-slate-400">Preconditions: {activeCase.preconditions || "None"}</p>
                  <ol className="mt-2 list-inside list-decimal space-y-1 text-xs text-slate-200">
                    {activeCase.steps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                  <p className="mt-2 text-xs text-emerald-300">Expected: {activeCase.expectedResult}</p>
                </div>

                {/* Generated Maestro YAML */}
                <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-sky-300">
                    <FileCode2 className="h-3.5 w-3.5" />
                    Maestro YAML ({activeCase.yamlPath ? activeCase.yamlPath.split(/[\\/]/).pop() : "pending"})
                  </div>
                  <pre className="max-h-56 overflow-auto rounded bg-slate-950 p-2.5 font-mono text-[11px] text-sky-200">
                    {activeCase.yamlContent || "# Waiting for Maestro Engineer to write YAML..."}
                  </pre>
                </div>

                {/* Live Maestro Output & Screenshot */}
                <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-300">
                    <Terminal className="h-3.5 w-3.5" />
                    Maestro Execution Logs
                  </div>
                  <pre className="max-h-56 overflow-auto rounded bg-black p-2.5 font-mono text-[11px] text-slate-200">
                    {liveLogs[activeCase.id] || activeCase.lastLogs || "Chưa chạy trên thiết bị."}
                  </pre>
                  {activeCase.screenshotUrl && (
                    <a
                      href={activeCase.screenshotUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-block text-xs text-amber-300 underline"
                    >
                      Xem Failure Screenshot
                    </a>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* DEVICE LAB TAB */}
      {tab === "devices" && (
        <div className="space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-slate-300">
              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 ${settings.adbDetected ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"}`}>
                {settings.adbDetected ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                ADB {settings.adbDetected ? "OK" : "Chưa tìm thấy"}
              </span>
              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 ${settings.maestroDetected ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}>
                {settings.maestroDetected ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                Maestro {settings.maestroDetected ? "OK" : "Chưa tìm thấy"}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <form onSubmit={handleConnectTcp} className="flex items-center gap-1.5">
                <input
                  value={tcpHost}
                  onChange={(e) => setTcpHost(e.target.value)}
                  placeholder="ADB TCP host:port (vd 192.168.1.50:5555)"
                  className="w-64 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-white"
                />
                <button
                  type="submit"
                  className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
                >
                  Kết nối Hosted Device
                </button>
              </form>
              <button
                onClick={onRefreshDevices}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Quét ADB
              </button>
            </div>
          </div>

          {tcpMsg && <div className="rounded bg-slate-950 px-3 py-2 font-mono text-xs text-amber-300">{tcpMsg}</div>}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {devices.length === 0 ? (
              <div className="col-span-full rounded-lg border border-dashed border-slate-800 py-8 text-center text-xs text-slate-400">
                Chưa phát hiện thiết bị Android/Emulator nào qua ADB. Cắm cáp USB (bật USB Debugging), mở Android Emulator, hoặc nhập IP:Port thiết bị được host.
              </div>
            ) : (
              devices.map((dev) => (
                <div key={dev.id} className="rounded-lg border border-slate-800 bg-slate-950 p-3.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Smartphone className="h-4 w-4 text-emerald-400" />
                      <div>
                        <div className="text-sm font-semibold text-white">{dev.name}</div>
                        <div className="font-mono text-[11px] text-slate-400">
                          {dev.id} · {dev.connection.toUpperCase()}
                        </div>
                      </div>
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                        dev.lockedByAgentId
                          ? "bg-amber-500/20 text-amber-300"
                          : "bg-emerald-500/20 text-emerald-300"
                      }`}
                    >
                      {dev.lockedByAgentId ? "LOCKED" : "FREE"}
                    </span>
                  </div>

                  <div className="mt-3 space-y-1 text-xs">
                    <div className="text-slate-300">
                      Đang chạy: <span className="font-mono text-sky-300">{dev.lockedByAgentId || "Không có"}</span>
                    </div>
                    <div className="text-slate-400">
                      Hàng đợi (Turn-taking Queue): <span className="font-semibold text-white">{dev.queue.length}</span> agent đang chờ
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* CURSOR MCP & LIVE FEED TAB */}
      {tab === "feed" && (
        <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-3.5">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-300">
                <Cpu className="h-3.5 w-3.5" />
                Cursor MCP Prompt (Dán vào Cursor Chat để chạy 10 Agents)
              </div>
              <button
                onClick={handleCopyPrompt}
                className="rounded bg-amber-500/20 px-2.5 py-1 text-[11px] font-medium text-amber-200 hover:bg-amber-500/30"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <pre className="whitespace-pre-wrap rounded border border-slate-800 bg-slate-900 p-3 font-mono text-xs text-slate-200">
              {cursorPrompt}
            </pre>
            <p className="mt-2 text-[11px] text-slate-400">
              MCP server đã được cấu hình sẵn tại <code className="text-sky-300">.cursor/mcp.json</code> và rule tại{" "}
              <code className="text-sky-300">.cursor/rules/maestro-qa-team.mdc</code>.
            </p>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-950 p-3.5">
            <div className="mb-2 text-xs font-semibold text-emerald-300">Live Office Activity Feed</div>
            <div className="max-h-64 space-y-1.5 overflow-y-auto font-mono text-[11px]">
              {events.length === 0 ? (
                <div className="text-slate-500">Chưa có sự kiện nào.</div>
              ) : (
                [...events].reverse().map((ev) => (
                  <div key={ev.id} className="flex gap-2 border-b border-slate-900 pb-1">
                    <span className="shrink-0 text-slate-500">{new Date(ev.timestamp).toLocaleTimeString()}</span>
                    <span className="shrink-0 text-sky-400">[{ev.agentId || "system"}]</span>
                    <span className="text-slate-200">{ev.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* SETTINGS TAB */}
      {tab === "settings" && (
        <form onSubmit={handleSaveSettings} className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-slate-300">ADB Executable Path</label>
            <input
              value={adbPath}
              onChange={(e) => setAdbPath(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-300">Maestro CLI Path</label>
            <input
              value={maestroPath}
              onChange={(e) => setMaestroPath(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-300">Cursor SDK Model</label>
            <input
              value={cursorModel}
              onChange={(e) => setCursorModel(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-300">
              CURSOR_API_KEY (tùy chọn, cho Cursor SDK Auto Mode — {settings.hasCursorApiKey ? "Đã lưu" : "Chưa đặt"})
            </label>
            <input
              type="password"
              value={cursorApiKey}
              onChange={(e) => setCursorApiKey(e.target.value)}
              placeholder="cursor_..."
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-white"
            />
          </div>
          <div className="flex items-center gap-4">
            <div>
              <label className="mb-1 block text-xs text-slate-300">Số Maestro Agents song song (1–9)</label>
              <input
                type="number"
                min={1}
                max={9}
                value={maxConcurrency}
                onChange={(e) => setMaxConcurrency(Number(e.target.value))}
                className="w-24 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-300">Max Debug Retries</label>
              <input
                type="number"
                min={0}
                max={5}
                value={maxRetries}
                onChange={(e) => setMaxRetries(Number(e.target.value))}
                className="w-24 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 pt-4">
            <input
              id="wsl-maestro"
              type="checkbox"
              checked={useWslMaestro}
              onChange={(e) => setUseWslMaestro(e.target.checked)}
              className="h-4 w-4 rounded border-slate-700"
            />
            <label htmlFor="wsl-maestro" className="text-xs text-slate-300">
              Chạy Maestro thông qua WSL (`wsl maestro ...`) trên Windows
            </label>
          </div>
          <div className="md:col-span-2 flex items-center gap-3">
            <button
              type="submit"
              className="rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400"
            >
              Lưu cấu hình
            </button>
            {savedNotice && <span className="text-xs text-emerald-400">Đã lưu cài đặt!</span>}
          </div>
        </form>
      )}
    </div>
  );
};

const TabButton: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}> = ({ active, onClick, icon, children }) => (
  <button
    onClick={onClick}
    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
      active ? "bg-slate-800 text-white" : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
    }`}
  >
    {icon}
    {children}
  </button>
);
