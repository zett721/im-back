/* ========== Graph rendering constants ========== */

const GRAPH = {
  ROW_H: 32,
  COL_W: 18,
  PAD_LEFT: 18,
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
  historyOpen: false
};

const elements = {
  graphContainer: document.querySelector("#graphContainer"),
  graphCanvas: document.querySelector("#graphCanvas"),
  graphNodes: document.querySelector("#graphNodes"),
  historyPanel: document.querySelector("#historyPanel"),
  historyClose: document.querySelector("#historyClose"),
  snapshotList: document.querySelector("#snapshotList"),
  toast: document.querySelector("#toast"),
  titleEditor: document.querySelector("#titleEditor"),
  titleEditorLabel: document.querySelector("#titleEditorLabel"),
  titleEditorInput: document.querySelector("#titleEditorInput"),
  titleEditorOk: document.querySelector("#titleEditorOk"),
  titleEditorCancel: document.querySelector("#titleEditorCancel"),
  translatePopup: document.querySelector("#translatePopup"),
  translateInput: document.querySelector("#translateInput"),
  translateResult: document.querySelector("#translateResult")
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
      ".graph-node, .qbtn, .history-panel, .title-editor, .editor-input, .editor-btn, .drag-bar, .translate-popup, .snapshot-restore-btn, .history-close-btn"
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

  function dfs(node, depth, isLast, parentCol, isFirst, parentRowIndex) {
    const children = getChildren(state, node);
    // Root (depth 0) and its direct children (depth 1) are on col 0
    const col = depth <= 1 ? 0 : parentCol + 1;
    const myRowIndex = rows.length;

    rows.push({
      node,
      depth,
      col,
      parentCol,
      isLast,
      isFirst,
      parentRowIndex
    });
    children.forEach((child, i) => {
      dfs(child, depth + 1, i === children.length - 1, col, i === 0, myRowIndex);
    });
  }

  dfs(root, 0, true, 0, true, -1);
  return rows;
}

/* ========== Canvas graph drawing ========== */

