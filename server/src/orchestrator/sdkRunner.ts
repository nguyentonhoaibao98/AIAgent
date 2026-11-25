import fs from "node:fs";
import path from "node:path";
import type { Mission, TestCase } from "@maestro-office/shared";
import type { OfficeDatabase } from "../db/database.js";
import type { DeviceManager } from "../devices/deviceManager.js";
import type { MaestroRunner } from "../devices/maestroRunner.js";
import type { WsHub } from "../ws/hub.js";

interface CursorSdkRun {
  id?: string;
  stream(): AsyncIterable<{ type?: string; message?: { content?: Array<{ type?: string; text?: string }> } }>;
  wait(): Promise<{ id?: string; status: string; result?: string }>;
  supports?(op: string): boolean;
  cancel?(): Promise<void>;
}

interface CursorSdkAgent {
  agentId?: string;
  send(prompt: string): Promise<CursorSdkRun>;
  [Symbol.asyncDispose](): Promise<void>;
}

interface CursorSdkModule {
  Agent: {
    create(opts: {
      apiKey: string;
      model: { id: string };
      local: { cwd: string };
    }): Promise<CursorSdkAgent>;
  };
  CursorAgentError?: new (...args: unknown[]) => Error & { isRetryable?: boolean };
}

export class CursorSdkOrchestrator {
  private aborted = false;
  private running = false;

  constructor(
    private db: OfficeDatabase,
    private hub: WsHub,
    private deviceManager: DeviceManager,
    private maestroRunner: MaestroRunner
  ) {}

  isRunning() {
    return this.running;
  }

  stop() {
    this.aborted = true;
    this.running = false;
  }

