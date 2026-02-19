/* ========== Graph rendering constants ========== */

const GRAPH = {
  ROW_H: 32,
  COL_W: 18,
  PAD_LEFT: 18,
  DOT_R: 5,
  LINE_W: 2,
  COLORS: [
    "#4078c0", // blue
    "#e8a030", // orange
    "#e04080", // pink
    "#40b060", // green
    "#8050c0", // purple
    "#c06040", // brown
    "#30a0a0"  // teal
  ]
};

function graphColor(col) {
  return GRAPH.COLORS[col % GRAPH.COLORS.length];
}

/* ========== App state ========== */

const stateRef = {
  value: null,
  selectedSessionId: null,
  historyOpen: false
};

const elements = {
  graphContainer: document.querySelector("#graphContainer"),
  graphCanvas: document.querySelector("#graphCanvas"),
  graphNodes: document.querySelector("#graphNodes"),
  historyPanel: document.querySelector("#historyPanel"),
  sessionList: document.querySelector("#sessionList"),
  eventsLog: document.querySelector("#eventsLog"),
  toast: document.querySelector("#toast"),
  titleEditor: document.querySelector("#titleEditor"),
  titleEditorLabel: document.querySelector("#titleEditorLabel"),
  titleEditorInput: document.querySelector("#titleEditorInput"),
  titleEditorOk: document.querySelector("#titleEditorOk"),
  titleEditorCancel: document.querySelector("#titleEditorCancel")
};

const editorState = {
  resolve: null,
  anchorNodeId: null
};

let toastTimer = null;
let mousePassthroughEnabled = false;

/* ========== Utilities ========== */

function showToast(message, timeoutMs = 1800) {
  elements.toast.textContent = message;
  elements.toast.classList.remove("hidden");
  if (toastTimer) {
    clearTimeout(toastTimer);
  }
  toastTimer = setTimeout(() => {
    elements.toast.classList.add("hidden");
  }, timeoutMs);
}

window.addEventListener("error", (event) => {
  showToast(`Renderer error: ${event.message}`, 5000);
});

window.addEventListener("unhandledrejection", (event) => {
  showToast(`Promise error: ${event.reason?.message ?? event.reason}`, 5000);
});

function ensureApi() {
  if (!window.todoApi || !window.todoApi.tree || !window.todoApi.ui) {
    throw new Error("Bridge missing: preload did not expose todoApi.");
  }
}

function setMousePassthrough(ignore) {
  if (mousePassthroughEnabled === ignore) {
    return;
  }
  mousePassthroughEnabled = ignore;
  if (window.todoApi?.ui?.setIgnoreMouseEvents) {
    window.todoApi.ui.setIgnoreMouseEvents(ignore);
  }
}

function isInteractiveTarget(target) {
  if (!(target instanceof Element)) {
    return false;
  }
  return Boolean(
    target.closest(
      ".graph-node, .qbtn, .history-panel, .title-editor, .session-btn, .events-log, .editor-input, .editor-btn, .drag-bar"
    )
  );
}

function activeNode(state, nodeId) {
  const node = state?.nodes?.[nodeId];
  return node && node.status === "active" ? node : null;
}

function getFocusedNode(state) {
  return activeNode(state, state.focusedNodeId);
}

function getChildren(state, node) {
  return node.childrenIds
    .map((id) => state.nodes[id])
    .filter((child) => child && child.status === "active");
}

async function withGuard(task) {
  try {
    await task();
  } catch (error) {
    console.error(error);
    showToast(`Error: ${error.message}`, 5000);
  }
}

async function syncState() {
  ensureApi();
  stateRef.value = await window.todoApi.tree.getState();
  renderTree();
}

/* ========== Tree → flat rows ========== */

function flattenTree(state) {
  const rows = [];
  const root = activeNode(state, state.rootId);
  if (!root) {
    return rows;
  }

  function dfs(node, depth, isLast) {
    const children = getChildren(state, node);
    rows.push({
      node,
      depth,
      isLast,
      hasChildren: children.length > 0
    });
    children.forEach((child, i) => {
      dfs(child, depth + 1, i === children.length - 1);
    });
  }

  dfs(root, 0, true);
  return rows;
}

/* ========== Canvas graph drawing ========== */

