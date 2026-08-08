import { filesForStep } from "./file-paths.js";

const state = {
  catalog: null,
  runs: [],
  detail: null,
  workflow: null,
  filter: "all",
  query: "",
  selectedNode: null,
  activeFile: null,
  positions: new Map(),
  transform: { x: 0, y: 0, scale: 1 },
  grid: true,
  pointer: null,
  graphLayout: null,
  draggingNode: null,
  mapMode: "current",
};

const elements = {
  workflowList: document.querySelector("#workflow-list"),
  workflowCount: document.querySelector("#workflow-count"),
  workflowSearch: document.querySelector("#workflow-search"),
  catalogMeta: document.querySelector("#catalog-meta"),
  topbarWorkflow: document.querySelector("#topbar-workflow"),
  topbarStatus: document.querySelector("#topbar-status"),
  canvasTitle: document.querySelector("#canvas-title"),
  mapMode: document.querySelector("#map-mode"),
  diagnosticBanner: document.querySelector("#diagnostic-banner"),
  graphViewport: document.querySelector("#graph-viewport"),
  graphEmpty: document.querySelector("#graph-empty"),
  graphSvg: document.querySelector("#graph-svg"),
  zoomReadout: document.querySelector("#zoom-readout"),
  inspectorTitle: document.querySelector("#inspector-title"),
  inspectorBody: document.querySelector("#inspector-body"),
  sidebar: document.querySelector("#sidebar"),
  inspector: document.querySelector("#inspector"),
  runToggle: document.querySelector("#run-toggle"),
  scrim: document.querySelector("#mobile-scrim"),
  fileModal: document.querySelector("#file-modal"),
  fileModalTitle: document.querySelector("#file-modal-title"),
  fileModalPath: document.querySelector("#file-modal-path"),
  fileModalKind: document.querySelector("#file-modal-kind"),
  fileModalBody: document.querySelector("#file-modal-body"),
  fileModalClose: document.querySelector("#file-modal-close"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function typeLabel(type) {
  if (type === "call" || type === "skill") return "Skill";
  if (type === "switch") return "Switch";
  if (type === "start") return "开始";
  if (type === "end") return "结束";
  return type;
}

function statusFor(detail) {
  return detail?.diagnostics?.length ? "needs_changes" : "passed";
}

function statusLabel(status) {
  if (status === "passed") return "已校验";
  if (status === "needs_changes") return "需关注";
  return "阻塞";
}

function runStatusLabel(status) {
  return { running: "运行中", completed: "已完成", cancelled: "已取消", failed: "失败", blocked: "等待决定" }[status] ?? status;
}

function runStatusClass(status) {
  return status === "completed" ? "status-passed" : status === "blocked" || status === "failed" ? "status-needs_changes" : "status-running";
}

function fileIcon(kind) {
  return { workflow: "YAML", skill: "SKILL", check: "CHECK", model: "JSON" }[kind] ?? "FILE";
}

function setMobilePanel(panel) {
  elements.sidebar.classList.toggle("is-open", panel === "sidebar");
  elements.inspector.classList.toggle("is-open", panel === "inspector");
  elements.scrim.classList.toggle("is-visible", panel !== null);
}

function renderWorkflowList() {
  if (!state.catalog) return;
  const workflows = state.catalog.workflows.filter((workflow) => {
    const matchesFilter = state.filter === "all" || workflow.entry;
    const haystack = [workflow.name, workflow.title, ...(workflow.routing?.aliases ?? [])].join(" ").toLowerCase();
    return matchesFilter && haystack.includes(state.query.toLowerCase());
  });
  elements.workflowCount.textContent = String(state.catalog.workflows.length);
  elements.catalogMeta.textContent = `${state.catalog.workflows.length} 个 Workflow · Catalog 已同步`;
  if (workflows.length === 0) {
    elements.workflowList.innerHTML = '<div class="list-empty">没有匹配的 Workflow</div>';
    return;
  }
  elements.workflowList.innerHTML = workflows.map((workflow) => `
    <button class="workflow-item${state.workflow?.name === workflow.name ? " is-active" : ""}" type="button" data-workflow="${escapeHtml(workflow.name)}">
      <span class="workflow-dot${workflow.entry ? " is-entry" : ""}"></span>
      <span class="workflow-item-copy">
        <strong>${escapeHtml(workflow.title || workflow.name)}</strong>
        <span class="workflow-item-id">${escapeHtml(workflow.name)}</span>
        <span class="workflow-item-meta">v${escapeHtml(workflow.version)}${workflow.entry ? " · 入口" : " · 前置"}</span>
      </span>
      <span class="chevron" aria-hidden="true">›</span>
    </button>`).join("");
}

function activeGraph() {
  return state.mapMode === "expanded" && state.detail?.expandedGraph
    ? state.detail.expandedGraph
    : state.detail?.graph;
}

function activeSteps() {
  return state.mapMode === "expanded" && state.detail?.expandedGraph
    ? state.detail.expandedSteps ?? []
    : state.detail?.steps ?? [];
}

function syncMapMode() {
  const hasExpandedGraph = Boolean(state.detail?.expandedGraph);
  elements.mapMode.hidden = !hasExpandedGraph;
  document.querySelectorAll("[data-map-mode]").forEach((button) => {
    const active = button.dataset.mapMode === state.mapMode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  if (state.workflow) {
    elements.canvasTitle.textContent = state.mapMode === "expanded"
      ? `${state.detail.catalog.title} · 含前置 Workflow`
      : state.detail.catalog.title;
  }
}

function layoutGraph(graph) {
  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];
  const levels = new Map();
  const start = nodes.find((node) => node.type === "start");
  if (start) levels.set(start.id, 0);
  for (let pass = 0; pass < nodes.length + 1; pass += 1) {
    let changed = false;
    for (const edge of edges) {
      const sourceLevel = levels.get(edge.sourceId);
      if (sourceLevel === undefined) continue;
      const sourceIndex = nodes.findIndex((node) => node.id === edge.sourceId);
      const target = nodes.find((node) => node.id === edge.targetId);
      const targetIndex = nodes.findIndex((node) => node.id === edge.targetId);
      if (target?.type !== "end" && targetIndex <= sourceIndex) continue;
      const nextLevel = sourceLevel + 1;
      if (!levels.has(edge.targetId) || levels.get(edge.targetId) < nextLevel) {
        levels.set(edge.targetId, nextLevel);
        changed = true;
      }
    }
    if (!changed) break;
  }
  nodes.forEach((node, index) => {
    if (!levels.has(node.id)) levels.set(node.id, index % 4);
  });
  const buckets = new Map();
  for (const node of nodes) {
    const level = levels.get(node.id) ?? 0;
    const bucket = buckets.get(level) ?? [];
    bucket.push(node);
    buckets.set(level, bucket);
  }
  const positions = new Map();
  let width = 920;
  let height = 560;
  for (const [level, bucket] of buckets.entries()) {
    bucket.forEach((node, index) => {
      const x = 150 + index * 260;
      const y = 90 + level * 132;
      positions.set(node.id, { x, y, level, width: node.type === "switch" ? 108 : 196, height: node.type === "start" || node.type === "end" ? 56 : 72 });
      width = Math.max(width, x + 170);
      height = Math.max(height, y + 130);
    });
  }
  return { positions, width, height };
}

function edgePath(edge, positions) {
  const source = positions.get(edge.sourceId);
  const target = positions.get(edge.targetId);
  if (!source || !target) return "";
  const loop = target.level <= source.level;
  if (loop) {
    const offset = Math.max(70, Math.abs(target.x - source.x) / 2);
    return `M ${source.x} ${source.y + source.height / 2} C ${source.x + offset} ${source.y + 110}, ${target.x + offset} ${target.y - 110}, ${target.x} ${target.y - target.height / 2}`;
  }
  const midY = source.y + (target.y - source.y) / 2;
  return `M ${source.x} ${source.y + source.height / 2} C ${source.x} ${midY}, ${target.x} ${midY}, ${target.x} ${target.y - target.height / 2}`;
}

function renderGraph() {
  const graph = activeGraph();
  if (!graph) {
    elements.graphSvg.classList.remove("is-visible");
    elements.graphEmpty.classList.remove("is-hidden");
    return;
  }
  const layout = layoutGraph(graph);
  const isNewGraph = state.graphLayout?.id !== graph.id;
  if (isNewGraph) {
    state.positions = layout.positions;
    state.graphLayout = { id: graph.id, width: layout.width, height: layout.height };
  }
  const graphLayout = state.graphLayout ?? layout;
  const shouldFit = isNewGraph && (!state.transform.scale || state.transform.scale === 1);
  elements.graphEmpty.classList.add("is-hidden");
  elements.graphSvg.classList.add("is-visible");
  elements.graphSvg.setAttribute("viewBox", `0 0 ${graphLayout.width} ${graphLayout.height}`);
  const defs = `<defs><marker id="arrow-head" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z"></path></marker></defs>`;
  const edges = graph.edges.map((edge) => {
    const loop = (state.positions.get(edge.targetId)?.level ?? 0) <= (state.positions.get(edge.sourceId)?.level ?? 0);
    const source = state.positions.get(edge.sourceId);
    const target = state.positions.get(edge.targetId);
    const labelX = source && target ? (source.x + target.x) / 2 : 0;
    const labelY = source && target ? (source.y + target.y) / 2 : 0;
    return `<g class="graph-edge${loop ? " is-loop" : ""}"><path d="${edgePath(edge, state.positions)}" marker-end="url(#arrow-head)"></path>${edge.label ? `<text x="${labelX}" y="${labelY}"><tspan>${escapeHtml(edge.label)}</tspan></text>` : ""}</g>`;
  }).join("");
  const nodes = graph.nodes.filter((node) => node.type !== "root").map((node) => {
    const position = state.positions.get(node.id);
    if (!position) return "";
    const isSelected = state.selectedNode === node.id;
    const type = node.type === "call" ? "skill" : node.type;
    const label = node.label || (type === "start" ? "开始" : type === "end" ? "结束" : node.id);
    const isPrerequisite = state.mapMode === "expanded" && label.startsWith("[") && !label.includes(`[${state.workflow?.name}]`);
    const shape = type === "switch"
      ? `<polygon points="${position.x},${position.y - position.height / 2} ${position.x + position.width / 2},${position.y} ${position.x},${position.y + position.height / 2} ${position.x - position.width / 2},${position.y}"></polygon>`
      : type === "start" || type === "end"
        ? `<circle cx="${position.x}" cy="${position.y}" r="${type === "start" ? 18 : 22}"></circle>`
        : `<rect x="${position.x - position.width / 2}" y="${position.y - position.height / 2}" width="${position.width}" height="${position.height}" rx="10"></rect>`;
    return `<g class="graph-node node-${escapeHtml(type)}${isPrerequisite ? " is-prerequisite" : ""}${isSelected ? " is-selected" : ""}${state.draggingNode === node.id ? " is-dragging" : ""}" data-node-id="${escapeHtml(node.id)}" tabindex="0" role="button" aria-label="${escapeHtml(typeLabel(type))}：${escapeHtml(label)}">${shape}<text class="node-label" x="${position.x}" y="${position.y - (type === "start" || type === "end" ? -34 : 7)}"><tspan>${escapeHtml(label)}</tspan></text>${type === "skill" ? `<text class="node-kind" x="${position.x}" y="${position.y + 19}">Skill</text>` : ""}</g>`;
  }).join("");
  elements.graphSvg.innerHTML = `${defs}<g class="graph-content" transform="translate(${state.transform.x} ${state.transform.y}) scale(${state.transform.scale})">${edges}${nodes}</g>`;
  if (shouldFit) fitView();
  updateZoomReadout();
}

function updateZoomReadout() {
  elements.zoomReadout.textContent = `${Math.round(state.transform.scale * 100)}%`;
}

function fitView() {
  if (!activeGraph()) return;
  state.transform = { x: 0, y: 0, scale: 1 };
  renderGraphWithoutLayout();
}

function renderGraphWithoutLayout() {
  const content = elements.graphSvg.querySelector(".graph-content");
  if (content) content.setAttribute("transform", `translate(${state.transform.x} ${state.transform.y}) scale(${state.transform.scale})`);
  updateZoomReadout();
}

function clientToSvgPoint(clientX, clientY) {
  const matrix = elements.graphSvg.getScreenCTM();
  if (matrix) {
    const point = elements.graphSvg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    return point.matrixTransform(matrix.inverse());
  }
  const rect = elements.graphSvg.getBoundingClientRect();
  const viewBox = elements.graphSvg.viewBox.baseVal;
  return {
    x: (clientX - rect.left) * viewBox.width / Math.max(rect.width, 1),
    y: (clientY - rect.top) * viewBox.height / Math.max(rect.height, 1),
  };
}

function renderDiagnostic() {
  const diagnostics = state.detail?.diagnostics ?? [];
  elements.diagnosticBanner.classList.toggle("is-hidden", diagnostics.length === 0);
  elements.diagnosticBanner.innerHTML = diagnostics.length
    ? `<span class="diagnostic-icon">!</span><strong>${diagnostics.length} 个编译诊断</strong><span>${escapeHtml(diagnostics[0].message)}</span>`
    : "";
}

function renderRunObserver() {
  const runs = state.runs.filter((run) => run.workflow?.name === state.workflow?.name);
  const latest = runs[0];
  if (!latest) {
    return `<section class="run-observer-block"><div class="section-heading"><h3>运行观察</h3><span>0</span></div><p class="observer-empty">当前 Workflow 暂无 Runtime Run</p></section>`;
  }
  const stepRows = latest.steps.slice(-5).map((step) => `<div class="run-step-row"><span class="run-step-status ${runStatusClass(step.status)}"></span><span class="mono">${escapeHtml(step.id)}</span><span>${runStatusLabel(step.status)} · ${step.attempt} 次</span></div>`).join("");
  const evidence = latest.steps.flatMap((step) => step.evidence.map((item) => `${step.id}: ${item}`)).slice(-3);
  return `<section class="run-observer-block"><div class="section-heading"><h3>运行观察</h3><span>${runs.length} 个 Run</span></div><div class="run-summary-row"><span class="status-text ${runStatusClass(latest.status)}">${runStatusLabel(latest.status)}</span><span class="mono observer-run-id">${escapeHtml(latest.runId)}</span></div><dl class="detail-list run-detail-list"><div><dt>当前 Step</dt><dd class="mono">${escapeHtml(latest.currentStep?.id ?? "无")}</dd></div><div><dt>版本 / 源哈希</dt><dd class="mono">v${escapeHtml(latest.workflow.version)} · ${escapeHtml(latest.workflow.sourceHash)}</dd></div><div><dt>工作区</dt><dd class="mono">${escapeHtml(latest.workspaceRoot)}</dd></div>${latest.blockedReason ? `<div><dt>阻塞原因</dt><dd>${escapeHtml(latest.blockedReason)}</dd></div>` : ""}</dl><div class="run-step-list">${stepRows || '<span class="observer-empty">尚未产生 Step 记录</span>'}</div>${evidence.length ? `<div class="run-evidence"><strong>最近证据</strong>${evidence.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : ""}</section>`;
}

function renderInspector() {
  const detail = state.detail;
  if (!detail) {
    elements.inspectorTitle.textContent = "Workflow 摘要";
    elements.inspectorBody.innerHTML = '<div class="inspector-empty">选择一个 Workflow 开始浏览</div>';
    return;
  }
  const step = activeSteps().find((item) => item.nodeId === state.selectedNode);
  elements.inspectorTitle.textContent = step ? step.id : "Workflow 摘要";
  const status = statusFor(detail);
  const graphEdges = activeGraph()?.edges ?? [];
  const outgoing = step ? graphEdges.filter((edge) => edge.sourceId === step.nodeId) : [];
  const files = step ? filesForStep(detail, step) : detail.files;
  elements.inspectorBody.innerHTML = `
    ${renderRunObserver()}
    <section class="summary-block">
      <div class="summary-title-row"><span class="type-chip ${step ? "type-skill" : "type-workflow"}">${step ? typeLabel(step.kind) : "Workflow"}</span><span class="status-text status-${status}">${statusLabel(status)}</span></div>
      <h3>${escapeHtml(step ? step.id : detail.catalog.title)}</h3>
      <p class="summary-copy">${escapeHtml(step ? (step.call ? `调用 ${step.call}` : "根据 Check 状态选择下一步") : detail.catalog.summary || "暂无摘要" )}</p>
      ${step ? `<dl class="detail-list"><div><dt>Step ID</dt><dd class="mono">${escapeHtml(step.id)}</dd></div>${step.call ? `<div><dt>Skill</dt><dd class="mono">${escapeHtml(step.call)}</dd></div>` : ""}<div><dt>Checks</dt><dd>${step.checks.length ? step.checks.map((check) => `<span class="mini-tag">${escapeHtml(check)}</span>`).join("") : "无绑定 Check"}</dd></div><div><dt>下一步</dt><dd>${outgoing.length ? outgoing.map((edge) => `<span class="transition-row">${escapeHtml(edge.label || "顺序")} → ${escapeHtml(edge.targetId)}</span>`).join("") : "结束"}</dd></div></dl>` : `<dl class="detail-list"><div><dt>版本</dt><dd class="mono">v${escapeHtml(detail.catalog.version)}</dd></div><div><dt>入口</dt><dd>${detail.entry ? "是" : "前置 Workflow"}</dd></div><div><dt>Steps</dt><dd>${detail.steps.length}</dd></div><div><dt>关联文件</dt><dd>${detail.files.length}</dd></div></dl>`}
    </section>
    <section class="files-block"><div class="section-heading"><h3>关联文件</h3><span>${files.length}</span></div><div class="file-list">${files.map((file) => `<button class="file-item${state.activeFile === file.path ? " is-active" : ""}" type="button" data-file="${escapeHtml(file.path)}"><span class="file-icon file-${file.kind}">${fileIcon(file.kind)}</span><span><strong>${escapeHtml(file.label)}</strong><small>${escapeHtml(file.path)}</small></span><span class="chevron">›</span></button>`).join("")}</div></section>
    ${detail.diagnostics.length ? `<section class="diagnostics-block"><div class="section-heading"><h3>编译诊断</h3><span>${detail.diagnostics.length}</span></div>${detail.diagnostics.map((diagnostic) => `<div class="diagnostic-item"><strong>${escapeHtml(diagnostic.code)}</strong><span>${escapeHtml(diagnostic.message)}</span></div>`).join("")}</section>` : ""}`;
}

function renderCodeFrame(file, className = "") {
  const lines = file.content.split("\n");
  return `<div class="code-frame ${className}"><div class="line-numbers">${lines.map((_, index) => `<span>${index + 1}</span>`).join("")}</div><pre><code>${escapeHtml(file.content)}</code></pre></div>`;
}

function openFileModal(file) {
  elements.fileModalTitle.textContent = file.label;
  elements.fileModalPath.textContent = file.path;
  elements.fileModalKind.textContent = fileIcon(file.kind);
  elements.fileModalBody.innerHTML = renderCodeFrame(file, "code-frame-modal");
  elements.fileModal.hidden = false;
  document.body.classList.add("modal-open");
  elements.fileModalClose?.focus();
}

function closeFileModal() {
  elements.fileModal.hidden = true;
  document.body.classList.remove("modal-open");
}

function loadWorkflow(name) {
  return fetch(`/api/workflows/${encodeURIComponent(name)}`).then(async (response) => {
    if (!response.ok) throw new Error((await response.json()).error || "Workflow 加载失败");
    return response.json();
  });
}

async function selectWorkflow(name) {
  state.workflow = state.catalog?.workflows.find((workflow) => workflow.name === name) ?? null;
  state.detail = null;
  state.selectedNode = null;
  state.activeFile = null;
  state.mapMode = "current";
  state.transform = { x: 0, y: 0, scale: 1 };
  state.positions = new Map();
  state.graphLayout = null;
  renderWorkflowList();
  if (!state.workflow) return;
  elements.canvasTitle.textContent = state.workflow.title || state.workflow.name;
  elements.topbarWorkflow.textContent = state.workflow.name;
  elements.topbarStatus.textContent = "加载中";
  elements.graphSvg.classList.remove("is-visible");
  elements.graphEmpty.classList.remove("is-hidden");
  elements.graphEmpty.innerHTML = '<span class="loading-dot"></span><strong>正在加载 Workflow</strong><span>读取 Compiler 生成的流程图和关联文件</span>';
  try {
    state.detail = await loadWorkflow(name);
    state.topbarStatus = statusFor(state.detail);
    elements.topbarStatus.textContent = statusLabel(statusFor(state.detail));
    state.mapMode = state.detail.expandedGraph ? "expanded" : "current";
    syncMapMode();
    renderDiagnostic();
    renderGraph();
    renderInspector();
    window.history.replaceState(null, "", `#workflow=${encodeURIComponent(name)}`);
    setMobilePanel(null);
  } catch (error) {
    elements.graphEmpty.innerHTML = `<span class="empty-glyph">!</span><strong>Workflow 加载失败</strong><span>${escapeHtml(error.message)}</span><button class="retry-button" id="retry-workflow" type="button">重试</button>`;
    elements.topbarStatus.textContent = "加载失败";
  }
}

async function loadCatalog() {
  if (window.location.protocol === "file:") {
    throw new Error("请通过 npm run workflow:ui 启动本地服务后访问 http://127.0.0.1:4173，不能直接打开 index.html。");
  }
  const response = await fetch("/api/workflows");
  if (!response.ok) throw new Error("无法读取 Workflow Catalog");
  state.catalog = await response.json();
  await loadRuns();
  renderWorkflowList();
  const hashName = new URLSearchParams(window.location.hash.slice(1)).get("workflow");
  const selected = state.catalog.workflows.find((workflow) => workflow.name === hashName) ?? state.catalog.workflows.find((workflow) => workflow.entry) ?? state.catalog.workflows[0];
  if (selected) await selectWorkflow(selected.name);
}

async function loadRuns() {
  try {
    const response = await fetch("/api/runs");
    if (!response.ok) throw new Error("无法读取 Runtime Run");
    const body = await response.json();
    state.runs = Array.isArray(body.runs) ? body.runs : [];
  } catch {
    state.runs = [];
  }
}

function changeZoom(delta, anchor) {
  const previousScale = state.transform.scale;
  const nextScale = Math.max(0.42, Math.min(1.8, previousScale + delta));
  if (anchor && nextScale !== previousScale) {
    const point = clientToSvgPoint(anchor.clientX, anchor.clientY);
    const ratio = nextScale / previousScale;
    state.transform.x = point.x - (point.x - state.transform.x) * ratio;
    state.transform.y = point.y - (point.y - state.transform.y) * ratio;
  }
  state.transform.scale = nextScale;
  renderGraphWithoutLayout();
}

function selectNode(nodeId) {
  state.selectedNode = nodeId;
  state.activeFile = null;
  renderGraph();
  renderInspector();
  setMobilePanel("inspector");
}

function onPointerDown(event) {
  if (event.button !== 0 && event.pointerType !== "touch") return;
  const node = event.target.closest?.(".graph-node");
  const nodeId = node?.dataset.nodeId;
  const position = nodeId === undefined ? undefined : state.positions.get(nodeId);
  const point = clientToSvgPoint(event.clientX, event.clientY);
  state.pointer = nodeId !== undefined && position
    ? { id: event.pointerId, mode: "node", x: event.clientX, y: event.clientY, point, nodeId, position: { ...position }, moved: false }
    : { id: event.pointerId, mode: "canvas", x: event.clientX, y: event.clientY, point, transform: { ...state.transform }, moved: false };
  elements.graphViewport.setPointerCapture(event.pointerId);
}

function onPointerMove(event) {
  if (!state.pointer || state.pointer.id !== event.pointerId) return;
  const dx = event.clientX - state.pointer.x;
  const dy = event.clientY - state.pointer.y;
  if (!state.pointer.moved && Math.hypot(dx, dy) < 4) return;
  state.pointer.moved = true;
  const currentPoint = clientToSvgPoint(event.clientX, event.clientY);
  const svgDx = currentPoint.x - state.pointer.point.x;
  const svgDy = currentPoint.y - state.pointer.point.y;
  if (state.pointer.mode === "node") {
    state.draggingNode = state.pointer.nodeId;
    const position = state.positions.get(state.pointer.nodeId);
    if (!position) return;
    position.x = state.pointer.position.x + svgDx / state.transform.scale;
    position.y = state.pointer.position.y + svgDy / state.transform.scale;
  } else {
    state.transform.x = state.pointer.transform.x + svgDx;
    state.transform.y = state.pointer.transform.y + svgDy;
    elements.graphViewport.classList.add("is-panning");
  }
  renderGraph();
}

function onPointerUp(event) {
  if (state.pointer?.id !== event.pointerId) return;
  const pointer = state.pointer;
  const moved = pointer.moved;
  const shouldSelectNode = event.type === "pointerup" && !moved && pointer.mode === "node";
  if (moved || shouldSelectNode) elements.graphViewport.dataset.suppressClick = "true";
  if (elements.graphViewport.hasPointerCapture(event.pointerId)) elements.graphViewport.releasePointerCapture(event.pointerId);
  state.pointer = null;
  state.draggingNode = null;
  elements.graphViewport.classList.remove("is-panning");
  if (moved && state.detail) renderGraph();
  if (shouldSelectNode) selectNode(pointer.nodeId);
}

function bindEvents() {
  elements.workflowSearch.addEventListener("input", (event) => { state.query = event.target.value; renderWorkflowList(); });
  document.querySelectorAll("[data-map-mode]").forEach((button) => button.addEventListener("click", () => {
    state.mapMode = button.dataset.mapMode;
    state.selectedNode = null;
    state.activeFile = null;
    state.transform = { x: 0, y: 0, scale: 1 };
    state.positions = new Map();
    state.graphLayout = null;
    syncMapMode();
    renderGraph();
    renderInspector();
  }));
  document.querySelectorAll("[data-filter]").forEach((button) => button.addEventListener("click", () => {
    state.filter = button.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach((item) => item.classList.toggle("is-active", item === button));
    renderWorkflowList();
  }));
  elements.workflowList.addEventListener("click", (event) => {
    const item = event.target.closest?.("[data-workflow]");
    if (item) selectWorkflow(item.dataset.workflow);
  });
  elements.graphSvg.addEventListener("click", (event) => {
    if (elements.graphViewport.dataset.suppressClick === "true") {
      delete elements.graphViewport.dataset.suppressClick;
      return;
    }
    const node = event.target.closest?.(".graph-node");
    if (!node) return;
    selectNode(node.dataset.nodeId);
  });
  elements.graphSvg.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") event.target.click(); });
  elements.graphViewport.addEventListener("pointerdown", onPointerDown);
  elements.graphViewport.addEventListener("pointermove", onPointerMove);
  elements.graphViewport.addEventListener("pointerup", onPointerUp);
  elements.graphViewport.addEventListener("pointercancel", onPointerUp);
  elements.graphViewport.addEventListener("wheel", (event) => { event.preventDefault(); changeZoom(event.deltaY < 0 ? 0.08 : -0.08, event); }, { passive: false });
  elements.inspectorBody.addEventListener("click", (event) => {
    const fileButton = event.target.closest?.("[data-file]");
    if (fileButton) {
      state.activeFile = fileButton.dataset.file;
      const file = state.detail?.files.find((item) => item.path === state.activeFile);
      renderInspector();
      if (file) openFileModal(file);
      return;
    }
  });
  document.querySelector("#zoom-in").addEventListener("click", () => changeZoom(0.1));
  document.querySelector("#zoom-out").addEventListener("click", () => changeZoom(-0.1));
  document.querySelector("#fit-view").addEventListener("click", fitView);
  document.querySelector("#grid-toggle").addEventListener("click", (event) => {
    state.grid = !state.grid;
    event.currentTarget.classList.toggle("is-active", state.grid);
    event.currentTarget.setAttribute("aria-pressed", String(state.grid));
    elements.graphViewport.classList.toggle("no-grid", !state.grid);
  });
  document.querySelector("#file-modal-close").addEventListener("click", closeFileModal);
  document.querySelector("[data-close-file-modal]").addEventListener("click", closeFileModal);
  document.querySelector("#modal-copy-file").addEventListener("click", async () => {
    const file = state.detail?.files.find((item) => item.path === state.activeFile);
    if (file) await navigator.clipboard?.writeText(file.content);
  });
  document.querySelector("#refresh-button").addEventListener("click", () => loadCatalog().catch(showFatalError));
  elements.runToggle?.addEventListener("click", () => { setMobilePanel("inspector"); elements.inspectorBody.scrollTo({ top: 0, behavior: "smooth" }); });
  document.querySelector("#nav-toggle").addEventListener("click", () => setMobilePanel("sidebar"));
  document.querySelector("#inspector-toggle").addEventListener("click", () => setMobilePanel("inspector"));
  document.querySelector("#inspector-close").addEventListener("click", () => setMobilePanel(null));
  elements.scrim.addEventListener("click", () => setMobilePanel(null));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.fileModal.hidden) closeFileModal();
  });
  window.addEventListener("resize", () => { if (state.detail) renderGraph(); });
}

function showFatalError(error) {
  elements.graphEmpty.classList.remove("is-hidden");
  elements.graphEmpty.innerHTML = `<span class="empty-glyph">!</span><strong>管理页面无法加载</strong><span>${escapeHtml(error.message)}</span><button class="retry-button" id="retry-catalog" type="button">重试</button>`;
}

bindEvents();
loadCatalog().catch(showFatalError);
