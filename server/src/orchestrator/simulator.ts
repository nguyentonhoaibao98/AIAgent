import fs from "node:fs";
import path from "node:path";
import type { Mission, TestCase } from "@maestro-office/shared";
import type { OfficeDatabase } from "../db/database.js";
import type { DeviceManager } from "../devices/deviceManager.js";
import type { WsHub } from "../ws/hub.js";

const SAMPLE_MANUAL_CASES: Array<{
  title: string;
  module: string;
  priority: "P0" | "P1" | "P2";
  assignedAgentId: string;
  preconditions: string;
  steps: string[];
  expectedResult: string;
  yamlTemplate: (appId: string, fixed?: boolean) => string;
  failOnce?: boolean;
}> = [
  {
    title: "Sign in with valid email & password",
    module: "Auth",
    priority: "P0",
    assignedAgentId: "maestro-01",
    preconditions: "User is logged out on Login screen",
    steps: ["Launch app", "Tap email field & input qa@demo.app", "Input password", "Tap Sign In", "Verify Home screen"],
    expectedResult: "User lands on Home dashboard with welcome banner",
    yamlTemplate: (appId) => `appId: ${appId}\n---\n- launchApp:\n    clearState: true\n- tapOn:\n    id: "email_input"\n- inputText: "qa@demo.app"\n- tapOn:\n    id: "password_input"\n- inputText: "Secret123!"\n- tapOn: "Sign In"\n- assertVisible: "Home"\n`
  },
  {
    title: "Bottom tab navigation across all main tabs",
    module: "Navigation",
    priority: "P0",
    assignedAgentId: "maestro-02",
    preconditions: "User is authenticated",
    steps: ["Tap Explore tab", "Verify Explore header", "Tap Cart tab", "Tap Profile tab"],
    expectedResult: "All primary navigation tabs render without crash",
    yamlTemplate: (appId) => `appId: ${appId}\n---\n- launchApp\n- tapOn: "Explore"\n- assertVisible: "Featured"\n- tapOn: "Cart"\n- assertVisible: "Your Cart"\n- tapOn: "Profile"\n- assertVisible: "Account"\n`
  },
  {
    title: "Form validation blocks empty & invalid email submission",
    module: "Forms",
    priority: "P1",
    assignedAgentId: "maestro-03",
    preconditions: "On Sign Up screen",
    steps: ["Tap Create Account with empty fields", "Verify inline errors", "Type invalid email", "Verify format error"],
    expectedResult: "Validation messages appear and prevent submission",
    failOnce: true,
    yamlTemplate: (appId, fixed) =>
      `appId: ${appId}\n---\n- launchApp\n- tapOn: "Create Account"\n- assertVisible: "${fixed ? "Email is required" : "Required field"}"\n- tapOn:\n    id: "email_input"\n- inputText: "bad-email"\n- tapOn: "Submit"\n- assertVisible: "Invalid email format"\n`
  },
  {
    title: "Search catalog & filter by price range",
    module: "Search",
    priority: "P0",
    assignedAgentId: "maestro-04",
    preconditions: "Home screen loaded with products",
    steps: ["Tap search bar", "Type 'Sneakers'", "Open Filter sheet", "Select Under $100", "Apply filter"],
    expectedResult: "Filtered product list shows matching sneakers under $100",
    yamlTemplate: (appId) => `appId: ${appId}\n---\n- launchApp\n- tapOn:\n    id: "search_bar"\n- inputText: "Sneakers"\n- pressKey: Enter\n- tapOn: "Filter"\n- tapOn: "Under $100"\n- tapOn: "Apply"\n- assertVisible: "Sneakers"\n`
  },
  {
    title: "Add item to cart and complete checkout",
    module: "Checkout",
    priority: "P0",
    assignedAgentId: "maestro-05",
    preconditions: "Product detail screen open",
    steps: ["Tap Add to Cart", "Open Cart", "Tap Checkout", "Confirm Order", "Verify Order Confirmation"],
    expectedResult: "Order confirmation screen displays order ID",
    failOnce: true,
    yamlTemplate: (appId, fixed) =>
      `appId: ${appId}\n---\n- launchApp\n- tapOn: "Add to Cart"\n- tapOn:\n    id: "${fixed ? "cart_fab_btn" : "cart_button"}"\n- tapOn: "Checkout"\n- tapOn: "Confirm Order"\n- assertVisible: "Order Confirmed"\n`
  },
  {
    title: "Update display name and toggle dark mode in Settings",
    module: "Profile",
    priority: "P1",
    assignedAgentId: "maestro-06",
    preconditions: "Logged in on Profile tab",
    steps: ["Open Edit Profile", "Change name to QA Tester", "Save", "Toggle Dark Mode"],
    expectedResult: "Updated name persists and theme toggles cleanly",
    yamlTemplate: (appId) => `appId: ${appId}\n---\n- launchApp\n- tapOn: "Profile"\n- tapOn: "Edit Profile"\n- tapOn:\n    id: "display_name_input"\n- eraseText: 20\n- inputText: "QA Tester"\n- tapOn: "Save"\n- assertVisible: "QA Tester"\n`
  },
  {
    title: "Graceful offline banner and retry button",
    module: "Edge Cases",
    priority: "P1",
    assignedAgentId: "maestro-07",
    preconditions: "Network toggled offline",
    steps: ["Disable network", "Pull to refresh feed", "Verify Offline Banner", "Tap Retry"],
    expectedResult: "App stays responsive and shows clear offline retry state",
    yamlTemplate: (appId) => `appId: ${appId}\n---\n- launchApp\n- swipe:\n    direction: DOWN\n- assertVisible: "No internet connection"\n- tapOn: "Retry"\n`
  },
  {
    title: "Deep link opens product detail screen directly",
    module: "Deep Links",
    priority: "P1",
    assignedAgentId: "maestro-08",
    preconditions: "App installed on device",
    steps: ["Open deep link myapp://product/42", "Wait for load", "Verify Product #42 title"],
    expectedResult: "Deep link routes directly to Product #42",
    yamlTemplate: (appId) => `appId: ${appId}\n---\n- openLink: "myapp://product/42"\n- extendedWaitUntil:\n    visible: "Product #42"\n    timeout: 8000\n`
  },
  {
    title: "Full smoke test: launch -> browse -> logout",
    module: "Regression",
    priority: "P0",
    assignedAgentId: "maestro-09",
    preconditions: "Fresh app launch",
    steps: ["Launch app", "Verify Home", "Open Profile", "Tap Sign Out", "Verify Login screen"],
    expectedResult: "User cleanly returns to Login screen after sign out",
    yamlTemplate: (appId) => `appId: ${appId}\n---\n- launchApp\n- assertVisible: "Home"\n- tapOn: "Profile"\n- scrollUntilVisible:\n    element: "Sign Out"\n- tapOn: "Sign Out"\n- assertVisible: "Sign In"\n`
  }
];

