const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("todoApi", {
  tree: {
    getState: () => ipcRenderer.invoke("tree:getState"),
    addChild: (parentId, title) => ipcRenderer.invoke("tree:addChild", parentId, title),
    addSibling: (nodeId, title) => ipcRenderer.invoke("tree:addSibling", nodeId, title),
    renameNode: (nodeId, title) => ipcRenderer.invoke("tree:renameNode", nodeId, title),
    focusNode: (nodeId) => ipcRenderer.invoke("tree:focusNode", nodeId),
    completeNode: (nodeId) => ipcRenderer.invoke("tree:completeNode", nodeId),
    deleteNode: (nodeId) => ipcRenderer.invoke("tree:deleteNode", nodeId),
    undo: () => ipcRenderer.invoke("tree:undo"),
    redo: () => ipcRenderer.invoke("tree:redo")
  },
  archive: {
    listSessions: () => ipcRenderer.invoke("archive:listSessions"),
    readEvents: (sessionId) => ipcRenderer.invoke("archive:readEvents", sessionId),
    listSnapshots: () => ipcRenderer.invoke("archive:listSnapshots"),
    readSnapshot: (snapshotId) => ipcRenderer.invoke("archive:readSnapshot", snapshotId)
  },
  ui: {
    setIgnoreMouseEvents: (ignore) => ipcRenderer.send("ui:set-ignore-mouse-events", ignore),
    dragMove: (dx, dy) => ipcRenderer.send("ui:drag-move", dx, dy),
    dragEnd: () => ipcRenderer.send("ui:drag-end")
  },
  translate: {
    lookup: (word) => ipcRenderer.invoke("translate:lookup", word)
  },
  session: {
    save: () => ipcRenderer.invoke("session:save"),
    restore: (snapshotId) => ipcRenderer.invoke("session:restore", snapshotId)
  },

  onOpenHistory: (callback) => {
    const wrapped = () => callback();
    ipcRenderer.on("ui:toggle-history", wrapped);
    return () => ipcRenderer.off("ui:toggle-history", wrapped);
  },
  onDockChanged: (callback) => {
    const wrapped = (_event, payload) => callback(payload);
    ipcRenderer.on("ui:dock-state", wrapped);
    return () => ipcRenderer.off("ui:dock-state", wrapped);
  }
});
