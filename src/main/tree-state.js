import { randomUUID } from "node:crypto";

const UNNAMED_TITLE = "Untitled task";
const MAX_HISTORY = 200;

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function sanitizeTitle(title) {
  const next = (title ?? "").trim();
  return next.length > 0 ? next : UNNAMED_TITLE;
}

function createNode({ id, parentId, title }) {
  const timestamp = nowIso();
  return {
    id,
    parentId,
    title: sanitizeTitle(title),
    childrenIds: [],
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function createInitialState(sessionId) {
  const rootId = randomUUID();
  const rootNode = createNode({
    id: rootId,
    parentId: null,
    title: "Session Root"
  });

  return {
    sessionId,
    rootId,
    focusedNodeId: rootId,
    nodes: {
      [rootId]: rootNode
    },
    undoStack: [],
    redoStack: []
  };
}

export class TreeStateMachine {
  constructor(state) {
    this.state = deepClone(state);
  }

  getState() {
    return deepClone(this.state);
  }

  snapshot() {
    return {
      rootId: this.state.rootId,
      focusedNodeId: this.state.focusedNodeId,
      nodes: deepClone(this.state.nodes)
    };
  }

  applySnapshot(snapshot) {
    this.state.rootId = snapshot.rootId;
    this.state.focusedNodeId = snapshot.focusedNodeId;
    this.state.nodes = deepClone(snapshot.nodes);
    this.ensureFocus();
  }

  pushUndo() {
    this.state.undoStack.push(this.snapshot());
    if (this.state.undoStack.length > MAX_HISTORY) {
      this.state.undoStack.shift();
    }
    this.state.redoStack = [];
  }

  ensureFocus() {
    const focused = this.state.nodes[this.state.focusedNodeId];
    if (!focused || focused.status !== "active") {
      this.state.focusedNodeId = this.state.rootId;
    }
  }

  assertNode(nodeId) {
    const node = this.state.nodes[nodeId];
    if (!node || node.status !== "active") {
      throw new Error(`Node not found or inactive: ${nodeId}`);
    }
    return node;
  }

  addChild(parentId, title) {
    const parent = this.assertNode(parentId);
    this.pushUndo();

    const id = randomUUID();
    const node = createNode({ id, parentId: parent.id, title });
    this.state.nodes[id] = node;
    parent.childrenIds.push(id);
    parent.updatedAt = nowIso();
    this.state.focusedNodeId = id;
    return { nodeId: id, state: this.getState() };
  }

  addSibling(nodeId, title) {
    const node = this.assertNode(nodeId);
    const parentId = node.parentId ?? this.state.rootId;
    return this.addChild(parentId, title);
  }

  renameNode(nodeId, title) {
    const node = this.assertNode(nodeId);
    this.pushUndo();
    node.title = sanitizeTitle(title);
    node.updatedAt = nowIso();
    return this.getState();
  }

  focusNode(nodeId) {
    const node = this.assertNode(nodeId);
    this.state.focusedNodeId = node.id;
    return this.getState();
  }

  collectSubtree(nodeId) {
    const stack = [nodeId];
    const all = [];
    while (stack.length > 0) {
      const currentId = stack.pop();
      if (!currentId) {
        continue;
      }
      const node = this.state.nodes[currentId];
      if (!node || node.status !== "active") {
        continue;
      }
      all.push(currentId);
      for (const childId of node.childrenIds) {
        stack.push(childId);
      }
    }
    return all;
  }

  softDeleteInternal(nodeId) {
    const node = this.assertNode(nodeId);
    if (node.id === this.state.rootId) {
      throw new Error("Root node cannot be deleted");
    }

    this.pushUndo();
    const nodeIds = this.collectSubtree(nodeId);
    const timestamp = nowIso();
    for (const id of nodeIds) {
      const target = this.state.nodes[id];
      target.status = "deleted";
      target.deletedAt = timestamp;
      target.updatedAt = timestamp;
    }

    const parentId = node.parentId ?? this.state.rootId;
    const parent = this.state.nodes[parentId];
    if (parent && parent.status === "active") {
      parent.childrenIds = parent.childrenIds.filter((childId) => childId !== node.id);
      parent.updatedAt = timestamp;
      this.state.focusedNodeId = parent.id;
    } else {
      this.state.focusedNodeId = this.state.rootId;
    }

    this.ensureFocus();
    return { nextFocusId: this.state.focusedNodeId, state: this.getState() };
  }

  completeNode(nodeId) {
    return this.softDeleteInternal(nodeId);
  }

  deleteNode(nodeId) {
    return this.softDeleteInternal(nodeId);
  }

  undo() {
    if (this.state.undoStack.length === 0) {
      return this.getState();
    }
    const previous = this.state.undoStack.pop();
    this.state.redoStack.push(this.snapshot());
    this.applySnapshot(previous);
    return this.getState();
  }

  redo() {
    if (this.state.redoStack.length === 0) {
      return this.getState();
    }
    const next = this.state.redoStack.pop();
    this.state.undoStack.push(this.snapshot());
    this.applySnapshot(next);
    return this.getState();
  }
}
