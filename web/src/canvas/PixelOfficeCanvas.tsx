import React, { useEffect, useRef, useState } from "react";
import { ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import type { AgentInfo, DeviceInfo, HandoffBeam, OfficeZone, TestCase } from "@maestro-office/shared";

interface Props {
  agents: AgentInfo[];
  devices: DeviceInfo[];
  testCases: TestCase[];
  beams: HandoffBeam[];
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
}

interface Vec2 {
  x: number;
  y: number;
}

interface AgentMotion {
  x: number;
  y: number;
  zone: OfficeZone;
  waypoints: Vec2[];
}

const W = 960;
const H = 500;

// Central corridor intersection for clean doorway pathfinding (inspired by pixel-agents / agentroom)
const CORRIDOR_HUB: Vec2 = { x: 308, y: 318 };
const DOORWAYS: Record<OfficeZone, Vec2> = {
  planning: { x: 280, y: 292 },
  automation: { x: 342, y: 292 },
  device_lab: { x: 280, y: 344 },
  lounge: { x: 500, y: 344 }
};

const PLANNING_DESK: Vec2 = { x: 150, y: 165 };

const AUTOMATION_DESKS: Vec2[] = [
  { x: 420, y: 105 },
  { x: 590, y: 105 },
  { x: 760, y: 105 },
  { x: 420, y: 192 },
  { x: 590, y: 192 },
  { x: 760, y: 192 },
  { x: 420, y: 278 },
  { x: 590, y: 278 },
  { x: 760, y: 278 }
];

const DEVICE_SLOTS: Vec2[] = [
  { x: 100, y: 406 },
  { x: 215, y: 406 },
  { x: 330, y: 406 }
];

const DEVICE_QUEUE_SPOTS: Vec2[] = [
  { x: 80, y: 462 },
  { x: 140, y: 462 },
  { x: 200, y: 462 },
  { x: 260, y: 462 },
  { x: 320, y: 462 },
  { x: 380, y: 462 }
];

const LOUNGE_SPOTS: Vec2[] = [
  { x: 525, y: 414 },
  { x: 590, y: 414 },
  { x: 655, y: 414 },
  { x: 720, y: 414 },
  { x: 785, y: 414 },
  { x: 848, y: 414 },
  { x: 555, y: 462 },
  { x: 640, y: 462 },
  { x: 725, y: 462 },
  { x: 810, y: 462 }
];

function getTargetPos(agent: AgentInfo, devices: DeviceInfo[], allAgents: AgentInfo[]): Vec2 {
  if (agent.zone === "planning") return PLANNING_DESK;
  if (agent.zone === "automation") {
    const idx = Math.max(0, Math.min(8, agent.deskIndex - 1));
    return AUTOMATION_DESKS[idx];
  }
  if (agent.zone === "device_lab") {
    const lockedIdx = devices.findIndex((d) => d.lockedByAgentId === agent.id);
    if (lockedIdx >= 0) {
      return DEVICE_SLOTS[lockedIdx % DEVICE_SLOTS.length];
    }
    const waitingList = allAgents.filter((a) => a.status === "waiting_device");
    const qIdx = Math.max(0, waitingList.findIndex((a) => a.id === agent.id));
    return DEVICE_QUEUE_SPOTS[qIdx % DEVICE_QUEUE_SPOTS.length];
  }
  return LOUNGE_SPOTS[agent.deskIndex % LOUNGE_SPOTS.length];
}

function statusMonitorColor(status: AgentInfo["status"]): string {
  switch (status) {
    case "analyzing":
    case "handoff":
      return "#f59e0b";
    case "writing":
      return "#38bdf8";
    case "testing":
      return "#22c55e";
    case "debugging":
      return "#f97316";
    case "waiting_device":
      return "#eab308";
    case "error":
      return "#ef4444";
    case "done":
      return "#10b981";
    default:
      return "#334155";
  }
}

export const PixelOfficeCanvas: React.FC<Props> = ({
  agents,
  devices,
  testCases,
  beams,
  selectedAgentId,
  onSelectAgent
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const motionRef = useRef<Record<string, AgentMotion>>({});
  const stateRef = useRef({ agents, devices, testCases, beams, selectedAgentId });
  stateRef.current = { agents, devices, testCases, beams, selectedAgentId };

  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    let rafId = 0;
    const render = (time: number) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        rafId = requestAnimationFrame(render);
        return;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const {
        agents: curAgents,
        devices: curDevices,
        testCases: curCases,
        beams: curBeams,
        selectedAgentId: selId
      } = stateRef.current;

      ctx.imageSmoothingEnabled = false;

      // Outer corridor floor
      ctx.fillStyle = "#090e1a";
      ctx.fillRect(0, 0, W, H);

      // Subtle floor tiles
      ctx.strokeStyle = "rgba(148, 163, 184, 0.05)";
      ctx.lineWidth = 1;
      for (let x = 0; x < W; x += 24) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
      }
      for (let y = 0; y < H; y += 24) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }

      // --- 4 THEMED ROOMS WITH DOORWAYS ---
      drawRoom(ctx, 16, 16, 285, 295, "SPEC & PLANNING ROOM (AGENT 01)", "#1b263b", "#f59e0b");
      drawRoom(ctx, 315, 16, 629, 295, "MAESTRO AUTOMATION WING (9 ENGINEERS)", "#151f32", "#38bdf8");
      drawRoom(ctx, 16, 325, 445, 159, "DEVICE LAB (TURN-TAKING ADB / MAESTRO QUEUE)", "#11222a", "#22c55e");
      drawRoom(ctx, 475, 325, 469, 159, "COFFEE LOUNGE (IDLE / DONE)", "#1d192c", "#a78bfa");

      // Doorway mats (visual cues for corridor pathfinding)
      ctx.fillStyle = "#334155";
      ctx.fillRect(262, 308, 36, 6);
      ctx.fillRect(326, 308, 36, 6);
      ctx.fillRect(262, 322, 36, 6);
      ctx.fillRect(486, 322, 36, 6);

      // --- DECORATIONS (inspired by Star-Office-UI & pixel-agents) ---
      drawPixelPlant(ctx, 34, 276);
      drawPixelPlant(ctx, 916, 46);
      drawPixelPlant(ctx, 916, 278);
      drawPixelPlant(ctx, 492, 456);
      drawBookshelf(ctx, 188, 46);
      drawServerRack(ctx, 412, 355, time);

      // --- PLANNING ROOM WHITEBOARD & LEAD DESK ---
      ctx.fillStyle = "#e2e8f0";
      ctx.fillRect(38, 46, 134, 48);
      ctx.strokeStyle = "#64748b";
      ctx.lineWidth = 2;
      ctx.strokeRect(38, 46, 134, 48);
      ctx.fillStyle = "#0284c7";
      ctx.fillRect(46, 54, 42, 6);
      ctx.fillStyle = "#f59e0b";
      ctx.fillRect(46, 66, 78, 5);
      ctx.fillStyle = "#10b981";
      ctx.fillRect(46, 76, 60, 5);
      ctx.fillStyle = "#f43f5e";
      ctx.fillRect(114, 76, 44, 5);

      const leadAgent = curAgents.find((a) => a.id === "qa-lead");
      drawChair(ctx, PLANNING_DESK.x, PLANNING_DESK.y + 4);
      drawDesk(
        ctx,
        PLANNING_DESK.x,
        PLANNING_DESK.y - 22,
        leadAgent ? statusMonitorColor(leadAgent.status) : "#334155",
        true,
        time
      );

      // --- 9 AUTOMATION DESKS + CHAIRS ---
      AUTOMATION_DESKS.forEach((pos, i) => {
        const eng = curAgents.find((a) => a.deskIndex === i + 1);
        const col = eng && eng.zone === "automation" ? statusMonitorColor(eng.status) : "#1e293b";
        drawChair(ctx, pos.x, pos.y + 4);
        drawDesk(ctx, pos.x, pos.y - 20, col, false, time);
      });

      // --- DEVICE LAB PHONE RACKS ---
      const visibleDevices = curDevices.length > 0 ? curDevices.slice(0, 3) : [];
      if (visibleDevices.length === 0) {
        ctx.fillStyle = "#64748b";
        ctx.font = "11px monospace";
        ctx.fillText("No USB/TCP device connected — plug in Android or run Demo Simulation", 30, 395);
      } else {
        visibleDevices.forEach((dev, idx) => {
          const slot = DEVICE_SLOTS[idx];
          const isBusy = Boolean(dev.lockedByAgentId);
          ctx.fillStyle = "#0f172a";
          ctx.fillRect(slot.x - 42, slot.y - 44, 84, 46);
          ctx.strokeStyle = isBusy ? "#22c55e" : "#475569";
          ctx.lineWidth = 2;
          ctx.strokeRect(slot.x - 42, slot.y - 44, 84, 46);

          // Mini phone screen
          ctx.fillStyle = isBusy ? "#14532d" : "#1e293b";
          ctx.fillRect(slot.x - 10, slot.y - 40, 20, 34);
          if (isBusy) {
            const pulse = Math.sin(time / 160) * 0.35 + 0.65;
            ctx.fillStyle = `rgba(74, 222, 128, ${pulse})`;
            ctx.fillRect(slot.x - 7, slot.y - 34, 14, 22);
          }

          ctx.fillStyle = "#cbd5e1";
          ctx.font = "bold 9px monospace";
          ctx.textAlign = "center";
          ctx.fillText(dev.name.slice(0, 14), slot.x, slot.y + 13);
          ctx.textAlign = "left";
        });
      }

      // --- COFFEE LOUNGE FURNITURE + ANIMATED STEAM ---
      ctx.fillStyle = "#451a03";
      ctx.fillRect(885, 355, 44, 76);
      ctx.fillStyle = "#94a3b8";
      ctx.fillRect(894, 366, 24, 22);
      ctx.fillStyle = "#ef4444";
      ctx.fillRect(910, 370, 4, 4);
      // Animated coffee steam pixels
      const steamOffset = (time / 40) % 16;
      ctx.fillStyle = `rgba(226, 232, 240, ${0.5 - steamOffset / 34})`;
      ctx.fillRect(900, 360 - steamOffset, 3, 3);
      ctx.fillRect(907, 356 - ((steamOffset + 7) % 16), 3, 3);

      // Cozy sofa
      ctx.fillStyle = "#4c1d95";
      ctx.fillRect(512, 356, 178, 26);
      ctx.fillStyle = "#6d28d9";
      ctx.fillRect(516, 360, 170, 16);
      // Rug
      ctx.fillStyle = "rgba(139, 92, 246, 0.12)";
      ctx.fillRect(515, 392, 340, 76);

      // --- UPDATE & DRAW 10 PIXEL AGENTS WITH WAYPOINT PATHFINDING ---
      const motions = motionRef.current;
      curAgents.forEach((agent) => {
        const target = getTargetPos(agent, curDevices, curAgents);
        if (!motions[agent.id]) {
          motions[agent.id] = { x: target.x, y: target.y, zone: agent.zone, waypoints: [] };
        }
        const m = motions[agent.id];

        if (m.zone !== agent.zone) {
          m.waypoints = [DOORWAYS[m.zone], CORRIDOR_HUB, DOORWAYS[agent.zone], target];
          m.zone = agent.zone;
        } else if (m.waypoints.length === 0) {
          const distToTarget = Math.hypot(target.x - m.x, target.y - m.y);
          if (distToTarget > 3) m.waypoints = [target];
        } else {
          m.waypoints[m.waypoints.length - 1] = target;
        }

        let walking = false;
        if (m.waypoints.length > 0) {
          const next = m.waypoints[0];
          const dx = next.x - m.x;
          const dy = next.y - m.y;
          const dist = Math.hypot(dx, dy);
          const speed = 3.6;
          if (dist <= speed) {
            m.x = next.x;
            m.y = next.y;
            m.waypoints.shift();
          } else {
            m.x += (dx / dist) * speed;
            m.y += (dy / dist) * speed;
            walking = true;
          }
        }

        const isSelected = selId === agent.id;
        const myCases = curCases.filter((c) => c.assignedAgentId === agent.id);
        const passedCases = myCases.filter((c) => c.status === "passed").length;
        const progress = myCases.length > 0 ? passedCases / myCases.length : agent.status === "done" ? 1 : 0;

        drawPixelAgent(ctx, m.x, m.y, agent, walking, isSelected, progress, time);
      });

      // --- HANDOFF BEAMS ---
      const now = Date.now();
      curBeams.forEach((beam) => {
        const from = motions[beam.fromAgentId];
        const to = motions[beam.toAgentId];
        if (!from || !to) return;
        const progress = Math.min(1, (now - beam.createdAt) / 1400);
        ctx.save();
        ctx.strokeStyle = "rgba(251, 191, 36, 0.5)";
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y - 10);
        ctx.lineTo(to.x, to.y - 10);
        ctx.stroke();

        const px = from.x + (to.x - from.x) * progress;
        const py = from.y - 10 + (to.y - from.y) * progress - Math.sin(progress * Math.PI) * 26;
        ctx.setLineDash([]);
        ctx.fillStyle = "#fbbf24";
        ctx.fillRect(px - 5, py - 5, 10, 10);
        ctx.fillStyle = "#fef3c7";
        ctx.font = "bold 9px monospace";
        ctx.fillText(beam.label, px + 8, py + 3);
        ctx.restore();
      });

      // --- SMART ANTI-OVERLAP SPEECH BUBBLES ---
      const placedRects: Array<{ x: number; y: number; w: number; h: number }> = [];
      curAgents.forEach((agent) => {
        if (!agent.speech || agent.status === "idle") return;
        if (agent.status === "done" && agent.id !== selId) return;
        const pos = motions[agent.id];
        if (!pos) return;
        drawSpeechBubble(ctx, pos.x, pos.y - 42, agent.speech.slice(0, 32), agent.status, placedRects);
      });

      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = W / rect.width;
    const scaleY = H / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;

    let closestId: string | null = null;
    let bestDist = 34;
    for (const [id, pos] of Object.entries(motionRef.current)) {
      const d = Math.hypot(mx - pos.x, my - (pos.y - 8));
      if (d < bestDist) {
        bestDist = d;
        closestId = id;
      }
    }
    if (closestId) onSelectAgent(closestId);
  };

  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-950 shadow-2xl">
      {/* Floating Zoom Controls (inspired by pixel-agents) */}
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-lg border border-slate-700/80 bg-slate-900/90 p-1 backdrop-blur-xs">
        <button
          onClick={() => setZoom((z) => Math.max(1, Number((z - 0.25).toFixed(2))))}
          title="Zoom out"
          className="rounded p-1 text-slate-300 hover:bg-slate-800 hover:text-white"
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </button>
        <span className="px-1.5 font-mono text-[10px] text-slate-300">{Math.round(zoom * 100)}%</span>
        <button
          onClick={() => setZoom((z) => Math.min(1.75, Number((z + 0.25).toFixed(2))))}
          title="Zoom in"
          className="rounded p-1 text-slate-300 hover:bg-slate-800 hover:text-white"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </button>
        {zoom !== 1 && (
          <button
            onClick={() => setZoom(1)}
            title="Reset zoom"
            className="rounded p-1 text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="overflow-auto">
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          onClick={handleClick}
          style={{ width: `${zoom * 100}%` }}
          className="block h-auto cursor-pointer select-none transition-[width] duration-200"
        />
      </div>
    </div>
  );
};