function drawGraphLines(rows) {
  const canvas = elements.graphCanvas;
  const dpr = window.devicePixelRatio || 1;
  const maxCol = rows.reduce((m, r) => Math.max(m, r.depth), 0);
  const canvasW = GRAPH.PAD_LEFT + (maxCol + 1) * GRAPH.COL_W + 20;
  const canvasH = rows.length * GRAPH.ROW_H;

  canvas.width = canvasW * dpr;
  canvas.height = canvasH * dpr;
  canvas.style.width = `${canvasW}px`;
  canvas.style.height = `${canvasH}px`;

  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Compute active columns state for each row
  const activeCols = new Set();
  const rowMeta = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const col = row.depth;

    // Snapshot active columns BEFORE processing this row
    const activeSnapshot = new Set(activeCols);

    // Determine which column gets deactivated at this row
    let deactivateCol = -1;
    if (row.isLast && col > 0) {
      deactivateCol = col - 1;
    }

    rowMeta.push({
      col,
      activeBefore: activeSnapshot,
      deactivateCol
    });

    // Update active columns AFTER this row
    if (row.hasChildren) {
      activeCols.add(col);
    }
    if (row.isLast && col > 0) {
      activeCols.delete(col - 1);
    }
  }

  // Draw lines and dots
  for (let i = 0; i < rows.length; i++) {
    const meta = rowMeta[i];
    const col = meta.col;
    const dotX = GRAPH.PAD_LEFT + col * GRAPH.COL_W;
    const dotY = i * GRAPH.ROW_H + GRAPH.ROW_H / 2;

    // Draw vertical continuation lines for all active columns
    for (const ac of meta.activeBefore) {
      const lineX = GRAPH.PAD_LEFT + ac * GRAPH.COL_W;
      const color = graphColor(ac);
      ctx.strokeStyle = color;
      ctx.lineWidth = GRAPH.LINE_W;
      ctx.beginPath();

      if (ac === meta.deactivateCol) {
        // Line terminates at this row — draw from top to dot center
        ctx.moveTo(lineX, i * GRAPH.ROW_H);
        ctx.lineTo(lineX, dotY);
      } else {
        // Line passes through — draw full height
        ctx.moveTo(lineX, i * GRAPH.ROW_H);
        ctx.lineTo(lineX, (i + 1) * GRAPH.ROW_H);
      }
      ctx.stroke();
    }

    // Draw continuation line below dot if node has children
    if (rows[i].hasChildren) {
      const lineX = GRAPH.PAD_LEFT + col * GRAPH.COL_W;
      ctx.strokeStyle = graphColor(col);
      ctx.lineWidth = GRAPH.LINE_W;
      ctx.beginPath();
      ctx.moveTo(lineX, dotY);
      ctx.lineTo(lineX, (i + 1) * GRAPH.ROW_H);
      ctx.stroke();
    }

    // Draw branch connector from parent column to this column
    if (col > 0) {
      const parentCol = col - 1;
      const parentX = GRAPH.PAD_LEFT + parentCol * GRAPH.COL_W;
      const childX = dotX;
      const color = graphColor(col);

      ctx.strokeStyle = color;
      ctx.lineWidth = GRAPH.LINE_W;
      ctx.beginPath();
      ctx.moveTo(parentX, i * GRAPH.ROW_H);
      // Bezier curve: from parent column top → to dot position
      const cpY1 = i * GRAPH.ROW_H + GRAPH.ROW_H * 0.4;
      const cpY2 = dotY - GRAPH.ROW_H * 0.1;
      ctx.bezierCurveTo(parentX, cpY1, childX, cpY2, childX, dotY);
      ctx.stroke();
    }

    // Dots are rendered as HTML elements, not on canvas
  }
}

/* ========== DOM node creation ========== */

function createQuickButton(text, title, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "qbtn";
  button.textContent = text;
  button.title = title;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    void onClick();
  });
  return button;
}

