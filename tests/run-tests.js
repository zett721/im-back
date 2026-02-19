import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { TreeStateMachine, createInitialState } from "../src/main/tree-state.js";
import { SessionStore } from "../src/main/session-store.js";

async function run(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

async function createTempSessionsDir() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "git-tree-todo-"));
  return path.join(root, "sessions");
}

await run("complete node returns focus to parent", async () => {
  const machine = new TreeStateMachine(createInitialState("session-test"));
  const rootId = machine.getState().rootId;
  const child = machine.addChild(rootId, "child-a");
  const result = machine.completeNode(child.nodeId);
  assert.equal(result.nextFocusId, rootId);
  assert.equal(result.state.focusedNodeId, rootId);
  assert.equal(result.state.nodes[child.nodeId].status, "deleted");
});

await run("root node cannot be deleted", async () => {
  const machine = new TreeStateMachine(createInitialState("session-test"));
  const rootId = machine.getState().rootId;
  assert.throws(() => machine.deleteNode(rootId), /Root node cannot be deleted/u);
});

await run("undo and redo restore tree shape and focus", async () => {
  const machine = new TreeStateMachine(createInitialState("session-test"));
  const rootId = machine.getState().rootId;
  const child = machine.addChild(rootId, "child-a");
  machine.addChild(child.nodeId, "child-b");
  const beforeUndo = machine.getState();
  machine.undo();
  const afterUndo = machine.getState();
  assert.equal(afterUndo.nodes[child.nodeId].childrenIds.length, 0);
  assert.equal(afterUndo.focusedNodeId, child.nodeId);
  machine.redo();
  const afterRedo = machine.getState();
  assert.equal(afterRedo.nodes[child.nodeId].childrenIds.length, 1);
  assert.equal(afterRedo.focusedNodeId, beforeUndo.focusedNodeId);
});

await run("initSession archives previous active.json and creates new files", async () => {
  const sessionsDir = await createTempSessionsDir();
  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.writeFile(path.join(sessionsDir, "active.json"), '{"old":true}', "utf8");
  const store = new SessionStore(sessionsDir);
  const state = await store.initSession();
  const files = await fs.readdir(sessionsDir);
  assert.ok(files.includes("active.json"));
  assert.ok(files.some((name) => name.endsWith(".snapshot.json")));
  assert.ok(files.some((name) => name.endsWith(".events.log")));
  assert.equal(state.sessionId, store.sessionId);
});

await run("appendEvent writes formatted text events", async () => {
  const sessionsDir = await createTempSessionsDir();
  const store = new SessionStore(sessionsDir);
  const state = await store.initSession();
  await store.appendEvent("ADD_CHILD", {
    nodeId: "n1",
    parentId: state.rootId,
    title: "Task A"
  });
  const lines = await store.readEvents(state.sessionId);
  assert.ok(lines.some((line) => line.includes("ADD_CHILD")));
  assert.ok(lines.some((line) => line.includes('title="Task A"')));
});

await run("scheduleStateWrite flushes state file", async () => {
  const sessionsDir = await createTempSessionsDir();
  const store = new SessionStore(sessionsDir);
  const state = await store.initSession();
  store.scheduleStateWrite({
    ...state,
    focusedNodeId: state.rootId
  });
  await store.flushPendingState();
  const raw = await fs.readFile(path.join(sessionsDir, "active.json"), "utf8");
  const loaded = JSON.parse(raw);
  assert.equal(loaded.sessionId, state.sessionId);
  assert.equal(loaded.focusedNodeId, state.rootId);
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
