import React, { useState } from "react";
import { Play, Sparkles, Terminal, X } from "lucide-react";
import type { MissionMode, OfficeSettings } from "@maestro-office/shared";

interface Props {
  open: boolean;
  onClose: () => void;
  settings: OfficeSettings;
  onSubmit: (input: {
    title: string;
    appId: string;
    repoPath: string;
    flowsDir: string;
    specText: string;
    mode: MissionMode;
  }) => Promise<void>;
}

const SAMPLE_SPEC = `# Mobile E-Commerce App Specification
1. Auth & Onboarding: Email/password sign-in, invalid email validation, sign-out flow.
2. Navigation: Bottom tabs (Home, Explore, Cart, Profile) must switch cleanly.
3. Search & Filter: Search bar for products ("Sneakers"), filter sheet ("Under $100").
4. Checkout: Add product to cart, open cart, confirm order, verify Order Confirmed screen.
5. Profile & Settings: Edit display name, toggle dark mode.
6. Edge Cases & Deep Links: Offline retry banner, deep link myapp://product/42.`;

export const MissionLauncherModal: React.FC<Props> = ({ open, onClose, settings, onSubmit }) => {
  const [title, setTitle] = useState("Maestro E2E Regression Suite");
  const [appId, setAppId] = useState("com.demo.shopapp");
  const [repoPath, setRepoPath] = useState(".");
  const [flowsDir, setFlowsDir] = useState("./data/flows");
  const [specText, setSpecText] = useState(SAMPLE_SPEC);
  const [mode, setMode] = useState<MissionMode>("simulation");
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const handleLaunch = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onSubmit({ title, appId, repoPath, flowsDir, specText, mode });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
      <div className="w-full max-w-2xl rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
          <h2 className="text-base font-semibold text-white">Giao Mission cho 10 Maestro AI Agents</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleLaunch} className="space-y-4 p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">Tên Mission</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">Mobile App ID (Android/iOS)</label>
              <input
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
                required
                placeholder="com.company.app"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-white focus:border-sky-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">Đường dẫn Source App (Repo Path)</label>
              <input
                value={repoPath}
                onChange={(e) => setRepoPath(e.target.value)}
                required
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-white focus:border-sky-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">Thư mục xuất Maestro Flows (.yaml)</label>
              <input
                value={flowsDir}
                onChange={(e) => setFlowsDir(e.target.value)}
                required
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-white focus:border-sky-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-300">Chế độ kết nối Cursor & Thực thi</label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => setMode("cursor_mcp")}
                className={`rounded-lg border p-3 text-left transition ${
                  mode === "cursor_mcp"
                    ? "border-amber-400 bg-amber-500/10 text-white"
                    : "border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-600"
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  <Terminal className="h-3.5 w-3.5 text-amber-400" />
                  Cursor MCP Mode
                </div>
                <p className="mt-1 text-[11px] text-slate-400">Dùng trực tiếp gói Cursor IDE qua MCP (không cần API key).</p>
              </button>

              <button
                type="button"
                onClick={() => setMode("cursor_sdk")}
                className={`rounded-lg border p-3 text-left transition ${
                  mode === "cursor_sdk"
                    ? "border-sky-400 bg-sky-500/10 text-white"
                    : "border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-600"
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  <Sparkles className="h-3.5 w-3.5 text-sky-400" />
                  Cursor SDK Auto
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  Tự spawn 10 agent qua @cursor/sdk ({settings.hasCursorApiKey ? "API Key OK" : "cần CURSOR_API_KEY"}).
                </p>
              </button>

              <button
                type="button"
                onClick={() => setMode("simulation")}
                className={`rounded-lg border p-3 text-left transition ${
                  mode === "simulation"
                    ? "border-emerald-400 bg-emerald-500/10 text-white"
                    : "border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-600"
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  <Play className="h-3.5 w-3.5 text-emerald-400" />
                  Demo Simulation
                </div>
                <p className="mt-1 text-[11px] text-slate-400">Mô phỏng trực tiếp 1 → 9 agents, device lock & debug loop.</p>
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300">Đặc tả App (App Specification)</label>
            <textarea
              value={specText}
              onChange={(e) => setSpecText(e.target.value)}
              rows={6}
              required
              className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
            >
              {busy ? "Đang khởi chạy..." : "Khởi chạy 10 AI Agents"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
