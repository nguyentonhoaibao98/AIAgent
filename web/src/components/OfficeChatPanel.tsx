import React, { useState } from "react";
import { BarChart3, MessageSquare, Send } from "lucide-react";
import type { ActivityEvent, AgentInfo, TestCase } from "@maestro-office/shared";

interface Props {
  agents: AgentInfo[];
  testCases: TestCase[];
  events: ActivityEvent[];
  onSendChat: (message: string, targetAgentId?: string | null) => Promise<void>;
  onSelectAgent: (agentId: string) => void;
}

export const OfficeChatPanel: React.FC<Props> = ({
  agents,
  testCases,
  events,
  onSendChat,
  onSelectAgent
}) => {
  const [text, setText] = useState("");
  const [targetAgent, setTargetAgent] = useState<string>("");

  const total = testCases.length;
  const passed = testCases.filter((t) => t.status === "passed").length;
  const failed = testCases.filter((t) => t.status === "failed").length;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;
  const totalRetries = testCases.reduce((sum, t) => sum + t.retryCount, 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    await onSendChat(text.trim(), targetAgent || null);
    setText("");
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      {/* Slack-style Office Chat (inspired by W17ant/Claude-Office) */}
      <div className="flex flex-col rounded-xl border border-slate-800 bg-slate-900/90 p-3.5 lg:col-span-7">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-sky-300">
            <MessageSquare className="h-3.5 w-3.5" />
            #maestro-qa-office — Live Agent Comms & Steering
          </div>
          <span className="font-mono text-[10px] text-slate-500">{events.length} messages</span>
        </div>

        <div className="max-h-48 flex-1 space-y-1.5 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 p-2.5 font-mono text-[11px]">
          {events.length === 0 ? (
            <div className="py-6 text-center text-slate-500">Chưa có tin nhắn nào trong văn phòng QA.</div>
          ) : (
            [...events].slice(-40).reverse().map((ev) => {
              const isUser = ev.agentId === "user";
              const badgeColor =
                ev.type === "test_passed"
                  ? "text-emerald-400"
                  : ev.type === "test_failed" || ev.type === "error"
                    ? "text-rose-400"
                    : ev.type === "handoff"
                      ? "text-amber-300"
                      : isUser
                        ? "text-fuchsia-300"
                        : "text-sky-400";

              return (
                <div key={ev.id} className="flex items-start gap-2 border-b border-slate-900/80 pb-1">
                  <span className="shrink-0 text-slate-500">{new Date(ev.timestamp).toLocaleTimeString()}</span>
                  <button
                    type="button"
                    onClick={() => ev.agentId && ev.agentId !== "user" && onSelectAgent(ev.agentId)}
                    className={`shrink-0 font-bold hover:underline ${badgeColor}`}
                  >
                    @{ev.agentId || "office"}
                  </button>
                  <span className="text-slate-200">{ev.message}</span>
                </div>
              );
            })
          )}
        </div>

        <form onSubmit={handleSubmit} className="mt-2.5 flex gap-2">
          <select
            value={targetAgent}
            onChange={(e) => setTargetAgent(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-xs text-slate-200"
          >
            <option value="">@all</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                @{a.shortName}
              </option>
            ))}
          </select>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Nhắn tin hoặc điều hướng agent (vd: Ưu tiên chạy lại TC-005 trên Pixel 9)..."
            className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none"
          />
          <button
            type="submit"
            className="inline-flex items-center gap-1 rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400"
          >
            <Send className="h-3.5 w-3.5" />
            Gửi
          </button>
        </form>
      </div>

      {/* QA Throughput & Analytics (inspired by glglak/agent-mission-control & WRAI.TH) */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-3.5 lg:col-span-5">
        <div className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold text-amber-300">
          <BarChart3 className="h-3.5 w-3.5" />
          QA Mission Analytics & Agent Leaderboard
        </div>

        <div className="grid grid-cols-4 gap-2 text-center">
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-2">
            <div className="text-base font-bold text-emerald-400">{passRate}%</div>
            <div className="text-[10px] text-slate-400">Pass Rate</div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-2">
            <div className="text-base font-bold text-white">{total}</div>
            <div className="text-[10px] text-slate-400">Flows</div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-2">
            <div className="text-base font-bold text-orange-400">{totalRetries}</div>
            <div className="text-[10px] text-slate-400">Self-Heals</div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-2">
            <div className="text-base font-bold text-rose-400">{failed}</div>
            <div className="text-[10px] text-slate-400">Failed</div>
          </div>
        </div>

        <div className="mt-3 space-y-1.5">
          {agents
            .filter((a) => a.role === "maestro_engineer")
            .slice(0, 5)
            .map((a) => {
              const barPct = Math.min(100, (a.stats.completed * 35) || (a.status !== "idle" ? 20 : 5));
              return (
                <div key={a.id} className="flex items-center gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={() => onSelectAgent(a.id)}
                    className="w-20 truncate text-left font-mono text-slate-300 hover:text-sky-300"
                  >
                    {a.shortName}
                  </button>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-400 transition-all"
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                  <span className="w-12 text-right font-mono text-[10px] text-slate-400">
                    {a.stats.completed} ok
                  </span>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
};