function drawGraphLines(rows) {
  const canvas = elements.graphCanvas;
  const dpr = window.devicePixelRatio || 1;
  const maxCol = rows.reduce((m, r) => Math.max(m, r.col), 0);
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

  // --- Build independent line segments, one per sibling group ---
  // Each segment covers the row range of one group of siblings under the same parent.
  // Two branches that happen to share the same column number but belong to different
  // parents are stored as SEPARATE segments and never merged.
  const segments = []; // { col, startRow, endRow }
  const openStack = []; // { col, parentCol, startRow }

  rows.forEach((row, i) => {
    // A new branch segment opens with the FIRST child that moves right
    if (row.isFirst && row.col > row.parentCol) {
      openStack.push({ col: row.col, parentCol: row.parentCol, startRow: i });
    }
    // The segment closes with the LAST sibling in that same group
    if (row.isLast && row.col > row.parentCol) {
      for (let j = openStack.length - 1; j >= 0; j--) {
        if (openStack[j].col === row.col && openStack[j].parentCol === row.parentCol) {
          const seg = openStack.splice(j, 1)[0];
          segments.push({ col: seg.col, startRow: seg.startRow, endRow: i });
          break;
        }
      }
    }
  });

  // --- Main axis (col 0): a single continuous line from first to last trunk node ---
  // Drawing it as one stroke avoids any row-boundary gap, and it naturally passes
  // through all branch-child rows in between.
  const col0Indices = rows.reduce((acc, r, i) => { if (r.col === 0) acc.push(i); return acc; }, []);
  const mainStart = col0Indices[0] ?? -1;
  const mainEnd = col0Indices[col0Indices.length - 1] ?? -1;

  if (mainStart !== -1 && mainEnd > mainStart) {
    const lineX = GRAPH.PAD_LEFT;
    const y1 = mainStart * GRAPH.ROW_H + GRAPH.ROW_H / 2;
    const y2 = mainEnd * GRAPH.ROW_H + GRAPH.ROW_H / 2;
    ctx.strokeStyle = graphColor(0);
    ctx.lineWidth = GRAPH.LINE_W;
    ctx.beginPath();
    ctx.moveTo(lineX, y1);
    ctx.lineTo(lineX, y2);
    ctx.stroke();
  }

  // --- Draw branch segments and Bezier connectors ---
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const col = row.col;
    const dotX = GRAPH.PAD_LEFT + col * GRAPH.COL_W;
    const dotY = i * GRAPH.ROW_H + GRAPH.ROW_H / 2;

    // Branch segments: each is an independent sibling group
    for (const seg of segments) {
      if (i < seg.startRow || i > seg.endRow) continue;
      if (seg.startRow === seg.endRow) continue; // single child — no vertical line needed

      const lineX = GRAPH.PAD_LEFT + seg.col * GRAPH.COL_W;
      ctx.strokeStyle = graphColor(seg.col);
      ctx.lineWidth = GRAPH.LINE_W;
      ctx.beginPath();
      if (i === seg.startRow) {
        ctx.moveTo(lineX, dotY);
        ctx.lineTo(lineX, (i + 1) * GRAPH.ROW_H);
      } else if (i === seg.endRow) {
        ctx.moveTo(lineX, i * GRAPH.ROW_H);
        ctx.lineTo(lineX, dotY);
      } else {
        ctx.moveTo(lineX, i * GRAPH.ROW_H);
        ctx.lineTo(lineX, (i + 1) * GRAPH.ROW_H);
      }
      ctx.stroke();
    }

    // Bezier branch-entry connector: starts from the PARENT dot center so there
    // is never a gap between a parent node and its first branch child.
    if (col > row.parentCol && row.isFirst && row.parentRowIndex >= 0) {
      const parentX = GRAPH.PAD_LEFT + row.parentCol * GRAPH.COL_W;
      const parentDotY = row.parentRowIndex * GRAPH.ROW_H + GRAPH.ROW_H / 2;
      const span = dotY - parentDotY;
      ctx.strokeStyle = graphColor(col);
      ctx.lineWidth = GRAPH.LINE_W;
      ctx.beginPath();
      ctx.moveTo(parentX, parentDotY);
      ctx.bezierCurveTo(
        parentX, parentDotY + span * 0.5,
        dotX, dotY - span * 0.1,
        dotX, dotY
      );
      ctx.stroke();
    }
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
  const { node, col } = row;
  const isFocused = node.id === stateRef.value?.focusedNodeId;
  const dotX = GRAPH.PAD_LEFT + col * GRAPH.COL_W;
  const dotY = rowIndex * GRAPH.ROW_H + GRAPH.ROW_H / 2;

  const el = document.createElement("div");
  el.className = `graph-node${isFocused ? " focused" : ""}`;
  el.dataset.nodeId = node.id;
  // Position so the dot center (5px from left edge) aligns with canvas line x
  el.style.left = `${dotX - 5}px`;
  el.style.top = `${dotY - GRAPH.ROW_H / 2}px`;
  el.style.color = graphColor(col);

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
  if (title === null) {
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
  showToast("撤销");
}

async function redo() {
  stateRef.value = await window.todoApi.tree.redo();
  renderTree();
  showToast("重做");
}

async function saveSession() {
  await window.todoApi.session.save();
  showToast("✅ 已保存 — 下次启动将继续当前内容", 3000);
}

/* ========== History panel ========== */

function toggleHistory(forceValue = null) {
  stateRef.historyOpen = forceValue ?? !stateRef.historyOpen;
  elements.historyPanel.classList.toggle("hidden", !stateRef.historyOpen);
  elements.historyPanel.setAttribute("aria-hidden", stateRef.historyOpen ? "false" : "true");
  if (stateRef.historyOpen) {
    setMousePassthrough(false);
    void loadSnapshots();
  } else if (!isTitleEditorOpen()) {
    setMousePassthrough(true);
  }
}

/**
 * Formats a snapshot ID ("2026-02-21_10-30-00") into a readable date string.
 */
function formatSnapshotDate(snapshotId) {
  // "2026-02-21_10-30-00" → "2026/02/21  10:30"
  const match = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})/.exec(snapshotId);
  if (!match) return snapshotId;
  const [, y, mo, d, h, mi] = match;
  return `${y}/${mo}/${d}  ${h}:${mi}`;
}

/**
 * Walks the active nodes of a snapshot state and returns an array of
 * { title, depth } objects (root excluded, depth starts at 0 = top-level tasks).
 */
