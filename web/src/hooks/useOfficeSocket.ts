import { useCallback, useEffect, useRef, useState } from "react";
import type {
  HandoffBeam,
  MissionMode,
  OfficeSettings,
  OfficeSnapshot,
  ServerWSMessage
} from "@maestro-office/shared";
import { soundFx } from "../utils/soundFx";

export function useOfficeSocket() {
  const [snapshot, setSnapshot] = useState<OfficeSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [beams, setBeams] = useState<HandoffBeam[]>([]);
  const [liveLogs, setLiveLogs] = useState<Record<string, string>>({});
  const wsRef = useRef<WebSocket | null>(null);

  const fetchSnapshot = useCallback(async (missionId?: string) => {
    try {
      const url = missionId ? `/api/snapshot?missionId=${encodeURIComponent(missionId)}` : "/api/snapshot";
      const res = await fetch(url);
      if (res.ok) {
        const data = (await res.json()) as OfficeSnapshot;
        setSnapshot(data);
      }
    } catch {
      // ignore initial retry
    }
  }, []);

  useEffect(() => {
    void fetchSnapshot();
    let timer: number | undefined;
    let alive = true;

    const connect = () => {
      if (!alive) return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${proto}//${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (alive) timer = window.setTimeout(connect, 2000);
      };
      ws.onerror = () => ws.close();

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as ServerWSMessage;
          if (msg.type === "snapshot") {
            setSnapshot(msg.payload);
            return;
          }
          if (msg.type === "handoff") {
            soundFx.playHandoff();
            const beam: HandoffBeam = {
              id: `${Date.now()}-${Math.random()}`,
              fromAgentId: msg.payload.fromAgentId,
              toAgentId: msg.payload.toAgentId,
              label: msg.payload.label,
              createdAt: Date.now()
            };
            setBeams((prev) => [...prev.slice(-15), beam]);
            window.setTimeout(() => {
              setBeams((prev) => prev.filter((b) => b.id !== beam.id));
            }, 2200);
            return;
          }
          if (msg.type === "maestro_output") {
            setLiveLogs((prev) => ({
              ...prev,
              [msg.payload.testCaseId]: (prev[msg.payload.testCaseId] || "") + msg.payload.chunk
            }));
            return;
          }
          if (msg.type === "event") {
            if (msg.payload.type === "test_passed") soundFx.playPass();
            else if (msg.payload.type === "test_failed" || msg.payload.type === "error") soundFx.playAlert();
            else if (msg.payload.type === "mission_completed") soundFx.playMissionComplete();
          }

          setSnapshot((prev) => {
            if (!prev) return prev;
            if (msg.type === "agent_update") {
              const agents = prev.agents.map((a) => (a.id === msg.payload.id ? msg.payload : a));
              return { ...prev, agents };
            }
            if (msg.type === "test_case_update") {
              const exists = prev.testCases.some((t) => t.id === msg.payload.id);
              const testCases = exists
                ? prev.testCases.map((t) => (t.id === msg.payload.id ? msg.payload : t))
                : [...prev.testCases, msg.payload];
              return { ...prev, testCases };
            }
            if (msg.type === "mission_update") {
              const missions = prev.missions.some((m) => m.id === msg.payload.id)
                ? prev.missions.map((m) => (m.id === msg.payload.id ? msg.payload : m))
                : [msg.payload, ...prev.missions];
              const isNewMission = prev.mission?.id !== msg.payload.id;
              return {
                ...prev,
                mission: msg.payload,
                missions,
                testCases: isNewMission ? [] : prev.testCases
              };
            }
            if (msg.type === "devices_update") {
              return { ...prev, devices: msg.payload };
            }
            if (msg.type === "event") {
              return { ...prev, events: [...prev.events.slice(-220), msg.payload] };
            }
            return prev;
          });
        } catch {
          // ignore malformed ws frame
        }
      };
    };

    connect();
    return () => {
      alive = false;
      if (timer) window.clearTimeout(timer);
      wsRef.current?.close();
    };
  }, [fetchSnapshot]);

  const startMission = async (input: {
    title: string;
    appId: string;
    repoPath: string;
    flowsDir: string;
    specText: string;
    mode: MissionMode;
  }) => {
    setLiveLogs({});
    const res = await fetch("/api/missions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    });
    if (res.ok) {
      const data = await res.json();
      if (data.snapshot) setSnapshot(data.snapshot);
    }
  };

  const stopMission = async (missionId: string) => {
    await fetch(`/api/missions/${encodeURIComponent(missionId)}/stop`, { method: "POST" });
  };

  const refreshDevices = async () => {
    await fetch("/api/devices/refresh", { method: "POST" });
  };

  const connectTcpDevice = async (hostPort: string) => {
    const res = await fetch("/api/devices/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostPort })
    });
    return (await res.json()) as { ok: boolean; output: string };
  };

  const saveSettings = async (patch: Partial<OfficeSettings> & { cursorApiKey?: string }) => {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    });
    if (res.ok) {
      const settings = (await res.json()) as OfficeSettings;
      setSnapshot((prev) => (prev ? { ...prev, settings } : prev));
    }
  };

  const sendChatMessage = async (message: string, targetAgentId?: string | null) => {
    await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, targetAgentId: targetAgentId || null })
    });
  };

  return {
    snapshot,
    connected,
    beams,
    liveLogs,
    loadMission: fetchSnapshot,
    startMission,
    stopMission,
    refreshDevices,
    connectTcpDevice,
    saveSettings,
    sendChatMessage
  };
}
