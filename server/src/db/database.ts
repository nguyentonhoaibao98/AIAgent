import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  DEFAULT_AGENTS,
  type ActivityEvent,
  type AgentInfo,
  type AgentStatus,
  type Mission,
  type MissionMode,
  type MissionStatus,
  type OfficeZone,
  type TestCase,
  type TestCaseStatus
} from "@maestro-office/shared";

const DATA_DIR = path.resolve(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "maestro-office.db");

export class OfficeDatabase {
  private db: DatabaseSync;

  constructor(dbPath = DB_PATH) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.initSchema();
    this.seedAgents();
  }

  private initSchema() {
    this.db.exec(`
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS missions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        app_id TEXT NOT NULL,
        repo_path TEXT NOT NULL,
        flows_dir TEXT NOT NULL,
        spec_text TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        short_name TEXT NOT NULL,
        role TEXT NOT NULL,
        specialty TEXT NOT NULL,
        avatar_color TEXT NOT NULL,
        hair_color TEXT NOT NULL,
        shirt_color TEXT NOT NULL,
        desk_index INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'idle',
        zone TEXT NOT NULL DEFAULT 'lounge',
        current_task_id TEXT,
        speech TEXT NOT NULL DEFAULT '',
        last_tool TEXT NOT NULL DEFAULT '',
        completed_count INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0,
        retry_count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS test_cases (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        code TEXT NOT NULL,
        title TEXT NOT NULL,
        module TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'P1',
        preconditions TEXT NOT NULL DEFAULT '',
        steps_json TEXT NOT NULL DEFAULT '[]',
        expected_result TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'manual_ready',
        assigned_agent_id TEXT,
        yaml_path TEXT,
        yaml_content TEXT,
        device_id TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 3,
        last_error TEXT,
        last_logs TEXT NOT NULL DEFAULT '',
        screenshot_url TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        mission_id TEXT,
        agent_id TEXT,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        from_agent_id TEXT,
        to_agent_id TEXT,
        test_case_id TEXT,
        device_id TEXT,
        timestamp TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  private seedAgents() {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO agents (
        id, name, short_name, role, specialty,
        avatar_color, hair_color, shirt_color, desk_index,
        status, zone, speech, last_tool, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', 'lounge', '', '', ?)
    `);

    for (const a of DEFAULT_AGENTS) {
      stmt.run(
        a.id,
        a.name,
        a.shortName,
        a.role,
        a.specialty,
        a.avatarColor,
        a.hairColor,
        a.shirtColor,
        a.deskIndex,
        now
      );
    }
  }

  // --- Settings ---
  getSetting(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row ? row.value : null;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      )
      .run(key, value);
  }

  // --- Missions ---
  createMission(input: {
    title: string;
    appId: string;
    repoPath: string;
    flowsDir: string;
    specText: string;
    mode: MissionMode;
  }): Mission {
    const now = new Date().toISOString();
    const id = `mission-${crypto.randomBytes(4).toString("hex")}`;
    this.db
      .prepare(`
        INSERT INTO missions (id, title, app_id, repo_path, flows_dir, spec_text, mode, status, summary, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'planning', '', ?, ?)
      `)
      .run(id, input.title, input.appId, input.repoPath, input.flowsDir, input.specText, input.mode, now, now);

    return this.getMission(id)!;
  }

  getMission(id: string): Mission | null {
    const row = this.db.prepare("SELECT * FROM missions WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.mapMission(row) : null;
  }

  getLatestMission(): Mission | null {
    const row = this.db.prepare("SELECT * FROM missions ORDER BY created_at DESC LIMIT 1").get() as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapMission(row) : null;
  }

  listMissions(limit = 20): Mission[] {
    const rows = this.db.prepare("SELECT * FROM missions ORDER BY created_at DESC LIMIT ?").all(limit) as Array<
      Record<string, unknown>
    >;
    return rows.map((r) => this.mapMission(r));
  }

  updateMission(id: string, patch: Partial<{ status: MissionStatus; summary: string; mode: MissionMode }>): Mission | null {
    const existing = this.getMission(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    this.db
      .prepare("UPDATE missions SET status = ?, summary = ?, mode = ?, updated_at = ? WHERE id = ?")
      .run(
        patch.status ?? existing.status,
        patch.summary ?? existing.summary,
        patch.mode ?? existing.mode,
        now,
        id
      );
    return this.getMission(id);
  }

  private mapMission(r: Record<string, unknown>): Mission {
    return {
      id: String(r.id),
      title: String(r.title),
      appId: String(r.app_id),
      repoPath: String(r.repo_path),
      flowsDir: String(r.flows_dir),
      specText: String(r.spec_text),
      mode: String(r.mode) as MissionMode,
      status: String(r.status) as MissionStatus,
      summary: String(r.summary ?? ""),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at)
    };
  }

  // --- Agents ---
  listAgents(): AgentInfo[] {
    const rows = this.db.prepare("SELECT * FROM agents ORDER BY desk_index ASC").all() as Array<
      Record<string, unknown>
    >;
    return rows.map((r) => this.mapAgent(r));
  }

  getAgent(id: string): AgentInfo | null {
    const row = this.db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.mapAgent(row) : null;
  }

  updateAgent(
    id: string,
    patch: Partial<{
      status: AgentStatus;
      zone: OfficeZone;
      currentTaskId: string | null;
      speech: string;
      lastTool: string;
      incCompleted: number;
      incFailed: number;
      incRetries: number;
    }>
  ): AgentInfo | null {
    const existing = this.getAgent(id);
    if (!existing) return null;

    const status = patch.status ?? existing.status;
    const zone = patch.zone ?? this.inferZone(existing.role, status);
    const currentTaskId = patch.currentTaskId !== undefined ? patch.currentTaskId : existing.currentTaskId;
    const speech = patch.speech !== undefined ? patch.speech : existing.speech;
    const lastTool = patch.lastTool !== undefined ? patch.lastTool : existing.lastTool;
    const completed = existing.stats.completed + (patch.incCompleted ?? 0);
    const failed = existing.stats.failed + (patch.incFailed ?? 0);
    const retries = existing.stats.retries + (patch.incRetries ?? 0);
    const now = new Date().toISOString();

    this.db
      .prepare(`
        UPDATE agents
        SET status = ?, zone = ?, current_task_id = ?, speech = ?, last_tool = ?,
            completed_count = ?, failed_count = ?, retry_count = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(status, zone, currentTaskId, speech, lastTool, completed, failed, retries, now, id);

    return this.getAgent(id);
  }

  resetAllAgents(): AgentInfo[] {
    const now = new Date().toISOString();
    this.db
      .prepare(`
        UPDATE agents
        SET status = 'idle', zone = 'lounge', current_task_id = NULL,
            speech = '', last_tool = '', updated_at = ?
      `)
      .run(now);
    return this.listAgents();
  }

  private inferZone(role: string, status: AgentStatus): OfficeZone {
    if (status === "idle" || status === "done") return "lounge";
    if (status === "waiting_device" || status === "testing") return "device_lab";
    if (role === "qa_lead") return "planning";
    return "automation";
  }

  private mapAgent(r: Record<string, unknown>): AgentInfo {
    return {
      id: String(r.id),
      name: String(r.name),
      shortName: String(r.short_name),
      role: String(r.role) as AgentInfo["role"],
      specialty: String(r.specialty),
      avatarColor: String(r.avatar_color),
      hairColor: String(r.hair_color),
      shirtColor: String(r.shirt_color),
      deskIndex: Number(r.desk_index),
      status: String(r.status) as AgentStatus,
      zone: String(r.zone) as OfficeZone,
      currentTaskId: r.current_task_id ? String(r.current_task_id) : null,
      speech: String(r.speech ?? ""),
      lastTool: String(r.last_tool ?? ""),
      updatedAt: String(r.updated_at),
      stats: {
        completed: Number(r.completed_count ?? 0),
        failed: Number(r.failed_count ?? 0),
        retries: Number(r.retry_count ?? 0)
      }
    };
  }

  // --- Test Cases ---
  createTestCases(
    missionId: string,
    cases: Array<{
      code?: string;
      title: string;
      module: string;
      priority?: "P0" | "P1" | "P2";
      preconditions?: string;
      steps: string[];
      expectedResult: string;
      assignedAgentId?: string | null;
      maxRetries?: number;
    }>
  ): TestCase[] {
    const existingCount = (
      this.db.prepare("SELECT COUNT(*) as c FROM test_cases WHERE mission_id = ?").get(missionId) as { c: number }
    ).c;

    const now = new Date().toISOString();
    const created: TestCase[] = [];
    const stmt = this.db.prepare(`
      INSERT INTO test_cases (
        id, mission_id, code, title, module, priority, preconditions,
        steps_json, expected_result, status, assigned_agent_id,
        max_retries, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual_ready', ?, ?, ?)
    `);

    cases.forEach((tc, idx) => {
      const num = existingCount + idx + 1;
      const code = tc.code || `TC-${String(num).padStart(3, "0")}`;
      const id = `${missionId}-${code.toLowerCase()}-${crypto.randomBytes(2).toString("hex")}`;
      stmt.run(
        id,
        missionId,
        code,
        tc.title,
        tc.module || "General",
        tc.priority || "P1",
        tc.preconditions || "",
        JSON.stringify(tc.steps || []),
        tc.expectedResult || "",
        tc.assignedAgentId ?? null,
        tc.maxRetries ?? 3,
        now
      );
      const row = this.getTestCase(id);
      if (row) created.push(row);
    });

    return created;
  }

  getTestCase(id: string): TestCase | null {
    const row = this.db.prepare("SELECT * FROM test_cases WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapTestCase(row) : null;
  }

  listTestCases(missionId: string): TestCase[] {
    const rows = this.db
      .prepare("SELECT * FROM test_cases WHERE mission_id = ? ORDER BY code ASC")
      .all(missionId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapTestCase(r));
  }

  claimNextTestCase(missionId: string, agentId: string): TestCase | null {
    // First prefer cases already pre-assigned to this agent that are manual_ready
    let row = this.db
      .prepare(
        "SELECT * FROM test_cases WHERE mission_id = ? AND status = 'manual_ready' AND assigned_agent_id = ? ORDER BY priority ASC, code ASC LIMIT 1"
      )
      .get(missionId, agentId) as Record<string, unknown> | undefined;

    // Otherwise claim any unassigned manual_ready test case
    if (!row) {
      row = this.db
        .prepare(
          "SELECT * FROM test_cases WHERE mission_id = ? AND status = 'manual_ready' AND assigned_agent_id IS NULL ORDER BY priority ASC, code ASC LIMIT 1"
        )
        .get(missionId) as Record<string, unknown> | undefined;
    }

    if (!row) return null;
    const id = String(row.id);
    return this.updateTestCase(id, {
      assignedAgentId: agentId,
      status: "writing_yaml"
    });
  }

  updateTestCase(
    id: string,
    patch: Partial<{
      status: TestCaseStatus;
      assignedAgentId: string | null;
      yamlPath: string | null;
      yamlContent: string | null;
      deviceId: string | null;
      retryCount: number;
      lastError: string | null;
      lastLogs: string;
      screenshotUrl: string | null;
    }>
  ): TestCase | null {
    const existing = this.getTestCase(id);
    if (!existing) return null;

    const now = new Date().toISOString();
    this.db
      .prepare(`
        UPDATE test_cases
        SET status = ?, assigned_agent_id = ?, yaml_path = ?, yaml_content = ?,
            device_id = ?, retry_count = ?, last_error = ?, last_logs = ?,
            screenshot_url = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(
        patch.status ?? existing.status,
        patch.assignedAgentId !== undefined ? patch.assignedAgentId : existing.assignedAgentId,
        patch.yamlPath !== undefined ? patch.yamlPath : existing.yamlPath,
        patch.yamlContent !== undefined ? patch.yamlContent : existing.yamlContent,
        patch.deviceId !== undefined ? patch.deviceId : existing.deviceId,
        patch.retryCount ?? existing.retryCount,
        patch.lastError !== undefined ? patch.lastError : existing.lastError,
        patch.lastLogs !== undefined ? patch.lastLogs : existing.lastLogs,
        patch.screenshotUrl !== undefined ? patch.screenshotUrl : existing.screenshotUrl,
        now,
        id
      );

    return this.getTestCase(id);
  }

  private mapTestCase(r: Record<string, unknown>): TestCase {
    let steps: string[] = [];
    try {
      steps = JSON.parse(String(r.steps_json || "[]"));
    } catch {
      steps = [];
    }
    return {
      id: String(r.id),
      missionId: String(r.mission_id),
      code: String(r.code),
      title: String(r.title),
      module: String(r.module),
      priority: String(r.priority) as TestCase["priority"],
      preconditions: String(r.preconditions ?? ""),
      steps,
      expectedResult: String(r.expected_result ?? ""),
      status: String(r.status) as TestCaseStatus,
      assignedAgentId: r.assigned_agent_id ? String(r.assigned_agent_id) : null,
      yamlPath: r.yaml_path ? String(r.yaml_path) : null,
      yamlContent: r.yaml_content ? String(r.yaml_content) : null,
      deviceId: r.device_id ? String(r.device_id) : null,
      retryCount: Number(r.retry_count ?? 0),
      maxRetries: Number(r.max_retries ?? 3),
      lastError: r.last_error ? String(r.last_error) : null,
      lastLogs: String(r.last_logs ?? ""),
      screenshotUrl: r.screenshot_url ? String(r.screenshot_url) : null,
      updatedAt: String(r.updated_at)
    };
  }

  // --- Events ---
  addEvent(input: Omit<ActivityEvent, "id" | "timestamp">): ActivityEvent {
    const id = `evt-${crypto.randomBytes(4).toString("hex")}`;
    const timestamp = new Date().toISOString();
    this.db
      .prepare(`
        INSERT INTO events (id, mission_id, agent_id, type, message, from_agent_id, to_agent_id, test_case_id, device_id, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        input.missionId ?? null,
        input.agentId ?? null,
        input.type,
        input.message,
        input.fromAgentId ?? null,
        input.toAgentId ?? null,
        input.testCaseId ?? null,
        input.deviceId ?? null,
        timestamp
      );

    return { ...input, id, timestamp };
  }

  listEvents(missionId?: string | null, limit = 120): ActivityEvent[] {
    const rows = missionId
      ? (this.db
          .prepare("SELECT * FROM events WHERE mission_id = ? OR mission_id IS NULL ORDER BY timestamp DESC LIMIT ?")
          .all(missionId, limit) as Array<Record<string, unknown>>)
      : (this.db.prepare("SELECT * FROM events ORDER BY timestamp DESC LIMIT ?").all(limit) as Array<
          Record<string, unknown>
        >);

    return rows.reverse().map((r) => ({
      id: String(r.id),
      missionId: r.mission_id ? String(r.mission_id) : null,
      agentId: r.agent_id ? String(r.agent_id) : null,
      type: String(r.type) as ActivityEvent["type"],
      message: String(r.message),
      fromAgentId: r.from_agent_id ? String(r.from_agent_id) : null,
      toAgentId: r.to_agent_id ? String(r.to_agent_id) : null,
      testCaseId: r.test_case_id ? String(r.test_case_id) : null,
      deviceId: r.device_id ? String(r.device_id) : null,
      timestamp: String(r.timestamp)
    }));
  }
}
