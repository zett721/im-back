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
    readEvents: (sessionId) => ipcRenderer.invoke("archive:readEvents", sessionId)
  },
  ui: {
    setIgnoreMouseEvents: (ignore) => ipcRenderer.send("ui:set-ignore-mouse-events", ignore),
    startDrag: () => ipcRenderer.invoke("ui:start-drag"),
    dragMove: (dx, dy) => ipcRenderer.send("ui:drag-move", dx, dy),
    dragEnd: () => ipcRenderer.send("ui:drag-end")
  },
  onOpenHistory: (callback) => {
    const wrapped = () => callback();
    ipcRenderer.on("ui:open-history", wrapped);
    return () => ipcRenderer.off("ui:open-history", wrapped);
  },
  onDockChanged: (callback) => {
    const wrapped = (_event, payload) => callback(payload);
    ipcRenderer.on("ui:dock-state", wrapped);
    return () => ipcRenderer.off("ui:dock-state", wrapped);
  }
});