function drawRoom(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  bg: string,
  accent: string
) {
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "#334155";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);

  ctx.fillStyle = accent;
  ctx.fillRect(x, y, w, 3);

  ctx.fillStyle = "#94a3b8";
  ctx.font = "bold 10px monospace";
  ctx.fillText(label, x + 10, y + 17);
}

function drawChair(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(cx - 10, cy - 6, 20, 12);
  ctx.fillStyle = "#475569";
  ctx.fillRect(cx - 8, cy - 4, 16, 8);
}

function drawPixelPlant(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = "#9a3412";
  ctx.fillRect(x - 6, y, 12, 10);
  ctx.fillStyle = "#16a34a";
  ctx.fillRect(x - 8, y - 8, 16, 8);
  ctx.fillStyle = "#22c55e";
  ctx.fillRect(x - 5, y - 13, 10, 6);
}

function drawBookshelf(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = "#451a03";
  ctx.fillRect(x, y, 88, 34);
  ctx.strokeStyle = "#78350f";
  ctx.strokeRect(x, y, 88, 34);
  const colors = ["#ef4444", "#38bdf8", "#f59e0b", "#22c55e", "#a78bfa", "#fb7185"];
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(x + 5 + i * 8, y + 5, 6, 11);
    ctx.fillStyle = colors[(i + 2) % colors.length];
    ctx.fillRect(x + 5 + i * 8, y + 19, 6, 11);
  }
}

