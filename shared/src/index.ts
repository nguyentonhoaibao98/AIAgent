export type AgentRole = "qa_lead" | "maestro_engineer";

export type AgentStatus =
  | "idle"
  | "analyzing"
  | "writing"
  | "waiting_device"
  | "testing"
  | "debugging"
  | "handoff"
  | "done"
  | "error";

export type OfficeZone = "planning" | "automation" | "device_lab" | "lounge";

export interface AgentInfo {
  id: string;
  name: string;
  shortName: string;
  role: AgentRole;
  specialty: string;
  avatarColor: string;
  hairColor: string;
  shirtColor: string;
  deskIndex: number;
  status: AgentStatus;
  zone: OfficeZone;
  currentTaskId: string | null;
  speech: string;
  lastTool: string;
  updatedAt: string;
  stats: {
    completed: number;
    failed: number;
    retries: number;
  };
}

export type MissionMode = "cursor_mcp" | "cursor_sdk" | "simulation";
export type MissionStatus = "idle" | "planning" | "executing" | "completed" | "failed" | "stopped";

export interface Mission {
  id: string;
  title: string;
  appId: string;
  repoPath: string;
  flowsDir: string;
  specText: string;
  mode: MissionMode;
  status: MissionStatus;
  createdAt: string;
  updatedAt: string;
  summary: string;
}

export type TestCaseStatus =
  | "manual_ready"
  | "writing_yaml"
  | "waiting_device"
  | "testing"
  | "debugging"
  | "passed"
  | "failed";

export interface TestCase {
  id: string;
  missionId: string;
  code: string;
  title: string;
  module: string;
  priority: "P0" | "P1" | "P2";
  preconditions: string;
  steps: string[];
  expectedResult: string;
  status: TestCaseStatus;
  assignedAgentId: string | null;
  yamlPath: string | null;
  yamlContent: string | null;
  deviceId: string | null;
  retryCount: number;
  maxRetries: number;
  lastError: string | null;
  lastLogs: string;
  screenshotUrl: string | null;
  updatedAt: string;
}

export interface DeviceInfo {
  id: string;
  name: string;
  platform: "android" | "ios" | "virtual";
  connection: "usb" | "tcp" | "emulator" | "simulated";
  state: "online" | "offline" | "busy";
  lockedByAgentId: string | null;
  lockedTestCaseId: string | null;
  queue: Array<{ agentId: string; testCaseId: string; enqueuedAt: string }>;
}

export interface ActivityEvent {
  id: string;
  missionId: string | null;
  agentId: string | null;
  type:
    | "mission_started"
    | "mission_completed"
    | "manual_cases_created"
    | "handoff"
    | "agent_status"
    | "device_lock"
    | "device_unlock"
    | "maestro_log"
    | "test_passed"
    | "test_failed"
    | "error";
  message: string;
  fromAgentId?: string | null;
  toAgentId?: string | null;
  testCaseId?: string | null;
  deviceId?: string | null;
  timestamp: string;
}

export interface OfficeSettings {
  adbPath: string;
  maestroPath: string;
  useWslMaestro: boolean;
  cursorModel: string;
  maxConcurrency: number;
  maxRetries: number;
  hasCursorApiKey: boolean;
  adbDetected: boolean;
  maestroDetected: boolean;
}

export interface OfficeSnapshot {
  mission: Mission | null;
  missions: Mission[];
  agents: AgentInfo[];
  testCases: TestCase[];
  devices: DeviceInfo[];
  events: ActivityEvent[];
  settings: OfficeSettings;
}

export interface HandoffBeam {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  label: string;
  createdAt: number;
}

