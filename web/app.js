const state = {
  catalog: null,
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
  scrim: document.querySelector("#mobile-scrim"),
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
    ? state.detail.expandedSteps
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
  state.positions = layout.positions;
  if (!state.transform.scale || state.transform.scale === 1) fitView(layout);
  elements.graphEmpty.classList.add("is-hidden");
  elements.graphSvg.classList.add("is-visible");
  elements.graphSvg.setAttribute("viewBox", `0 0 ${layout.width} ${layout.height}`);
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
    return `<g class="graph-node node-${escapeHtml(type)}${isPrerequisite ? " is-prerequisite" : ""}${isSelected ? " is-selected" : ""}" data-node-id="${escapeHtml(node.id)}" tabindex="0" role="button" aria-label="${escapeHtml(typeLabel(type))}：${escapeHtml(label)}">${shape}<text class="node-label" x="${position.x}" y="${position.y - (type === "start" || type === "end" ? -34 : 7)}"><tspan>${escapeHtml(label)}</tspan></text>${type === "skill" ? `<text class="node-kind" x="${position.x}" y="${position.y + 19}">Skill</text>` : ""}</g>`;
  }).join("");
  elements.graphSvg.innerHTML = `${defs}<g class="graph-content" transform="translate(${state.transform.x} ${state.transform.y}) scale(${state.transform.scale})">${edges}${nodes}</g>`;
  updateZoomReadout();
}

function updateZoomReadout() {
  elements.zoomReadout.textContent = `${Math.round(state.transform.scale * 100)}%`;
}

function fitView(layout = layoutGraph(activeGraph() ?? { nodes: [], edges: [] })) {
  const rect = elements.graphViewport.getBoundingClientRect();
  const scale = Math.min((rect.width - 64) / layout.width, (rect.height - 64) / layout.height, 1.2);
  state.transform.scale = Math.max(0.42, Math.min(scale, 1.2));
  state.transform.x = (rect.width - layout.width * state.transform.scale) / 2;
  state.transform.y = (rect.height - layout.height * state.transform.scale) / 2;
  renderGraphWithoutLayout();
}

function renderGraphWithoutLayout() {
  const content = elements.graphSvg.querySelector(".graph-content");
  if (content) content.setAttribute("transform", `translate(${state.transform.x} ${state.transform.y}) scale(${state.transform.scale})`);
  updateZoomReadout();
}

function renderDiagnostic() {
  const diagnostics = state.detail?.diagnostics ?? [];
  elements.diagnosticBanner.classList.toggle("is-hidden", diagnostics.length === 0);
  elements.diagnosticBanner.innerHTML = diagnostics.length
    ? `<span class="diagnostic-icon">!</span><strong>${diagnostics.length} 个编译诊断</strong><span>${escapeHtml(diagnostics[0].message)}</span>`
    : "";
}

