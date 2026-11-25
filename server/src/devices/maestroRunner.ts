import fs from "node:fs";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DeviceManager } from "./deviceManager.js";

const execFileAsync = promisify(execFile);

export interface MaestroRunResult {
  passed: boolean;
  exitCode: number;
  logs: string;
  screenshotUrl: string | null;
  durationMs: number;
}

export class MaestroRunner {
  private artifactsDir: string;

  constructor(private deviceManager: DeviceManager, artifactsDir?: string) {
    this.artifactsDir = artifactsDir || path.resolve(process.cwd(), "data", "artifacts");
    fs.mkdirSync(this.artifactsDir, { recursive: true });
  }

  getArtifactsDir() {
    return this.artifactsDir;
  }

  async runFlow(params: {
    flowPath: string;
    deviceId: string;
    testCaseId: string;
    onChunk?: (chunk: string) => void;
    timeoutMs?: number;
  }): Promise<MaestroRunResult> {
    const start = Date.now();
    const { maestroPath, adbPath, useWslMaestro } = this.deviceManager.getToolPaths();
    const timeoutMs = params.timeoutMs ?? 120_000;

    if (!fs.existsSync(params.flowPath)) {
      return {
        passed: false,
        exitCode: 1,
        logs: `Flow file not found: ${params.flowPath}`,
        screenshotUrl: null,
        durationMs: Date.now() - start
      };
    }

    const command = useWslMaestro ? "wsl" : maestroPath;
    const wslFlowPath = useWslMaestro ? this.toWslPath(params.flowPath) : params.flowPath;
    const args = useWslMaestro
      ? ["maestro", "--device", params.deviceId, "test", wslFlowPath]
      : ["--device", params.deviceId, "test", params.flowPath];

    let logs = `$ ${command} ${args.join(" ")}\n`;
    params.onChunk?.(logs);

    const javaHome = this.deviceManager.detectJavaHome();
    const adbDir = path.isAbsolute(adbPath) ? path.dirname(adbPath) : "";
    const extraPaths = [javaHome ? path.join(javaHome, "bin") : "", adbDir].filter(Boolean);
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ...(javaHome ? { JAVA_HOME: javaHome } : {}),
      PATH: [...extraPaths, process.env.PATH || ""].filter(Boolean).join(path.delimiter),
      MAESTRO_CLI_NO_ANALYTICS: "true",
      MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: "true"
    };

    const exitCode = await new Promise<number>((resolve) => {
      const child = spawn(command, args, {
        shell: process.platform === "win32" && !useWslMaestro,
        env: childEnv
      });

      const timer = setTimeout(() => {
        logs += `\n[TIMEOUT] Maestro execution exceeded ${timeoutMs}ms\n`;
        child.kill("SIGTERM");
      }, timeoutMs);

      child.stdout.on("data", (d) => {
        const text = d.toString();
        logs += text;
        params.onChunk?.(text);
      });

      child.stderr.on("data", (d) => {
        const text = d.toString();
        logs += text;
        params.onChunk?.(text);
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        const text = `\n[SPAWN ERROR] ${err.message}\n`;
        logs += text;
        params.onChunk?.(text);
        resolve(1);
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        resolve(code ?? 1);
      });
    });

    const passed = exitCode === 0;
    let screenshotUrl: string | null = null;

    if (!passed && !params.deviceId.startsWith("sim-")) {
      screenshotUrl = await this.captureFailureScreenshot(adbPath, params.deviceId, params.testCaseId);
    }

    return {
      passed,
      exitCode,
      logs,
      screenshotUrl,
      durationMs: Date.now() - start
    };
  }

  private async captureFailureScreenshot(
    adbPath: string,
    deviceId: string,
    testCaseId: string
  ): Promise<string | null> {
    try {
      const fileName = `${testCaseId}-${Date.now()}.png`;
      const outPath = path.join(this.artifactsDir, fileName);
      const { stdout } = await execFileAsync(adbPath, ["-s", deviceId, "exec-out", "screencap", "-p"], {
        encoding: "buffer",
        maxBuffer: 25 * 1024 * 1024,
        timeout: 10_000
      });
      if (stdout && stdout.length > 0) {
        fs.writeFileSync(outPath, stdout);
        return `/artifacts/${fileName}`;
      }
    } catch {
      // screenshot optional
    }
    return null;
  }

  private toWslPath(winPath: string): string {
    const resolved = path.resolve(winPath).replace(/\\/g, "/");
    const match = resolved.match(/^([A-Za-z]):\/(.*)$/);
    if (!match) return resolved;
    return `/mnt/${match[1].toLowerCase()}/${match[2]}`;
  }
}
