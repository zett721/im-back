import path from "node:path";
import { SessionStore } from "./session-store.js";
import { TreeStateMachine } from "./tree-state.js";

export class AppController {
  constructor(store, machine) {
    this.store = store;
    this.machine = machine;
    this.queue = Promise.resolve();
  }

  static async create(userDataDir) {
    const sessionsDir = path.join(userDataDir, "sessions");
    const store = new SessionStore(sessionsDir);
    const initialState = await store.initSession();
    const machine = new TreeStateMachine(initialState);
    return new AppController(store, machine);
  }

  enqueue(task) {
    this.queue = this.queue.then(task, task);
    return this.queue;
  }

  schedulePersist() {
    this.store.scheduleStateWrite(this.machine.getState());
  }

  async getState() {
    return this.enqueue(async () => this.machine.getState());
  }

  async addChild(parentId, title) {
    return this.enqueue(async () => {
      const result = this.machine.addChild(parentId, title);
      const state = result.state;
      const node = state.nodes[result.nodeId];
      await this.store.appendEvent("ADD_CHILD", {
        nodeId: node.id,
        parentId: node.parentId,
        title: node.title
      });
      this.schedulePersist();
      return state;
    });
  }

  async addSibling(nodeId, title) {
    return this.enqueue(async () => {
      const result = this.machine.addSibling(nodeId, title);
      const state = result.state;
      const node = state.nodes[result.nodeId];
      await this.store.appendEvent("ADD_SIBLING", {
        nodeId: node.id,
        parentId: node.parentId,
        title: node.title,
        extra: `from=${nodeId}`
      });
      this.schedulePersist();
      return state;
    });
  }

  async renameNode(nodeId, title) {
    return this.enqueue(async () => {
      const state = this.machine.renameNode(nodeId, title);
      const node = state.nodes[nodeId];
      await this.store.appendEvent("RENAME_NODE", {
        nodeId: node.id,
        parentId: node.parentId,
        title: node.title
      });
      this.schedulePersist();
      return state;
    });
  }

  async focusNode(nodeId) {
    return this.enqueue(async () => {
      const state = this.machine.focusNode(nodeId);
      const node = state.nodes[nodeId];
      await this.store.appendEvent("FOCUS_NODE", {
        nodeId: node.id,
        parentId: node.parentId,
        title: node.title
      });
      this.schedulePersist();
      return state;
    });
  }

  async completeNode(nodeId) {
    return this.enqueue(async () => {
      const before = this.machine.getState();
      const node = before.nodes[nodeId];
      const result = this.machine.completeNode(nodeId);
      await this.store.appendEvent("COMPLETE_NODE", {
        nodeId,
        parentId: node?.parentId ?? "none",
        title: node?.title ?? "",
        extra: `nextFocus=${result.nextFocusId}`
      });
      this.schedulePersist();
      return result;
    });
  }

  async deleteNode(nodeId) {
    return this.enqueue(async () => {
      const before = this.machine.getState();
      const node = before.nodes[nodeId];
      const result = this.machine.deleteNode(nodeId);
      await this.store.appendEvent("DELETE_NODE", {
        nodeId,
        parentId: node?.parentId ?? "none",
        title: node?.title ?? "",
        extra: `nextFocus=${result.nextFocusId}`
      });
      this.schedulePersist();
      return result;
    });
  }

  async undo() {
    return this.enqueue(async () => {
      const state = this.machine.undo();
      const focused = state.nodes[state.focusedNodeId];
      await this.store.appendEvent("UNDO", {
        nodeId: state.focusedNodeId,
        parentId: focused?.parentId ?? "none",
        title: focused?.title ?? ""
      });
      this.schedulePersist();
      return state;
    });
  }

  async redo() {
    return this.enqueue(async () => {
      const state = this.machine.redo();
      const focused = state.nodes[state.focusedNodeId];
      await this.store.appendEvent("REDO", {
        nodeId: state.focusedNodeId,
        parentId: focused?.parentId ?? "none",
        title: focused?.title ?? ""
      });
      this.schedulePersist();
      return state;
    });
  }

  async listSessions() {
    return this.enqueue(async () => this.store.listSessions());
  }

  async readEvents(sessionId) {
    return this.enqueue(async () => this.store.readEvents(sessionId));
  }

  async saveSession() {
    return this.enqueue(async () => {
      // Flush pending writes first so active.json is up-to-date
      await this.store.flushPendingState();
      await this.store.markContinue();
      await this.store.appendEvent("SESSION_SAVE", {
        nodeId: this.machine.getState().rootId,
        parentId: "none",
        title: "User saved session"
      });
    });
  }

  async listSnapshots() {
    return this.enqueue(async () => this.store.listSnapshots());
  }

  async readSnapshot(snapshotId) {
    return this.enqueue(async () => this.store.readSnapshot(snapshotId));
  }

  /**
   * 从历史快照恢复：flush 当前状态 → 调用 store 恢复 → 重新初始化状态机。
   * 返回新的完整 state 供渲染层直接使用。
   */
  async restoreSession(snapshotId) {
    return this.enqueue(async () => {
      await this.store.flushPendingState();
      const restoredState = await this.store.restoreToSnapshot(snapshotId);
      this.machine = new TreeStateMachine(restoredState);
      return restoredState;
    });
  }

  async shutdown() {
    await this.enqueue(async () => this.store.flushPendingState());
  }
}