function buildMiniTree(snapshotState) {
  const { nodes, rootId } = snapshotState;
  const result = [];

  function walk(nodeId, depth) {
    const node = nodes[nodeId];
    if (!node || node.status !== "active") return;
    if (depth > 0) {
      result.push({ title: node.title, depth: depth - 1 });
    }
    for (const childId of node.childrenIds) {
      walk(childId, depth + 1);
    }
  }

  walk(rootId, 0);
  return result;
}

/** Counts active (non-root) nodes in a snapshot state. */
function countActiveTasks(snapshotState) {
  const { nodes, rootId } = snapshotState;
  let count = 0;
  for (const [id, node] of Object.entries(nodes)) {
    if (id !== rootId && node.status === "active") count++;
  }
  return count;
}

/**
 * Builds a DOM card element for a snapshot entry.
 * snapshotState is the parsed JSON from the .snapshot.json file.
 */
function buildSnapshotCard(snapshotId, snapshotState) {
  const MAX_VISIBLE_ROWS = 6;
  const card = document.createElement("div");
  card.className = "snapshot-card";

  // ── Header: date  |  restore button  |  badge ──
  const header = document.createElement("div");
  header.className = "snapshot-card-header";

  const dateEl = document.createElement("span");
  dateEl.className = "snapshot-date";
  dateEl.textContent = formatSnapshotDate(snapshotId);

  const restoreBtn = document.createElement("button");
  restoreBtn.type = "button";
  restoreBtn.className = "snapshot-restore-btn";
  restoreBtn.textContent = "恢复";
  restoreBtn.addEventListener("click", () => {
    void restoreFromSnapshot(snapshotId, restoreBtn);
  });

  const taskCount = countActiveTasks(snapshotState);
  const badge = document.createElement("span");
  badge.className = "snapshot-badge";
  badge.textContent = `${taskCount} 项`;

  header.append(dateEl, restoreBtn, badge);
  card.append(header);

  // ── Mini tree ──
  const treeRows = buildMiniTree(snapshotState);
  if (treeRows.length === 0) {
    const empty = document.createElement("div");
    empty.className = "snapshot-empty";
    empty.textContent = "（空会话）";
    card.append(empty);
  } else {
    const tree = document.createElement("div");
    tree.className = "snapshot-tree";
    const visibleRows = treeRows.slice(0, MAX_VISIBLE_ROWS);
    for (const { title, depth } of visibleRows) {
      const row = document.createElement("div");
      row.className = "snapshot-tree-row";

      if (depth > 0) {
        const indent = document.createElement("span");
        indent.className = "snapshot-tree-indent";
        indent.textContent = "  ".repeat(depth - 1) + "└ ";
        row.append(indent);
      }

      const dot = document.createElement("span");
      dot.className = "snapshot-tree-dot";
      // Use graph colors matching depth
      dot.style.color = GRAPH.COLORS[depth % GRAPH.COLORS.length];

      const label = document.createElement("span");
      label.className = "snapshot-tree-label";
      label.textContent = title;

      row.append(dot, label);
      tree.append(row);
    }
    card.append(tree);

    if (treeRows.length > MAX_VISIBLE_ROWS) {
      const more = document.createElement("div");
      more.className = "snapshot-overflow";
      more.textContent = `…另有 ${treeRows.length - MAX_VISIBLE_ROWS} 项`;
      card.append(more);
    }
  }  // ← close else block

  return card;
}

async function loadSnapshots() {
  const list = elements.snapshotList;
  list.innerHTML = "";

  let snapshots;
  try {
    snapshots = await window.todoApi.archive.listSnapshots();
  } catch {
    snapshots = [];
  }

  if (snapshots.length === 0) {
    const empty = document.createElement("div");
    empty.className = "snapshot-no-history";
    empty.textContent = "暂无历史记录。\n每次启动新会话时，上次的内容会自动存档。";
    list.append(empty);
    return;
  }

  // Load all snapshots in parallel for speed
  const states = await Promise.all(
    snapshots.map((id) =>
      window.todoApi.archive.readSnapshot(id).catch(() => null)
    )
  );

  for (let i = 0; i < snapshots.length; i++) {
    const state = states[i];
    if (!state) continue;
    list.append(buildSnapshotCard(snapshots[i], state));
  }
}

async function restoreFromSnapshot(snapshotId, btn) {
  if (btn) btn.disabled = true;
  try {
    const newState = await window.todoApi.session.restore(snapshotId);
    stateRef.value = newState;
    renderTree();
    toggleHistory(false);
    showToast("✅ 已恢复历史记录", 3000);
  } catch (err) {
    showToast(`恢复失败: ${err.message}`, 5000);
    if (btn) btn.disabled = false;
  }
}