function createGraphNodeElement(row, rowIndex) {
  const { node, depth } = row;
  const isFocused = node.id === stateRef.value?.focusedNodeId;
  const dotX = GRAPH.PAD_LEFT + depth * GRAPH.COL_W;
  const dotY = rowIndex * GRAPH.ROW_H + GRAPH.ROW_H / 2;

  const el = document.createElement("div");
  el.className = `graph-node${isFocused ? " focused" : ""}`;
  el.dataset.nodeId = node.id;
  // Position so the dot center (5px from left edge) aligns with canvas line x
  el.style.left = `${dotX - 5}px`;
  el.style.top = `${dotY - GRAPH.ROW_H / 2}px`;
  el.style.color = graphColor(depth);

  el.addEventListener("click", () => {
    void focusNode(node.id);
  });
  el.addEventListener("dblclick", () => {
    void renameNode(node.id);
  });

  // Dot
  const dot = document.createElement("div");
  dot.className = "graph-dot";
  el.append(dot);

  // Info container (hidden by default, visible on hover)
  const info = document.createElement("div");
  info.className = "graph-info";

  const title = document.createElement("span");
  title.className = "graph-title";
  title.textContent = node.title;
  info.append(title);

  const actions = document.createElement("div");
  actions.className = "graph-actions";
  actions.append(
    createQuickButton("+", "Add child", () => addChild(node.id)),
    createQuickButton("=", "Add sibling", () => addSibling(node.id)),
    createQuickButton("R", "Rename", () => renameNode(node.id))
  );
  if (node.parentId) {
    actions.append(
      createQuickButton("V", "Complete", () => completeNode(node.id)),
      createQuickButton("x", "Delete", () => deleteNode(node.id))
    );
  }
  info.append(actions);
  el.append(info);

  return el;
}

/* ========== Render orchestration ========== */

function renderTree() {
  const state = stateRef.value;
  if (!state) {
    return;
  }
  const root = activeNode(state, state.rootId);
  if (!root) {
    showToast("Root missing", 4000);
    return;
  }

  const rows = flattenTree(state);

  // Draw canvas lines
  drawGraphLines(rows);

  // Create node elements
  elements.graphNodes.innerHTML = "";
  const totalH = rows.length * GRAPH.ROW_H;
  elements.graphNodes.style.height = `${totalH}px`;

  for (let i = 0; i < rows.length; i++) {
    elements.graphNodes.append(createGraphNodeElement(rows[i], i));
  }

  // Re-position title editor if open
  if (isTitleEditorOpen()) {
    positionTitleEditor(editorState.anchorNodeId);
  }
}

/* ========== Title Editor ========== */

function isTitleEditorOpen() {
  return !elements.titleEditor.classList.contains("hidden");
}

function positionTitleEditor(anchorNodeId = null) {
  const margin = 8;
  const panel = elements.titleEditor;
  const panelHeight = 54;
  const panelWidth = Math.min(340, window.innerWidth - margin * 2);

  let left = margin;
  let top = margin;
  if (anchorNodeId) {
    const anchor = document.querySelector(`.graph-node[data-node-id="${anchorNodeId}"]`);
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      left = Math.max(margin, Math.min(rect.left, window.innerWidth - panelWidth - margin));
      top = rect.bottom + 8;
      if (top + panelHeight > window.innerHeight - margin) {
        top = Math.max(margin, rect.top - panelHeight - 8);
      }
    }
  }

  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
}

function closeTitleEditor(value) {
  if (!editorState.resolve) {
    return;
  }
  const resolve = editorState.resolve;
  editorState.resolve = null;
  editorState.anchorNodeId = null;
  elements.titleEditor.classList.add("hidden");
  elements.titleEditor.setAttribute("aria-hidden", "true");
  if (!stateRef.historyOpen) {
    setMousePassthrough(true);
  }
  resolve(value);
}

function openTitleEditor(label, preset = "", anchorNodeId = null) {
  if (editorState.resolve) {
    closeTitleEditor(null);
  }
  editorState.anchorNodeId = anchorNodeId;
  elements.titleEditorLabel.textContent = label;
  elements.titleEditorInput.value = preset;
  elements.titleEditor.classList.remove("hidden");
  elements.titleEditor.setAttribute("aria-hidden", "false");
  positionTitleEditor(anchorNodeId);
  setMousePassthrough(false);
  return new Promise((resolve) => {
    editorState.resolve = resolve;
    requestAnimationFrame(() => {
      elements.titleEditorInput.focus();
      elements.titleEditorInput.select();
    });
  });
}