function renderInspector() {
  const detail = state.detail;
  if (!detail) {
    elements.inspectorTitle.textContent = "Workflow 摘要";
    elements.inspectorBody.innerHTML = '<div class="inspector-empty">选择一个 Workflow 开始浏览</div>';
    return;
  }
  const step = activeSteps().find((item) => item.nodeId === state.selectedNode);
  if (state.activeFile) {
    const file = detail.files.find((item) => item.path === state.activeFile);
    if (file) {
      renderFileInspector(file);
      return;
    }
  }
  elements.inspectorTitle.textContent = step ? step.id : "Workflow 摘要";
  const status = statusFor(detail);
  const graphEdges = activeGraph()?.edges ?? [];
  const outgoing = step ? graphEdges.filter((edge) => edge.sourceId === step.nodeId) : [];
  const files = step ? detail.files.filter((file) => file.path.includes(`/${step.call}/`) || step.checks.some((check) => file.path.includes(`/${check}/`)) || file.kind === "workflow" || (step.workflowName !== undefined && file.path.includes(`/${step.workflowName}/`))) : detail.files;
  elements.inspectorBody.innerHTML = `
    <section class="summary-block">
      <div class="summary-title-row"><span class="type-chip ${step ? "type-skill" : "type-workflow"}">${step ? typeLabel(step.kind) : "Workflow"}</span><span class="status-text status-${status}">${statusLabel(status)}</span></div>
      <h3>${escapeHtml(step ? step.id : detail.catalog.title)}</h3>
      <p class="summary-copy">${escapeHtml(step ? (step.call ? `调用 ${step.call}` : "根据 Check 状态选择下一步") : detail.catalog.summary || "暂无摘要" )}</p>
      ${step ? `<dl class="detail-list"><div><dt>Step ID</dt><dd class="mono">${escapeHtml(step.id)}</dd></div>${step.call ? `<div><dt>Skill</dt><dd class="mono">${escapeHtml(step.call)}</dd></div>` : ""}<div><dt>Checks</dt><dd>${step.checks.length ? step.checks.map((check) => `<span class="mini-tag">${escapeHtml(check)}</span>`).join("") : "无绑定 Check"}</dd></div><div><dt>下一步</dt><dd>${outgoing.length ? outgoing.map((edge) => `<span class="transition-row">${escapeHtml(edge.label || "顺序")} → ${escapeHtml(edge.targetId)}</span>`).join("") : "结束"}</dd></div></dl>` : `<dl class="detail-list"><div><dt>版本</dt><dd class="mono">v${escapeHtml(detail.catalog.version)}</dd></div><div><dt>入口</dt><dd>${detail.entry ? "是" : "前置 Workflow"}</dd></div><div><dt>Steps</dt><dd>${detail.steps.length}</dd></div><div><dt>关联文件</dt><dd>${detail.files.length}</dd></div></dl>`}
    </section>
    <section class="files-block"><div class="section-heading"><h3>关联文件</h3><span>${files.length}</span></div><div class="file-list">${files.map((file) => `<button class="file-item${state.activeFile === file.path ? " is-active" : ""}" type="button" data-file="${escapeHtml(file.path)}"><span class="file-icon file-${file.kind}">${fileIcon(file.kind)}</span><span><strong>${escapeHtml(file.label)}</strong><small>${escapeHtml(file.path)}</small></span><span class="chevron">›</span></button>`).join("")}</div></section>
    ${detail.diagnostics.length ? `<section class="diagnostics-block"><div class="section-heading"><h3>编译诊断</h3><span>${detail.diagnostics.length}</span></div>${detail.diagnostics.map((diagnostic) => `<div class="diagnostic-item"><strong>${escapeHtml(diagnostic.code)}</strong><span>${escapeHtml(diagnostic.message)}</span></div>`).join("")}</section>` : ""}`;
}

function renderFileInspector(file) {
  elements.inspectorTitle.textContent = file.label;
  const lines = file.content.split("\n");
  elements.inspectorBody.innerHTML = `<section class="file-viewer"><div class="file-viewer-toolbar"><span class="mono file-path">${escapeHtml(file.path)}</span><button class="text-button" id="copy-file" type="button">复制内容</button></div><div class="code-frame"><div class="line-numbers">${lines.map((_, index) => `<span>${index + 1}</span>`).join("")}</div><pre><code>${escapeHtml(file.content)}</code></pre></div><button class="back-button" id="back-to-inspector" type="button">← 返回详情</button></section>`;
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
  const response = await fetch("/api/workflows");
  if (!response.ok) throw new Error("无法读取 Workflow Catalog");
  state.catalog = await response.json();
  renderWorkflowList();
  const hashName = new URLSearchParams(window.location.hash.slice(1)).get("workflow");
  const selected = state.catalog.workflows.find((workflow) => workflow.name === hashName) ?? state.catalog.workflows.find((workflow) => workflow.entry) ?? state.catalog.workflows[0];
  if (selected) await selectWorkflow(selected.name);
}