function setupHistory() {
  elements.historyClose.addEventListener("click", () => toggleHistory(false));
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

      if (isTranslateOpen()) {
        if (event.key === "Escape") {
          event.preventDefault();
          toggleTranslate(false);
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
      if (event.ctrlKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        await saveSession();
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
    if (isTitleEditorOpen() || stateRef.historyOpen || isTranslateOpen()) {
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
  window.todoApi.onOpenHistory(() => toggleHistory());
  window.todoApi.onDockChanged((payload) => {
    document.body.classList.toggle("docked", Boolean(payload?.docked));
  });
}

/* ========== Translate ========== */

let translateOpen = false;

function isTranslateOpen() {
  return translateOpen;
}

function toggleTranslate(forceValue = null) {
  translateOpen = forceValue ?? !translateOpen;
  elements.translatePopup.classList.toggle("hidden", !translateOpen);
  elements.translatePopup.setAttribute("aria-hidden", translateOpen ? "false" : "true");
  if (translateOpen) {
    setMousePassthrough(false);
    requestAnimationFrame(() => {
      elements.translateInput.focus();
      elements.translateInput.select();
    });
  } else if (!isTitleEditorOpen() && !stateRef.historyOpen) {
    setMousePassthrough(true);
  }
}

let translateTimer = null;

async function doTranslate() {
  const word = elements.translateInput.value.trim();
  if (!word) {
    elements.translateResult.textContent = "英 ↔ 中";
    return;
  }
  elements.translateResult.textContent = "翻译中...";
  try {
    const res = await window.todoApi.translate.lookup(word);
    if (res.error) {
      elements.translateResult.textContent = `❌ ${res.error}`;
    } else {
      const dir = res.from === "zh" ? "中 → 英" : "英 → 中";
      elements.translateResult.textContent = `${dir}：${res.result}`;
    }
  } catch (err) {
    elements.translateResult.textContent = `❌ ${err.message}`;
  }
}

function setupTranslate() {
  elements.translateInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      if (translateTimer) { clearTimeout(translateTimer); translateTimer = null; }
      void doTranslate();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      toggleTranslate(false);
    }
  });

  elements.translateInput.addEventListener("input", () => {
    if (translateTimer) { clearTimeout(translateTimer); }
    translateTimer = setTimeout(() => {
      translateTimer = null;
      void doTranslate();
    }, 600);
  });
}

/* ========== Drag bar (click = translate, drag = move window) ========== */

function setupDragBar() {
  const dragBar = document.querySelector(".drag-bar");
  if (!dragBar) {
    return;
  }
  let dragging = false;
  let didMove = false;
  let lastScreenX = 0;
  let lastScreenY = 0;
  let startScreenX = 0;
  let startScreenY = 0;
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
    didMove = false;
    startScreenX = lastScreenX = event.screenX;
    startScreenY = lastScreenY = event.screenY;
    pendingDx = 0;
    pendingDy = 0;
    event.preventDefault();
  });

  document.addEventListener("mousemove", (event) => {
    if (!dragging) {
      return;
    }
    const dx = event.screenX - startScreenX;
    const dy = event.screenY - startScreenY;
    if (!didMove && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
      didMove = true;
    }
    if (didMove) {
      pendingDx += event.screenX - lastScreenX;
      pendingDy += event.screenY - lastScreenY;
      lastScreenX = event.screenX;
      lastScreenY = event.screenY;
      if (!rafId) {
        rafId = requestAnimationFrame(flushDrag);
      }
    }
  });

  document.addEventListener("mouseup", () => {
    if (!dragging) {
      return;
    }
    dragging = false;
    if (didMove) {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
        flushDrag();
      }
      window.todoApi.ui.dragEnd();
    } else {
      // Single click — toggle translate popup
      toggleTranslate();
    }
  });
}

/* ========== Boot ========== */

async function start() {
  await withGuard(async () => {
    await syncState();
    setupTitleEditor();
    setupHistory();
    setupKeyboard();
    setupMousePassthrough();
    setupIpcListeners();
    setupDragBar();
    setupTranslate();
    setMousePassthrough(true);
    showToast("单击⠿翻译单词；hover 节点查看任务", 3200);
  });
}

start();
