#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_BASE = process.env.MAESTRO_OFFICE_URL || "http://localhost:4800";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {})
    }
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Maestro Office API ${res.status}: ${text}`);
  }
  return JSON.parse(text) as T;
}

const server = new McpServer({
  name: "maestro-qa-office",
  version: "1.0.0"
});

server.tool(
  "qa_get_mission",
  "Get the active Maestro QA mission, app specification, test cases, and 10-agent roster status.",
  {},
  async () => {
    const snapshot = await api("/api/snapshot");
    return {
      content: [{ type: "text", text: JSON.stringify(snapshot, null, 2) }]
    };
  }
);

server.tool(
  "qa_report_status",
  "Update an AI agent's live status, zone, and speech bubble in the 2D Pixel-Art QA Office.",
  {
    agentId: z.string().describe("Agent ID: qa-lead or maestro-01..maestro-09"),
    status: z.enum(["idle", "analyzing", "writing", "waiting_device", "testing", "debugging", "handoff", "done", "error"]),
    speech: z.string().describe("Short status text shown in the pixel speech bubble (<= 80 chars)"),
    lastTool: z.string().optional().describe("Tool or command name currently running"),
    currentTaskId: z.string().nullable().optional()
  },
  async (args) => {
    const data = await api(`/api/agents/${encodeURIComponent(args.agentId)}/status`, {
      method: "POST",
      body: JSON.stringify(args)
    });
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }]
    };
  }
);

server.tool(
  "qa_submit_manual_cases",
  "Used by Agent 01 (qa-lead) to publish Manual Test Cases after reviewing the app codebase and specification. Automatically dispatches handoff animations to maestro-01..maestro-09.",
  {
    missionId: z.string().optional().describe("Mission ID (defaults to latest active mission)"),
    cases: z.array(
      z.object({
        title: z.string(),
        module: z.string(),
        priority: z.enum(["P0", "P1", "P2"]).default("P1"),
        preconditions: z.string().default(""),
        steps: z.array(z.string()),
        expectedResult: z.string(),
        assignedAgentId: z.string().optional().describe("maestro-01..maestro-09")
      })
    )
  },
  async (args) => {
    const data = await api("/api/mcp/manual-cases", {
      method: "POST",
      body: JSON.stringify(args)
    });
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }]
    };
  }
);

server.tool(
  "qa_claim_test_case",
  "Used by one of the 9 Maestro Engineers (maestro-01..maestro-09) to claim their next Manual Test Case to automate.",
  {
    agentId: z.string().describe("maestro-01..maestro-09"),
    missionId: z.string().optional()
  },
  async (args) => {
    const data = await api("/api/mcp/claim-case", {
      method: "POST",
      body: JSON.stringify(args)
    });
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }]
    };
  }
);

server.tool(
  "qa_run_maestro",
  "Acquire a device lock from the Device Lab queue, execute a Maestro YAML flow on a connected/hosted device, stream logs to the Pixel Office, release the lock, and return pass/fail result + logs + screenshot path.",
  {
    agentId: z.string().describe("maestro-01..maestro-09"),
    testCaseId: z.string().describe("Test case ID"),
    flowPath: z.string().describe("Absolute path to the Maestro .yaml flow file"),
    yamlContent: z.string().optional().describe("Optional YAML content to save to flowPath before running"),
    deviceId: z.string().optional().describe("Optional preferred ADB device ID")
  },
  async (args) => {
    const data = await api("/api/mcp/run-maestro", {
      method: "POST",
      body: JSON.stringify(args)
    });
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }]
    };
  }
);

server.tool(
  "qa_complete_test_case",
  "Mark a test case as passed or failed with final summary and YAML path.",
  {
    agentId: z.string(),
    testCaseId: z.string(),
    status: z.enum(["passed", "failed"]),
    summary: z.string().optional()
  },
  async (args) => {
    const data = await api("/api/mcp/complete-case", {
      method: "POST",
      body: JSON.stringify(args)
    });
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }]
    };
  }
);

server.tool(
  "qa_list_devices",
  "List connected ADB/hosted devices, active locks, and queue depth in the Device Lab.",
  {},
  async () => {
    const data = await api("/api/devices");
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }]
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