function drawServerRack(ctx: CanvasRenderingContext2D, x: number, y: number, time: number) {
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(x, y, 36, 82);
  ctx.strokeStyle = "#334155";
  ctx.strokeRect(x, y, 36, 82);
  for (let row = 0; row < 5; row++) {
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(x + 4, y + 6 + row * 15, 28, 10);
    const blink = Math.floor(time / 300 + row) % 2 === 0;
    ctx.fillStyle = blink ? "#22c55e" : "#0284c7";
    ctx.fillRect(x + 7, y + 9 + row * 15, 4, 4);
    ctx.fillStyle = "#475569";
    ctx.fillRect(x + 15, y + 10 + row * 15, 13, 2);
  }
}

function drawDesk(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  monitorColor: string,
  isLead: boolean,
  time: number
) {
  const dw = isLead ? 102 : 78;
  const dh = 26;
  ctx.fillStyle = isLead ? "#78350f" : "#334155";
  ctx.fillRect(cx - dw / 2, cy - dh / 2, dw, dh);
  ctx.strokeStyle = "#0f172a";
  ctx.lineWidth = 1;
  ctx.strokeRect(cx - dw / 2, cy - dh / 2, dw, dh);

  // Monitor
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(cx - 19, cy - 10, 38, 16);
  ctx.fillStyle = monitorColor;
  ctx.fillRect(cx - 16, cy - 8, 32, 12);

  // Animated typing code lines when active
  if (monitorColor !== "#334155" && monitorColor !== "#1e293b") {
    const w1 = 10 + (Math.floor(time / 220) % 14);
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillRect(cx - 13, cy - 5, w1, 2);
    ctx.fillRect(cx - 13, cy - 1, 22, 2);
  }
}

