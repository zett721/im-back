const stateRef = {
  value: null,
  selectedSessionId: null,
  historyOpen: false
};

const elements = {
  treeRoot: document.querySelector("#treeRoot"),
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
      ".node, .title, .qbtn, .history-panel, .title-editor, .session-btn, .events-log, .editor-input, .editor-btn, .drag-bar"
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

function createNodeChip(node, isFocused) {
  const chip = document.createElement("div");
  chip.className = `node${isFocused ? " focused" : ""}`;
  chip.tabIndex = 0;
  chip.dataset.nodeId = node.id;
  chip.addEventListener("click", () => {
    void focusNode(node.id);
  });
  chip.addEventListener("dblclick", () => {
    void renameNode(node.id);
  });

  const dot = document.createElement("span");
  dot.className = "dot";
  dot.setAttribute("aria-hidden", "true");
  chip.append(dot);

  const title = document.createElement("button");
  title.type = "button";
  title.className = "title";
  title.textContent = node.title;
  title.addEventListener("click", (event) => {
    event.stopPropagation();
    void focusNode(node.id);
  });
  chip.append(title);

  const actions = document.createElement("div");
  actions.className = "quick-actions";
  actions.append(
    createQuickButton("+", "Add child", () => addChild(node.id)),
    createQuickButton("=", "Add sibling", () => addSibling(node.id)),
    createQuickButton("R", "Rename", () => renameNode(node.id))
  );
  if (node.parentId) {
    actions.append(
      createQuickButton("V", "Complete and return parent", () => completeNode(node.id)),
      createQuickButton("x", "Delete and return parent", () => deleteNode(node.id))
    );
  }
  chip.append(actions);
  return chip;
}

function renderNode(state, node, isRoot = false) {
  const li = document.createElement("li");
  li.className = `tree-node${isRoot ? " root" : ""}`;
  li.dataset.nodeId = node.id;
  li.append(createNodeChip(node, state.focusedNodeId === node.id));

  const children = getChildren(state, node);
  if (children.length > 0) {
    const ul = document.createElement("ul");
    for (const child of children) {
      ul.append(renderNode(state, child, false));
    }
    li.append(ul);
  }
  return li;
}

function renderTree() {
  const state = stateRef.value;
  if (!state) {
    return;
  }
  elements.treeRoot.innerHTML = "";
  const root = activeNode(state, state.rootId);
  if (!root) {
    showToast("Root missing", 4000);
    return;
  }
  elements.treeRoot.append(renderNode(state, root, true));
  if (isTitleEditorOpen()) {
    positionTitleEditor(editorState.anchorNodeId);
  }
}

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
    const anchor = document.querySelector(`.tree-node[data-node-id="${anchorNodeId}"] .node`);
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

function setupIpcListeners() {
  window.todoApi.onOpenHistory(() => toggleHistory(true));
  window.todoApi.onDockChanged((payload) => {
    document.body.classList.toggle("docked", Boolean(payload?.docked));
  });
}

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

async function start() {
  await withGuard(async () => {
    await syncState();
    setupTitleEditor();
    setupKeyboard();
    setupMousePassthrough();
    setupIpcListeners();
    setupDragBar();
    setMousePassthrough(true);
    showToast("顶部条可拖动窗口；仅悬停节点显示内容", 3200);
  });
}

start();