function changeZoom(delta) {
  state.transform.scale = Math.max(0.42, Math.min(1.8, state.transform.scale + delta));
  renderGraphWithoutLayout();
}

function onPointerDown(event) {
  if (event.target.closest?.(".graph-node")) return;
  state.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, transform: { ...state.transform } };
  elements.graphSvg.setPointerCapture(event.pointerId);
  elements.graphViewport.classList.add("is-panning");
}

function onPointerMove(event) {
  if (!state.pointer || state.pointer.id !== event.pointerId) return;
  state.transform.x = state.pointer.transform.x + event.clientX - state.pointer.x;
  state.transform.y = state.pointer.transform.y + event.clientY - state.pointer.y;
  renderGraphWithoutLayout();
}

function onPointerUp() {
  state.pointer = null;
  elements.graphViewport.classList.remove("is-panning");
}

function bindEvents() {
  elements.workflowSearch.addEventListener("input", (event) => { state.query = event.target.value; renderWorkflowList(); });
  document.querySelectorAll("[data-map-mode]").forEach((button) => button.addEventListener("click", () => {
    state.mapMode = button.dataset.mapMode;
    state.selectedNode = null;
    state.activeFile = null;
    state.transform = { x: 0, y: 0, scale: 1 };
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
    const node = event.target.closest?.(".graph-node");
    if (!node) return;
    state.selectedNode = node.dataset.nodeId;
    state.activeFile = null;
    renderGraph();
    renderInspector();
    setMobilePanel("inspector");
  });
  elements.graphSvg.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") event.target.click(); });
  elements.graphSvg.addEventListener("pointerdown", onPointerDown);
  elements.graphSvg.addEventListener("pointermove", onPointerMove);
  elements.graphSvg.addEventListener("pointerup", onPointerUp);
  elements.graphSvg.addEventListener("pointercancel", onPointerUp);
  elements.graphViewport.addEventListener("wheel", (event) => { event.preventDefault(); changeZoom(event.deltaY < 0 ? 0.08 : -0.08); }, { passive: false });
  elements.inspectorBody.addEventListener("click", async (event) => {
    const fileButton = event.target.closest?.("[data-file]");
    if (fileButton) { state.activeFile = fileButton.dataset.file; renderInspector(); return; }
    if (event.target.closest?.("#back-to-inspector")) { state.activeFile = null; renderInspector(); return; }
    if (event.target.closest?.("#copy-file") && state.activeFile) {
      const file = state.detail.files.find((item) => item.path === state.activeFile);
      if (file) await navigator.clipboard?.writeText(file.content);
    }
  });
  document.querySelector("#zoom-in").addEventListener("click", () => changeZoom(0.1));
  document.querySelector("#zoom-out").addEventListener("click", () => changeZoom(-0.1));
  document.querySelector("#fit-view").addEventListener("click", () => { state.transform.scale = 1; renderGraph(); });
  document.querySelector("#grid-toggle").addEventListener("click", () => { state.grid = !state.grid; elements.graphViewport.classList.toggle("no-grid", !state.grid); });
  document.querySelector("#refresh-button").addEventListener("click", () => loadCatalog().catch(showFatalError));
  document.querySelector("#nav-toggle").addEventListener("click", () => setMobilePanel("sidebar"));
  document.querySelector("#inspector-toggle").addEventListener("click", () => setMobilePanel("inspector"));
  document.querySelector("#inspector-close").addEventListener("click", () => setMobilePanel(null));
  elements.scrim.addEventListener("click", () => setMobilePanel(null));
  window.addEventListener("resize", () => { if (state.detail) renderGraph(); });
}

function showFatalError(error) {
  elements.graphEmpty.classList.remove("is-hidden");
  elements.graphEmpty.innerHTML = `<span class="empty-glyph">!</span><strong>管理页面无法加载</strong><span>${escapeHtml(error.message)}</span><button class="retry-button" id="retry-catalog" type="button">重试</button>`;
}

bindEvents();
loadCatalog().catch(showFatalError);