function drawPixelAgent(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  agent: AgentInfo,
  walking: boolean,
  selected: boolean,
  progress: number,
  time: number
) {
  const bob = walking
    ? Math.sin(time / 85) * 2.5
    : agent.status === "writing" || agent.status === "testing" || agent.status === "debugging"
      ? Math.sin(time / 130) * 1.2
      : 0;

  // Alert beacon for debugging / error (inspired by AgentSystemLabs/agent-office)
  if (agent.status === "debugging" || agent.status === "error") {
    const pulse = (Math.sin(time / 150) + 1) / 2;
    ctx.strokeStyle = agent.status === "error" ? `rgba(239, 68, 68, ${0.4 + pulse * 0.6})` : `rgba(249, 115, 22, ${0.4 + pulse * 0.6})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y - 6, 18 + pulse * 6, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (selected) {
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y - 4, 21, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.beginPath();
  ctx.ellipse(x, y + 10, 11, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  const py = y + bob;

  // Legs
  ctx.fillStyle = "#1e293b";
  const legOffset = walking ? Math.sin(time / 75) * 2.2 : 0;
  ctx.fillRect(x - 6, py + 2 + legOffset, 5, 8);
  ctx.fillRect(x + 1, py + 2 - legOffset, 5, 8);

  // Torso
  ctx.fillStyle = agent.shirtColor;
  ctx.fillRect(x - 8, py - 10, 16, 13);

  // Head
  ctx.fillStyle = "#fde68a";
  ctx.fillRect(x - 7, py - 22, 14, 12);

  // Hair
  ctx.fillStyle = agent.hairColor;
  ctx.fillRect(x - 8, py - 24, 16, 5);
  ctx.fillRect(x - 8, py - 21, 3, 6);
  ctx.fillRect(x + 5, py - 21, 3, 6);

  // Eyes
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(x - 4, py - 16, 2, 2);
  ctx.fillRect(x + 2, py - 16, 2, 2);

  // Mini progress bar above head (inspired by pixel-agents context/health bar)
  if (progress > 0 || agent.status !== "idle") {
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(x - 12, py - 30, 24, 4);
    ctx.fillStyle = statusMonitorColor(agent.status);
    ctx.fillRect(x - 11, py - 29, Math.max(4, Math.round(22 * (progress || 0.35))), 2);
  }

  // Name tag
  ctx.fillStyle = "rgba(15, 23, 42, 0.88)";
  ctx.fillRect(x - 32, y + 12, 64, 13);
  ctx.fillStyle = agent.role === "qa_lead" ? "#fbbf24" : "#e2e8f0";
  ctx.font = "bold 9px monospace";
  ctx.textAlign = "center";
  ctx.fillText(agent.shortName, x, y + 21);
  ctx.textAlign = "left";
}

function drawSpeechBubble(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  status: AgentInfo["status"],
  placedRects: Array<{ x: number; y: number; w: number; h: number }>
) {
  ctx.font = "9px monospace";
  const textW = ctx.measureText(text).width;
  const bw = Math.min(196, Math.max(60, textW + 14));
  const bh = 18;
  const bx = Math.max(6, Math.min(W - bw - 6, x - bw / 2));
  let by = Math.max(6, y - bh);

  // Anti-overlap shift upwards (inspired by my-virtual-office)
  for (let tries = 0; tries < 4; tries++) {
    const collides = placedRects.some(
      (r) => bx < r.x + r.w + 3 && bx + bw + 3 > r.x && by < r.y + r.h + 2 && by + bh + 2 > r.y
    );
    if (!collides) break;
    by = Math.max(6, by - (bh + 3));
  }
  placedRects.push({ x: bx, y: by, w: bw, h: bh });

  ctx.fillStyle = "rgba(15, 23, 42, 0.94)";
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = statusMonitorColor(status);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(bx, by, bw, bh);

  ctx.fillStyle = "#f8fafc";
  ctx.fillText(text, bx + 7, by + 12);
}
