import path from "node:path";
import { promises as fs } from "node:fs";
import { createInitialState } from "./tree-state.js";

function pad(number) {
  return `${number}`.padStart(2, "0");
}

function timestampForFile(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(
    date.getMinutes()
  )}-${pad(date.getSeconds())}`;
}

function escapeTitle(title) {
  return `${title ?? ""}`.replaceAll('"', '\\"');
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export class SessionStore {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.activePath = path.join(baseDir, "active.json");
    this.eventsPath = null;
    this.pendingState = null;
    this.flushTimer = null;
    this.flushDelayMs = 250;
    this.sessionId = null;
  }

  static createSessionId() {
    return timestampForFile();
  }

  async ensureDir() {
    await fs.mkdir(this.baseDir, { recursive: true });
  }

  async archivePreviousActive() {
    try {
      await fs.access(this.activePath);
    } catch {
      return;
    }

    const snapshotBase = `${timestampForFile()}.snapshot.json`;
    let snapshotName = snapshotBase;
    let index = 1;

    while (true) {
      const candidate = path.join(this.baseDir, snapshotName);
      try {
        await fs.access(candidate);
        snapshotName = `${snapshotBase.replace(".snapshot.json", "")}-${index}.snapshot.json`;
        index += 1;
      } catch {
        await fs.rename(this.activePath, candidate);
        break;
      }
    }
  }

  async initSession() {
    await this.ensureDir();
    await this.archivePreviousActive();

    const baseSessionId = SessionStore.createSessionId();
    let sessionId = baseSessionId;
    let suffix = 1;

    while (true) {
      const candidate = path.join(this.baseDir, `${sessionId}.events.log`);
      try {
        await fs.access(candidate);
        sessionId = `${baseSessionId}-${suffix}`;
        suffix += 1;
      } catch {
        this.sessionId = sessionId;
        this.eventsPath = candidate;
        break;
      }
    }

    const state = createInitialState(this.sessionId);
    await this.writeStateNow(state);
    await this.appendEvent("SESSION_START", {
      nodeId: state.rootId,
      parentId: "none",
      title: "Session Root"
    });
    return state;
  }

  async writeStateNow(state) {
    const serialized = `${JSON.stringify(state, null, 2)}\n`;
    const tempPath = `${this.activePath}.tmp`;
    await fs.writeFile(tempPath, serialized, "utf8");
    try {
      await fs.rename(tempPath, this.activePath);
    } catch (error) {
      if (error && (error.code === "EEXIST" || error.code === "EPERM")) {
        await fs.rm(this.activePath, { force: true });
        await fs.rename(tempPath, this.activePath);
      } else {
        throw error;
      }
    }
  }

  scheduleStateWrite(state) {
    this.pendingState = deepClone(state);
    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setTimeout(async () => {
      this.flushTimer = null;
      const nextState = this.pendingState;
      this.pendingState = null;
      if (!nextState) {
        return;
      }
      try {
        await this.writeStateNow(nextState);
      } catch (error) {
        console.error("State write failed:", error);
      }
    }, this.flushDelayMs);
  }

  async flushPendingState() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.pendingState) {
      return;
    }
    const nextState = this.pendingState;
    this.pendingState = null;
    await this.writeStateNow(nextState);
  }

  buildEventLine(action, details = {}) {
    const timestamp = new Date().toISOString();
    const nodeId = details.nodeId ?? "none";
    const parentId = details.parentId ?? "none";
    const title = escapeTitle(details.title ?? "");
    const extra = details.extra ? ` ${details.extra}` : "";
    return `[${timestamp}] ${action} nodeId=${nodeId} parentId=${parentId} title="${title}"${extra}`;
  }

  async appendEvent(action, details = {}) {
    if (!this.eventsPath) {
      return;
    }
    const line = this.buildEventLine(action, details);
    try {
      await fs.appendFile(this.eventsPath, `${line}\n`, "utf8");
    } catch (error) {
      console.error("Event log write failed:", error);
    }
  }

  async listSessions() {
    await this.ensureDir();
    const entries = await fs.readdir(this.baseDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".events.log"))
      .map((entry) => entry.name.replace(".events.log", ""))
      .sort((left, right) => right.localeCompare(left));
  }

  async readEvents(sessionId) {
    const eventsPath = path.join(this.baseDir, `${sessionId}.events.log`);
    const raw = await fs.readFile(eventsPath, "utf8");
    return raw
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }
}