  async run(
    mission: Mission,
    options: { apiKey: string; model: string; maxConcurrency: number; maxRetries: number }
  ) {
    this.aborted = false;
    this.running = true;

    let sdk: CursorSdkModule;
    try {
      // Dynamic import so the server runs even when @cursor/sdk is not installed
      sdk = (await import("@cursor/sdk")) as unknown as CursorSdkModule;
    } catch {
      this.running = false;
      const msg =
        "@cursor/sdk is not installed. Run `npm install @cursor/sdk -w server` or switch to Cursor MCP Mode.";
      this.db.updateMission(mission.id, { status: "failed", summary: msg });
      this.emitEvent(mission.id, null, "error", msg);
      return;
    }

    if (!options.apiKey) {
      this.running = false;
      const msg = "CURSOR_API_KEY is missing. Set it in environment/Settings or use Cursor MCP Mode.";
      this.db.updateMission(mission.id, { status: "failed", summary: msg });
      this.emitEvent(mission.id, null, "error", msg);
      return;
    }

    const cwd = fs.existsSync(mission.repoPath) ? mission.repoPath : process.cwd();
    const flowsDir = path.resolve(mission.flowsDir || path.join(cwd, "maestro", "flows"));
    fs.mkdirSync(flowsDir, { recursive: true });

    try {
      // PHASE 1: Agent 01 (QA Lead) inspects app + spec and generates manual test cases
      const createdCases = await this.runQaLead(sdk, mission, cwd, options);
      if (this.aborted || createdCases.length === 0) return;

      const execMission = this.db.updateMission(mission.id, { status: "executing" });
      if (execMission) this.hub.broadcast({ type: "mission_update", payload: execMission });

      // PHASE 2: 9 Maestro Engineers claim cases, write YAML, acquire device lock, run & debug
      const engineerIds = [
        "maestro-01",
        "maestro-02",
        "maestro-03",
        "maestro-04",
        "maestro-05",
        "maestro-06",
        "maestro-07",
        "maestro-08",
        "maestro-09"
      ];
      const concurrency = Math.max(1, Math.min(options.maxConcurrency, engineerIds.length));
      const activeWorkers = engineerIds.slice(0, concurrency);

      await Promise.all(
        activeWorkers.map((agentId) => this.runEngineerWorker(sdk, mission, agentId, cwd, flowsDir, options))
      );

      if (!this.aborted) {
        const allCases = this.db.listTestCases(mission.id);
        const passed = allCases.filter((c) => c.status === "passed").length;
        const finalMission = this.db.updateMission(mission.id, {
          status: "completed",
          summary: `Cursor SDK run finished: ${passed}/${allCases.length} Maestro tests passed.`
        });
        if (finalMission) this.hub.broadcast({ type: "mission_update", payload: finalMission });
        this.emitEvent(mission.id, null, "mission_completed", finalMission?.summary || "Mission completed.");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.db.updateMission(mission.id, { status: "failed", summary: msg });
      this.emitEvent(mission.id, null, "error", `Cursor SDK Orchestrator error: ${msg}`);
    } finally {
      this.running = false;
    }
  }

  private async runQaLead(
    sdk: CursorSdkModule,
    mission: Mission,
    cwd: string,
    options: { apiKey: string; model: string; maxRetries: number }
  ): Promise<TestCase[]> {
    this.setAgent(mission.id, "qa-lead", "analyzing", "planning", "Inspecting app repo & spec...", "cursor_sdk");
    const agent = await sdk.Agent.create({
      apiKey: options.apiKey,
      model: { id: options.model },
      local: { cwd }
    });

    try {
      const prompt = [
        `You are Agent 01 (QA Lead) for mobile app "${mission.appId}".`,
        `Inspect the codebase in ${cwd} and the following app specification, then design 6 to 12 high-value Manual Test Cases.`,
        `Assign each test case to one of: maestro-01..maestro-09.`,
        `Return ONLY a valid JSON array with objects: { "title", "module", "priority": "P0"|"P1"|"P2", "preconditions", "steps": string[], "expectedResult", "assignedAgentId" }.`,
        `\n--- APP SPECIFICATION ---\n${mission.specText}`
      ].join("\n");

      const run = await agent.send(prompt);
      this.emitEvent(mission.id, "qa-lead", "agent_status", `qa-lead started Cursor run ${run.id ?? ""} (agent ${agent.agentId ?? ""})`);

      let fullText = "";
      for await (const event of run.stream()) {
        if (this.aborted) {
          if (run.supports?.("cancel")) await run.cancel?.();
          return [];
        }
        if (event.type === "assistant" && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === "text" && block.text) fullText += block.text;
          }
        }
      }

      const result = await run.wait();
      if (result.status === "error") {
        throw new Error(`QA Lead Cursor run failed (${result.id ?? "unknown"})`);
      }

      const parsed = this.extractJsonArray(result.result || fullText);
      const created = this.db.createTestCases(
        mission.id,
        parsed.map((item, idx) => ({
          title: String(item.title || `Test Case ${idx + 1}`),
          module: String(item.module || "Core"),
          priority: (["P0", "P1", "P2"].includes(String(item.priority)) ? item.priority : "P1") as "P0" | "P1" | "P2",
          preconditions: String(item.preconditions || ""),
          steps: Array.isArray(item.steps) ? item.steps.map(String) : ["Open app", "Execute flow"],
          expectedResult: String(item.expectedResult || "Flow succeeds"),
          assignedAgentId: String(item.assignedAgentId || `maestro-0${(idx % 9) + 1}`),
          maxRetries: options.maxRetries
        }))
      );

      for (const tc of created) {
        this.hub.broadcast({ type: "test_case_update", payload: tc });
        if (tc.assignedAgentId) {
          this.hub.broadcast({
            type: "handoff",
            payload: { fromAgentId: "qa-lead", toAgentId: tc.assignedAgentId, label: tc.code }
          });
        }
      }

      this.setAgent(mission.id, "qa-lead", "done", "lounge", `Created ${created.length} manual cases`, "done");
      return created;
    } finally {
      await agent[Symbol.asyncDispose]();
    }
  }

  private async runEngineerWorker(
    sdk: CursorSdkModule,
    mission: Mission,
    agentId: string,
    cwd: string,
    flowsDir: string,
    options: { apiKey: string; model: string; maxRetries: number }
  ) {
    while (!this.aborted) {
      const tc = this.db.claimNextTestCase(mission.id, agentId);
      if (!tc) {
        this.setAgent(mission.id, agentId, "done", "lounge", "All assigned flows complete", "idle", null);
        return;
      }

      this.hub.broadcast({ type: "test_case_update", payload: tc });
      this.setAgent(mission.id, agentId, "writing", "automation", `Writing ${tc.code}.yaml`, "cursor_sdk", tc.id);

      const flowPath = path.join(flowsDir, `${tc.code}.yaml`);
      const agent = await sdk.Agent.create({
        apiKey: options.apiKey,
        model: { id: options.model },
        local: { cwd }
      });

      try {
        let prompt = [
          `You are ${agentId}, a Maestro Mobile QA Automation Engineer.`,
          `Write a valid Maestro YAML test file at "${flowPath}" for appId "${mission.appId}".`,
          `Manual Test Case ${tc.code}: ${tc.title}`,
          `Preconditions: ${tc.preconditions}`,
          `Steps:\n${tc.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
          `Expected Result: ${tc.expectedResult}`,
          `Inspect the app repo for exact accessibility IDs / text labels, save the YAML file at "${flowPath}", and reply with the YAML.`
        ].join("\n");

        let passed = false;
        for (let attempt = 0; attempt <= options.maxRetries && !passed && !this.aborted; attempt++) {
          const run = await agent.send(prompt);
          const result = await run.wait();
          if (result.status === "error") {
            throw new Error(`Agent ${agentId} run failed for ${tc.code}`);
          }

          const yamlContent = fs.existsSync(flowPath) ? fs.readFileSync(flowPath, "utf8") : result.result || "";
          if (!fs.existsSync(flowPath) && yamlContent) {
            fs.writeFileSync(flowPath, this.stripCodeFence(yamlContent), "utf8");
          }

          const tcWait = this.db.updateTestCase(tc.id, {
            status: "waiting_device",
            yamlPath: flowPath,
            yamlContent: fs.existsSync(flowPath) ? fs.readFileSync(flowPath, "utf8") : yamlContent,
            retryCount: attempt
          });
          if (tcWait) this.hub.broadcast({ type: "test_case_update", payload: tcWait });

          this.setAgent(mission.id, agentId, "waiting_device", "device_lab", `Waiting device for ${tc.code}`, "wait_device", tc.id);
          const lock = await this.deviceManager.acquireLock(agentId, tc.id);

          let runRes;
          try {
            this.setAgent(mission.id, agentId, "testing", "device_lab", `maestro test ${tc.code}.yaml`, "maestro_test", tc.id);
            const tcTest = this.db.updateTestCase(tc.id, { status: "testing", deviceId: lock.deviceId });
            if (tcTest) this.hub.broadcast({ type: "test_case_update", payload: tcTest });

            runRes = await this.maestroRunner.runFlow({
              flowPath,
              deviceId: lock.deviceId,
              testCaseId: tc.id,
              onChunk: (chunk) => {
                this.hub.broadcast({
                  type: "maestro_output",
                  payload: { testCaseId: tc.id, agentId, deviceId: lock.deviceId, chunk }
                });
              }
            });
          } finally {
            lock.release();
          }

          if (runRes.passed) {
            passed = true;
            const tcPass = this.db.updateTestCase(tc.id, {
              status: "passed",
              lastError: null,
              lastLogs: runRes.logs,
              screenshotUrl: runRes.screenshotUrl
            });
            if (tcPass) this.hub.broadcast({ type: "test_case_update", payload: tcPass });
            this.db.updateAgent(agentId, { incCompleted: 1 });
            this.emitEvent(mission.id, agentId, "test_passed", `${tc.code} PASSED on ${lock.deviceId}`, {
              testCaseId: tc.id,
              deviceId: lock.deviceId
            });
          } else {
            const isFinal = attempt >= options.maxRetries;
            const tcFail = this.db.updateTestCase(tc.id, {
              status: isFinal ? "failed" : "debugging",
              lastError: `Maestro exited with code ${runRes.exitCode}`,
              lastLogs: runRes.logs,
              screenshotUrl: runRes.screenshotUrl,
              retryCount: attempt + 1
            });
            if (tcFail) this.hub.broadcast({ type: "test_case_update", payload: tcFail });

            if (isFinal) {
              this.db.updateAgent(agentId, { incFailed: 1 });
              this.emitEvent(mission.id, agentId, "test_failed", `${tc.code} FAILED after ${attempt + 1} attempts`, {
                testCaseId: tc.id
              });
            } else {
              this.db.updateAgent(agentId, { incRetries: 1 });
              this.setAgent(mission.id, agentId, "debugging", "automation", `Debugging ${tc.code}...`, "debug_yaml", tc.id);
              prompt = `Maestro test ${flowPath} FAILED on device ${lock.deviceId}.\nLogs:\n${runRes.logs.slice(-3000)}\nAnalyze the failure, fix the selectors/waits in "${flowPath}", and save the updated YAML.`;
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const tcErr = this.db.updateTestCase(tc.id, { status: "failed", lastError: msg });
        if (tcErr) this.hub.broadcast({ type: "test_case_update", payload: tcErr });
        this.db.updateAgent(agentId, { incFailed: 1 });
        this.emitEvent(mission.id, agentId, "error", `${agentId} error on ${tc.code}: ${msg}`, { testCaseId: tc.id });
      } finally {
        await agent[Symbol.asyncDispose]();
      }
    }
  }

  private extractJsonArray(raw: string): Array<Record<string, unknown>> {
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start === -1 || end === -1 || end <= start) return [];
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private stripCodeFence(text: string): string {
    return text.replace(/^```(?:yaml|yml)?\s*/i, "").replace(/```\s*$/i, "").trim() + "\n";
  }

  private setAgent(
    missionId: string,
    agentId: string,
    status: Parameters<OfficeDatabase["updateAgent"]>[1]["status"],
    zone: Parameters<OfficeDatabase["updateAgent"]>[1]["zone"],
    speech: string,
    lastTool: string,
    currentTaskId?: string | null
  ) {
    const updated = this.db.updateAgent(agentId, {
      status,
      zone,
      speech,
      lastTool,
      ...(currentTaskId !== undefined ? { currentTaskId } : {})
    });
    if (updated) this.hub.broadcast({ type: "agent_update", payload: updated });
    this.emitEvent(missionId, agentId, "agent_status", `${agentId}: ${speech}`);
  }

  private emitEvent(
    missionId: string,
    agentId: string | null,
    type: Parameters<OfficeDatabase["addEvent"]>[0]["type"],
    message: string,
    extra?: { fromAgentId?: string; toAgentId?: string; testCaseId?: string; deviceId?: string }
  ) {
    const evt = this.db.addEvent({ missionId, agentId, type, message, ...extra });
    this.hub.broadcast({ type: "event", payload: evt });
  }
}