async function askTitle(label, preset = "", anchorNodeId = null) {
  const raw = await openTitleEditor(label, preset, anchorNodeId);
  if (raw === null) {
    return null;
  }
  const value = `${raw}`.trim();
  return value.length > 0 ? value : "Untitled task";
}

function setupTitleEditor() {
  elements.titleEditorOk.addEventListener("click", () => {
    closeTitleEditor(elements.titleEditorInput.value);
  });
  elements.titleEditorCancel.addEventListener("click", () => {
    closeTitleEditor(null);
  });
  elements.titleEditorInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      closeTitleEditor(elements.titleEditorInput.value);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeTitleEditor(null);
    }
  });
  window.addEventListener("resize", () => {
    if (isTitleEditorOpen()) {
      positionTitleEditor(editorState.anchorNodeId);
    }
  });
}

/* ========== Tree operations ========== */

async function focusNode(nodeId) {
  stateRef.value = await window.todoApi.tree.focusNode(nodeId);
  renderTree();
}

async function addChild(parentId = null) {
  const state = stateRef.value;
  const focused = parentId ? activeNode(state, parentId) : getFocusedNode(state);
  if (!focused) {
    return;
  }
  const title = await askTitle("Child task", "", focused.id);
  if (!title) {
    return;
  }
  stateRef.value = await window.todoApi.tree.addChild(focused.id, title);
  renderTree();
  showToast(`+ ${title}`);
}

async function addSibling(nodeId = null) {
  const state = stateRef.value;
  const focused = nodeId ? activeNode(state, nodeId) : getFocusedNode(state);
  if (!focused) {
    return;
  }
  const title = await askTitle("Sibling task", "", focused.id);
  if (!title) {
    return;
  }
  stateRef.value = await window.todoApi.tree.addSibling(focused.id, title);
  renderTree();
  showToast(`= ${title}`);
}

async function renameNode(nodeId = null) {
  const state = stateRef.value;
  const focused = nodeId ? activeNode(state, nodeId) : getFocusedNode(state);
  if (!focused) {
    return;
  }
  const title = await askTitle("Rename task", focused.title, focused.id);
  if (!title) {
    return;
  }
  stateRef.value = await window.todoApi.tree.renameNode(focused.id, title);
  renderTree();
}

async function completeNode(nodeId = null) {
  const state = stateRef.value;
  const focused = nodeId ? activeNode(state, nodeId) : getFocusedNode(state);
  if (!focused || !focused.parentId) {
    return;
  }
  const result = await window.todoApi.tree.completeNode(focused.id);
  stateRef.value = result.state;
  renderTree();
  showToast("Returned to parent");
}

async function deleteNode(nodeId = null) {
  const state = stateRef.value;
  const focused = nodeId ? activeNode(state, nodeId) : getFocusedNode(state);
  if (!focused || !focused.parentId) {
    return;
  }
  const result = await window.todoApi.tree.deleteNode(focused.id);
  stateRef.value = result.state;
  renderTree();
  showToast("Deleted and returned to parent");
}

async function undo() {
  stateRef.value = await window.todoApi.tree.undo();
  renderTree();
  showToast("Undo");
}

async function redo() {
  stateRef.value = await window.todoApi.tree.redo();
  renderTree();
  showToast("Redo");
}

/* ========== History panel ========== */

function toggleHistory(forceValue = null) {
  stateRef.historyOpen = forceValue ?? !stateRef.historyOpen;
  elements.historyPanel.classList.toggle("hidden", !stateRef.historyOpen);
  elements.historyPanel.setAttribute("aria-hidden", stateRef.historyOpen ? "false" : "true");
  if (stateRef.historyOpen) {
    setMousePassthrough(false);
  } else if (!isTitleEditorOpen()) {
    setMousePassthrough(true);
  }
  if (stateRef.historyOpen) {
    void loadSessions();
  }
}

