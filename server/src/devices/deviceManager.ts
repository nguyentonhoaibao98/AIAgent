import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DeviceInfo } from "@maestro-office/shared";

const execFileAsync = promisify(execFile);

interface QueueWaiter {
  agentId: string;
  testCaseId: string;
  enqueuedAt: string;
  preferredDeviceId?: string;
  resolve: (lock: DeviceLock) => void;
  reject: (err: Error) => void;
}

export interface DeviceLock {
  deviceId: string;
  release: () => void;
}

export class DeviceManager {
  private devices = new Map<string, DeviceInfo>();
  private waiters: QueueWaiter[] = [];
  private adbPath = "";
  private maestroPath = "";
  private useWslMaestro = false;
  private onChange?: (devices: DeviceInfo[]) => void;
  private pollTimer?: NodeJS.Timeout;

  constructor(onChange?: (devices: DeviceInfo[]) => void) {
    this.onChange = onChange;
    this.adbPath = this.detectAdbPath();
    this.maestroPath = this.detectMaestroPath();
  }

  configure(opts: { adbPath?: string; maestroPath?: string; useWslMaestro?: boolean }) {
    if (opts.adbPath !== undefined) this.adbPath = opts.adbPath.trim() || this.detectAdbPath();
    if (opts.maestroPath !== undefined) this.maestroPath = opts.maestroPath.trim() || this.detectMaestroPath();
    if (opts.useWslMaestro !== undefined) this.useWslMaestro = opts.useWslMaestro;
  }

  getToolPaths() {
    return {
      adbPath: this.adbPath,
      maestroPath: this.maestroPath,
      useWslMaestro: this.useWslMaestro,
      adbDetected: Boolean(this.adbPath && this.isExecutableAvailable(this.adbPath)),
      maestroDetected: Boolean(this.maestroPath && (this.useWslMaestro || this.isExecutableAvailable(this.maestroPath)))
    };
  }

  private detectAdbPath(): string {
    const candidates = [
      process.env.ADB_PATH,
      path.join(process.env.LOCALAPPDATA || "", "Android", "Sdk", "platform-tools", "adb.exe"),
      path.join(os.homedir(), "AppData", "Local", "Android", "Sdk", "platform-tools", "adb.exe"),
      path.join(os.homedir(), "Android", "Sdk", "platform-tools", "adb"),
      "adb"
    ].filter(Boolean) as string[];

    for (const c of candidates) {
      if (c === "adb") return "adb";
      if (fs.existsSync(c)) return c;
    }
    return "adb";
  }

  private detectMaestroPath(): string {
    const candidates = [
      process.env.MAESTRO_PATH,
      path.join(process.env.LOCALAPPDATA || "", "maestro", "maestro", "bin", "maestro.bat"),
      path.join(process.env.LOCALAPPDATA || "", "maestro", "bin", "maestro.bat"),
      path.join(os.homedir(), ".maestro", "bin", "maestro.bat"),
      path.join(os.homedir(), ".maestro", "bin", "maestro"),
      "maestro"
    ].filter(Boolean) as string[];

    for (const c of candidates) {
      if (c === "maestro") return "maestro";
      if (fs.existsSync(c)) return c;
    }
    return "maestro";
  }

  detectJavaHome(): string | null {
    const candidates = [
      process.env.JAVA_HOME,
      "C:\\Program Files\\Android\\Android Studio\\jbr",
      "C:\\Program Files\\Android\\Android Studio\\jre"
    ].filter(Boolean) as string[];

    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return null;
  }

  private isExecutableAvailable(bin: string): boolean {
    if (path.isAbsolute(bin)) {
      return fs.existsSync(bin);
    }
    const envPath = process.env.PATH || "";
    const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
    for (const dir of envPath.split(path.delimiter)) {
      for (const ext of exts) {
        if (fs.existsSync(path.join(dir, bin + ext))) return true;
      }
    }
    return false;
  }

  startPolling(intervalMs = 5000) {
    this.refreshDevices().catch(() => {});
    this.pollTimer = setInterval(() => {
      this.refreshDevices().catch(() => {});
    }, intervalMs);
  }

  stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  async connectTcpDevice(hostPort: string): Promise<{ ok: boolean; output: string }> {
    try {
      const { stdout, stderr } = await execFileAsync(this.adbPath, ["connect", hostPort], { timeout: 8000 });
      await this.refreshDevices();
      return { ok: true, output: (stdout + "\n" + stderr).trim() };
    } catch (err) {
      return { ok: false, output: err instanceof Error ? err.message : String(err) };
    }
  }

  ensureSimulatedDevices(count = 2) {
    const hasReal = Array.from(this.devices.values()).some((d) => d.connection !== "simulated");
    if (hasReal) return;

    const presets: Array<{ id: string; name: string }> = [
      { id: "sim-pixel-9-pro", name: "Pixel 9 Pro (Lab Slot #1)" },
      { id: "sim-galaxy-s25", name: "Galaxy S25 Ultra (Lab Slot #2)" }
    ];

    for (let i = 0; i < Math.min(count, presets.length); i++) {
      const p = presets[i];
      if (!this.devices.has(p.id)) {
        this.devices.set(p.id, {
          id: p.id,
          name: p.name,
          platform: "virtual",
          connection: "simulated",
          state: "online",
          lockedByAgentId: null,
          lockedTestCaseId: null,
          queue: []
        });
      }
    }
    this.emitChange();
  }