export type ServerWSMessage =
  | { type: "snapshot"; payload: OfficeSnapshot }
  | { type: "agent_update"; payload: AgentInfo }
  | { type: "test_case_update"; payload: TestCase }
  | { type: "mission_update"; payload: Mission }
  | { type: "devices_update"; payload: DeviceInfo[] }
  | { type: "event"; payload: ActivityEvent }
  | { type: "handoff"; payload: { fromAgentId: string; toAgentId: string; label: string } }
  | { type: "maestro_output"; payload: { testCaseId: string; agentId: string; deviceId: string; chunk: string } };

export const DEFAULT_AGENTS: Array<Omit<AgentInfo, "status" | "zone" | "currentTaskId" | "speech" | "lastTool" | "updatedAt" | "stats">> = [
  {
    id: "qa-lead",
    name: "Aria (QA Lead)",
    shortName: "QA Lead",
    role: "qa_lead",
    specialty: "App Exploration & Manual Test Design",
    avatarColor: "#f59e0b",
    hairColor: "#451a03",
    shirtColor: "#d97706",
    deskIndex: 0
  },
  {
    id: "maestro-01",
    name: "Mina (Auth & Onboarding)",
    shortName: "M-01 Auth",
    role: "maestro_engineer",
    specialty: "Auth, Login & Onboarding",
    avatarColor: "#38bdf8",
    hairColor: "#1e293b",
    shirtColor: "#0284c7",
    deskIndex: 1
  },
  {
    id: "maestro-02",
    name: "Kai (Navigation)",
    shortName: "M-02 Nav",
    role: "maestro_engineer",
    specialty: "Navigation & Core Flows",
    avatarColor: "#34d399",
    hairColor: "#064e3b",
    shirtColor: "#059669",
    deskIndex: 2
  },
  {
    id: "maestro-03",
    name: "Linh (Forms)",
    shortName: "M-03 Forms",
    role: "maestro_engineer",
    specialty: "Forms & Input Validation",
    avatarColor: "#a78bfa",
    hairColor: "#3b0764",
    shirtColor: "#7c3aed",
    deskIndex: 3
  },
  {
    id: "maestro-04",
    name: "Leo (Search)",
    shortName: "M-04 Search",
    role: "maestro_engineer",
    specialty: "Search, Filter & Sorting",
    avatarColor: "#fb7185",
    hairColor: "#4c0519",
    shirtColor: "#e11d48",
    deskIndex: 4
  },
  {
    id: "maestro-05",
    name: "Zoe (Checkout)",
    shortName: "M-05 Pay",
    role: "maestro_engineer",
    specialty: "Cart, Checkout & Transactions",
    avatarColor: "#2dd4bf",
    hairColor: "#134e4a",
    shirtColor: "#0d9488",
    deskIndex: 5
  },
  {
    id: "maestro-06",
    name: "Nam (Profile)",
    shortName: "M-06 Prof",
    role: "maestro_engineer",
    specialty: "Profile, Account & Settings",
    avatarColor: "#60a5fa",
    hairColor: "#172554",
    shirtColor: "#2563eb",
    deskIndex: 6
  },
  {
    id: "maestro-07",
    name: "Hana (Edge Cases)",
    shortName: "M-07 Edge",
    role: "maestro_engineer",
    specialty: "Offline, Errors & Edge Cases",
    avatarColor: "#f472b6",
    hairColor: "#500724",
    shirtColor: "#db2777",
    deskIndex: 7
  },
  {
    id: "maestro-08",
    name: "Dev (Deep Links)",
    shortName: "M-08 Link",
    role: "maestro_engineer",
    specialty: "Push Notifications & Deep Links",
    avatarColor: "#fbbf24",
    hairColor: "#422006",
    shirtColor: "#ca8a04",
    deskIndex: 8
  },
  {
    id: "maestro-09",
    name: "Tuan (Regression)",
    shortName: "M-09 Smoke",
    role: "maestro_engineer",
    specialty: "End-to-End Smoke & Regression",
    avatarColor: "#4ade80",
    hairColor: "#14532d",
    shirtColor: "#16a34a",
    deskIndex: 9
  }
];