export class MissionSimulator {
  private aborted = false;
  private running = false;

  constructor(
    private db: OfficeDatabase,
    private hub: WsHub,
    private deviceManager: DeviceManager
  ) {}

  isRunning() {
    return this.running;
  }

  stop() {
    this.aborted = true;
    this.running = false;
  }

  async run(mission: Mission) {
    this.aborted = false;
    this.running = true;
    this.deviceManager.ensureSimulatedDevices(2);

    const sleep = (ms: number) =>
      new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => {
          if (this.aborted) reject(new Error("Simulation aborted"));
          else resolve();
        }, ms);
        t.unref?.();
      });

    try {
      // Phase 1: Agent 01 (QA Lead) analyzes app + spec
      this.setAgent(mission.id, "qa-lead", "analyzing", "planning", "Scanning app screens & spec...", "read_spec");
      await sleep(1600);

      this.setAgent(
        mission.id,
        "qa-lead",
        "writing",
        "planning",
        "Drafting 9 Manual Test Cases...",
        "write_manual_cases"
      );
      await sleep(1600);

      const createdCases = this.db.createTestCases(
        mission.id,
        SAMPLE_MANUAL_CASES.map((s) => ({
          title: s.title,
          module: s.module,
          priority: s.priority,
          preconditions: s.preconditions,
          steps: s.steps,
          expectedResult: s.expectedResult,
          assignedAgentId: s.assignedAgentId
        }))
      );

      for (const tc of createdCases) {
        this.hub.broadcast({ type: "test_case_update", payload: tc });
      }

      this.emitEvent(mission.id, "qa-lead", "manual_cases_created", `QA Lead created ${createdCases.length} manual test cases.`);

      // Handoff animations from Agent 01 -> 9 Maestro Engineers
      this.setAgent(mission.id, "qa-lead", "handoff", "planning", "Dispatching test cases to 9 engineers", "dispatch");
      for (const tc of createdCases) {
        if (this.aborted) return;
        if (tc.assignedAgentId) {
          this.hub.broadcast({
            type: "handoff",
            payload: { fromAgentId: "qa-lead", toAgentId: tc.assignedAgentId, label: tc.code }
          });
          this.emitEvent(
            mission.id,
            "qa-lead",
            "handoff",
            `Dispatched ${tc.code} (${tc.module}) to ${tc.assignedAgentId}`,
            { fromAgentId: "qa-lead", toAgentId: tc.assignedAgentId, testCaseId: tc.id }
          );
          await sleep(180);
        }
      }

      this.setAgent(mission.id, "qa-lead", "done", "lounge", "Manual plan ready. Monitoring lab.", "monitor");
      const updatedMission = this.db.updateMission(mission.id, { status: "executing" });
      if (updatedMission) this.hub.broadcast({ type: "mission_update", payload: updatedMission });

      // Phase 2: 9 Maestro Engineers work concurrently on writing YAML, then take turns on Device Lab
      const flowsDir = path.resolve(mission.flowsDir || path.join(process.cwd(), "data", "flows", mission.id));
      fs.mkdirSync(flowsDir, { recursive: true });

      await Promise.all(
        createdCases.map(async (tc, index) => {
          const spec = SAMPLE_MANUAL_CASES[index];
          const agentId = tc.assignedAgentId || `maestro-0${(index % 9) + 1}`;
          await sleep(300 + index * 250);
          await this.runEngineerFlow(mission, tc, agentId, spec, flowsDir, sleep);
        })
      );

      if (!this.aborted) {
        const finalMission = this.db.updateMission(mission.id, {
          status: "completed",
          summary: `Completed ${createdCases.length} Maestro automation flows with verification.`
        });
        if (finalMission) this.hub.broadcast({ type: "mission_update", payload: finalMission });
        this.emitEvent(mission.id, null, "mission_completed", "All 10 agents completed the Maestro QA mission.");
      }
    } catch (err) {
      if (!this.aborted) {
        this.emitEvent(mission.id, null, "error", `Simulation error: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      this.running = false;
    }
  }

  private async runEngineerFlow(
    mission: Mission,
    tc: TestCase,
    agentId: string,
    spec: (typeof SAMPLE_MANUAL_CASES)[number],
    flowsDir: string,
    sleep: (ms: number) => Promise<void>
  ) {
    const filePath = path.join(flowsDir, `${tc.code}.yaml`);

    // 1. Write Maestro YAML
    this.setAgent(mission.id, agentId, "writing", "automation", `Writing ${tc.code}.yaml`, "write_yaml", tc.id);
    const tcWriting = this.db.updateTestCase(tc.id, { status: "writing_yaml", assignedAgentId: agentId });
    if (tcWriting) this.hub.broadcast({ type: "test_case_update", payload: tcWriting });

    await sleep(1200 + Math.floor(Math.random() * 1400));

    let attempt = 0;
    let passed = false;

    while (!passed && attempt <= tc.maxRetries) {
      if (this.aborted) return;
      attempt += 1;
      const isFixed = attempt > 1;
      const yaml = spec.yamlTemplate(mission.appId, isFixed);
      fs.writeFileSync(filePath, yaml, "utf8");

      const tcQueued = this.db.updateTestCase(tc.id, {
        status: "waiting_device",
        yamlPath: filePath,
        yamlContent: yaml,
        retryCount: attempt - 1
      });
      if (tcQueued) this.hub.broadcast({ type: "test_case_update", payload: tcQueued });

      // 2. Wait for Device Lock in Device Lab
      this.setAgent(mission.id, agentId, "waiting_device", "device_lab", `Queueing device for ${tc.code}`, "wait_device", tc.id);
      const lock = await this.deviceManager.acquireLock(agentId, tc.id);

      try {
        this.emitEvent(mission.id, agentId, "device_lock", `${agentId} acquired device ${lock.deviceId} for ${tc.code}`, {
          testCaseId: tc.id,
          deviceId: lock.deviceId
        });

        this.setAgent(
          mission.id,
          agentId,
          "testing",
          "device_lab",
          `maestro test ${tc.code}.yaml`,
          "maestro_test",
          tc.id
        );
        const tcTesting = this.db.updateTestCase(tc.id, { status: "testing", deviceId: lock.deviceId });
        if (tcTesting) this.hub.broadcast({ type: "test_case_update", payload: tcTesting });

        const willFail = Boolean(spec.failOnce && attempt === 1);
        const logLines = [
          `$ maestro --device ${lock.deviceId} test ${tc.code}.yaml`,
          `Waiting for flows to complete on ${lock.deviceId}...`,
          `[>] Running Flow: ${tc.title}`,
          `  ✓ launchApp (${mission.appId})`,
          ...(willFail
            ? [
                `  ✗ Assertion failed: Element not found on screen (timeout 5000ms)`,
                `  [FAIL] ${tc.code} exited with code 1`
              ]
            : [
                `  ✓ Executed ${tc.steps.length} UI steps`,
                `  ✓ Verified: ${tc.expectedResult}`,
                `  [PASS] ${tc.code} completed in 2.4s`
              ])
        ];

        let accumulated = "";
        for (const line of logLines) {
          if (this.aborted) return;
          accumulated += line + "\n";
          this.hub.broadcast({
            type: "maestro_output",
            payload: { testCaseId: tc.id, agentId, deviceId: lock.deviceId, chunk: line + "\n" }
          });
          await sleep(380);
        }

        if (willFail) {
          const tcFail = this.db.updateTestCase(tc.id, {
            status: "debugging",
            lastError: "Element selector mismatch on device screen",
            lastLogs: accumulated,
            retryCount: attempt
          });
          if (tcFail) this.hub.broadcast({ type: "test_case_update", payload: tcFail });
          this.emitEvent(mission.id, agentId, "test_failed", `${tc.code} failed on ${lock.deviceId}, starting debug loop`, {
            testCaseId: tc.id,
            deviceId: lock.deviceId
          });
        } else {
          passed = true;
          const tcPass = this.db.updateTestCase(tc.id, {
            status: "passed",
            lastError: null,
            lastLogs: accumulated
          });
          if (tcPass) this.hub.broadcast({ type: "test_case_update", payload: tcPass });
          this.db.updateAgent(agentId, { incCompleted: 1 });
          this.emitEvent(mission.id, agentId, "test_passed", `${tc.code} PASSED on ${lock.deviceId}`, {
            testCaseId: tc.id,
            deviceId: lock.deviceId
          });
        }
      } finally {
        lock.release();
        this.emitEvent(mission.id, agentId, "device_unlock", `${agentId} released device ${lock.deviceId}`, {
          testCaseId: tc.id,
          deviceId: lock.deviceId
        });
      }

      if (!passed) {
        // 3. Walk back to Automation Wing desk to debug & patch YAML
        this.db.updateAgent(agentId, { incRetries: 1 });
        this.setAgent(
          mission.id,
          agentId,
          "debugging",
          "automation",
          `Debugging ${tc.code} selector...`,
          "debug_yaml",
          tc.id
        );
        await sleep(1600);
      }
    }

    this.setAgent(mission.id, agentId, "done", "lounge", `${tc.code} verified!`, "idle", null);
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
    if (updated) {
      this.hub.broadcast({ type: "agent_update", payload: updated });
    }
    this.emitEvent(missionId, agentId, "agent_status", `${agentId}: ${speech}`);
  }

  private emitEvent(
    missionId: string,
    agentId: string | null,
    type: Parameters<OfficeDatabase["addEvent"]>[0]["type"],
    message: string,
    extra?: { fromAgentId?: string; toAgentId?: string; testCaseId?: string; deviceId?: string }
  ) {
    const evt = this.db.addEvent({
      missionId,
      agentId,
      type,
      message,
      ...extra
    });
    this.hub.broadcast({ type: "event", payload: evt });
  }
}