  clearSimulatedDevices() {
    let changed = false;
    for (const [id, d] of this.devices.entries()) {
      if (d.connection === "simulated" && !d.lockedByAgentId) {
        this.devices.delete(id);
        changed = true;
      }
    }
    if (changed) this.emitChange();
  }

  async refreshDevices(): Promise<DeviceInfo[]> {
    const seenRealIds = new Set<string>();
    try {
      const { stdout } = await execFileAsync(this.adbPath, ["devices", "-l"], { timeout: 4000 });
      const lines = stdout.split(/\r?\n/).slice(1);
      for (const raw of lines) {
        const line = raw.trim();
        if (!line || !line.includes("device")) continue;
        const parts = line.split(/\s+/);
        const id = parts[0];
        const status = parts[1];
        if (!id || status !== "device") continue;

        seenRealIds.add(id);
        const modelPart = parts.find((p) => p.startsWith("model:"));
        const name = modelPart ? modelPart.replace("model:", "").replace(/_/g, " ") : id;
        const connection: DeviceInfo["connection"] = id.startsWith("emulator-")
          ? "emulator"
          : id.includes(":")
            ? "tcp"
            : "usb";

        const existing = this.devices.get(id);
        if (existing) {
          existing.name = name;
          existing.state = existing.lockedByAgentId ? "busy" : "online";
        } else {
          this.devices.set(id, {
            id,
            name,
            platform: "android",
            connection,
            state: "online",
            lockedByAgentId: null,
            lockedTestCaseId: null,
            queue: []
          });
        }
      }
    } catch {
      // adb not available or no devices
    }

    // Mark missing real devices offline if unlocked, or remove them
    for (const [id, d] of this.devices.entries()) {
      if (d.connection !== "simulated" && !seenRealIds.has(id)) {
        if (!d.lockedByAgentId) {
          this.devices.delete(id);
        } else {
          d.state = "offline";
        }
      }
    }

    this.emitChange();
    return this.listDevices();
  }

  listDevices(): DeviceInfo[] {
    return Array.from(this.devices.values()).map((d) => ({
      ...d,
      queue: this.waiters
        .filter((w) => !w.preferredDeviceId || w.preferredDeviceId === d.id)
        .map((w) => ({
          agentId: w.agentId,
          testCaseId: w.testCaseId,
          enqueuedAt: w.enqueuedAt
        }))
    }));
  }

  acquireLock(agentId: string, testCaseId: string, preferredDeviceId?: string): Promise<DeviceLock> {
    const freeDevice = this.findFreeDevice(preferredDeviceId);
    if (freeDevice) {
      return Promise.resolve(this.grantLock(freeDevice, agentId, testCaseId));
    }

    return new Promise<DeviceLock>((resolve, reject) => {
      this.waiters.push({
        agentId,
        testCaseId,
        enqueuedAt: new Date().toISOString(),
        preferredDeviceId,
        resolve,
        reject
      });
      this.emitChange();
    });
  }

  cancelWaitersForMission() {
    const pending = this.waiters.splice(0, this.waiters.length);
    for (const w of pending) {
      w.reject(new Error("Mission stopped while waiting for device lock"));
    }
    for (const d of this.devices.values()) {
      d.lockedByAgentId = null;
      d.lockedTestCaseId = null;
      if (d.state === "busy") d.state = "online";
    }
    this.emitChange();
  }

  private findFreeDevice(preferredDeviceId?: string): DeviceInfo | null {
    if (preferredDeviceId) {
      const target = this.devices.get(preferredDeviceId);
      if (target && target.state === "online" && !target.lockedByAgentId) return target;
      return null;
    }
    for (const d of this.devices.values()) {
      if (d.state === "online" && !d.lockedByAgentId) return d;
    }
    return null;
  }

  private grantLock(device: DeviceInfo, agentId: string, testCaseId: string): DeviceLock {
    device.lockedByAgentId = agentId;
    device.lockedTestCaseId = testCaseId;
    device.state = "busy";
    this.emitChange();

    let released = false;
    return {
      deviceId: device.id,
      release: () => {
        if (released) return;
        released = true;
        device.lockedByAgentId = null;
        device.lockedTestCaseId = null;
        device.state = "online";
        this.dispatchNextWaiter(device);
        this.emitChange();
      }
    };
  }

  private dispatchNextWaiter(device: DeviceInfo) {
    const idx = this.waiters.findIndex((w) => !w.preferredDeviceId || w.preferredDeviceId === device.id);
    if (idx === -1) return;
    const [next] = this.waiters.splice(idx, 1);
    const lock = this.grantLock(device, next.agentId, next.testCaseId);
    next.resolve(lock);
  }

  private emitChange() {
    this.onChange?.(this.listDevices());
  }
}