async function loadSessions() {
  const sessions = await window.todoApi.archive.listSessions();
  if (!stateRef.selectedSessionId) {
    stateRef.selectedSessionId = stateRef.value?.sessionId ?? sessions[0] ?? null;
  }
  if (stateRef.selectedSessionId && !sessions.includes(stateRef.selectedSessionId)) {
    stateRef.selectedSessionId = sessions[0] ?? null;
  }

  elements.sessionList.innerHTML = "";
  for (const sessionId of sessions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `session-btn${sessionId === stateRef.selectedSessionId ? " active" : ""}`;
    button.textContent = sessionId;
    button.addEventListener("click", () => {
      stateRef.selectedSessionId = sessionId;
      void loadSessions();
    });
    elements.sessionList.append(button);
  }

  if (!stateRef.selectedSessionId) {
    elements.eventsLog.textContent = "No sessions";
    return;
  }

  try {
    const lines = await window.todoApi.archive.readEvents(stateRef.selectedSessionId);
    elements.eventsLog.textContent = lines.join("\n");
  } catch {
    elements.eventsLog.textContent = "Read error";
  }
}

/* ========== Keyboard ========== */

function setupKeyboard() {
  document.addEventListener("keydown", (event) => {
    void withGuard(async () => {
      if (isTitleEditorOpen()) {
        if (event.key === "Escape") {
          event.preventDefault();
          closeTitleEditor(null);
        }
        return;
      }

      if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        await addChild();
        return;
      }
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        await addSibling();
        return;
      }
      if (event.ctrlKey && event.key === "Enter") {
        event.preventDefault();
        await completeNode();
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        await undo();
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === "y") {
        event.preventDefault();
        await redo();
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === "h") {
        event.preventDefault();
        toggleHistory();
        return;
      }
      if (event.key === "Delete") {
        event.preventDefault();
        await deleteNode();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        await renameNode();
        return;
      }
      if (event.key === "Escape" && stateRef.historyOpen) {
        event.preventDefault();
        toggleHistory(false);
      }
    });
  });
}

/* ========== Mouse passthrough ========== */

function setupMousePassthrough() {
  document.addEventListener("mousemove", (event) => {
    if (isTitleEditorOpen() || stateRef.historyOpen) {
      setMousePassthrough(false);
      return;
    }
    setMousePassthrough(!isInteractiveTarget(event.target));
  });

  document.addEventListener("mouseleave", () => {
    if (!isTitleEditorOpen() && !stateRef.historyOpen) {
      setMousePassthrough(true);
    }
  });
}

/* ========== IPC listeners ========== */

function setupIpcListeners() {
  window.todoApi.onOpenHistory(() => toggleHistory(true));
  window.todoApi.onDockChanged((payload) => {
    document.body.classList.toggle("docked", Boolean(payload?.docked));
  });
}

/* ========== Drag bar ========== */

function setupDragBar() {
  const dragBar = document.querySelector(".drag-bar");
  if (!dragBar) {
    return;
  }
  let dragging = false;
  let lastScreenX = 0;
  let lastScreenY = 0;
  let pendingDx = 0;
  let pendingDy = 0;
  let rafId = 0;

  function flushDrag() {
    rafId = 0;
    if (pendingDx !== 0 || pendingDy !== 0) {
      window.todoApi.ui.dragMove(pendingDx, pendingDy);
      pendingDx = 0;
      pendingDy = 0;
    }
  }

  dragBar.addEventListener("mousedown", (event) => {
    if (event.button !== 0) {
      return;
    }
    dragging = true;
    lastScreenX = event.screenX;
    lastScreenY = event.screenY;
    pendingDx = 0;
    pendingDy = 0;
    event.preventDefault();
  });

  document.addEventListener("mousemove", (event) => {
    if (!dragging) {
      return;
    }
    pendingDx += event.screenX - lastScreenX;
    pendingDy += event.screenY - lastScreenY;
    lastScreenX = event.screenX;
    lastScreenY = event.screenY;
    if (!rafId) {
      rafId = requestAnimationFrame(flushDrag);
    }
  });

  document.addEventListener("mouseup", () => {
    if (dragging) {
      dragging = false;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
        flushDrag();
      }
      window.todoApi.ui.dragEnd();
    }
  });
}

/* ========== Boot ========== */

async function start() {
  await withGuard(async () => {
    await syncState();
    setupTitleEditor();
    setupKeyboard();
    setupMousePassthrough();
    setupIpcListeners();
    setupDragBar();
    setMousePassthrough(true);
    showToast("hover 节点查看详情；左上角可拖动窗口", 3200);
  });
}

start();
