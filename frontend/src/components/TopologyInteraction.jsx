import { useEffect, useRef } from "react";
import { Maximize2, Minus, Plus, RotateCcw } from "lucide-react";

const MIN_ZOOM = 0.55;
const MAX_ZOOM = 2.8;
const STEP = 0.15;

function clamp(value) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

function isTopologySvg(svg) {
  if (!svg) return false;
  const classes = svg.getAttribute("class") || "";
  const viewBox = svg.getAttribute("viewBox") || "";
  return classes.includes("min-w-[1000px]") || classes.includes("min-w-[1100px]") || viewBox.startsWith("0 0 1400 920");
}

function makeButton(title, icon, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.title = title;
  button.setAttribute("aria-label", title);
  button.className = "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-900/90 text-slate-300 shadow-lg transition hover:border-slate-500 hover:bg-slate-800 hover:text-white";
  button.appendChild(icon);
  button.addEventListener("click", onClick);
  return button;
}

function createToolbar(svg, state, update) {
  const host = svg.parentElement;
  if (!host || host.querySelector("[data-topology-zoom-toolbar]")) return;

  const toolbar = document.createElement("div");
  toolbar.dataset.topologyZoomToolbar = "true";
  toolbar.className = "pointer-events-auto absolute right-4 top-4 z-20 flex items-center gap-1 rounded-xl border border-slate-700/80 bg-[#08101c]/95 p-1.5 shadow-2xl backdrop-blur-xl";

  const zoomOut = makeButton("Zoom out", Minus, () => update(clamp(state.zoom - STEP)));
  const reset = makeButton("Reset view", RotateCcw, () => {
    state.zoom = 1;
    state.x = 0;
    state.y = 0;
    update();
  });
  const zoomIn = makeButton("Zoom in", Plus, () => update(clamp(state.zoom + STEP)));
  const fit = makeButton("Fit / center", Maximize2, () => {
    state.zoom = 1;
    state.x = 0;
    state.y = 0;
    update();
  });

  const readout = document.createElement("span");
  readout.className = "min-w-[52px] px-1 text-center font-mono text-[10px] font-semibold text-slate-400";

  toolbar.append(zoomOut, readout, zoomIn, fit, reset);
  host.appendChild(toolbar);
  state.toolbar = toolbar;
  state.readout = readout;
}

function installOnSvg(svg) {
  if (!isTopologySvg(svg) || svg.dataset.topologyInteractive === "true") return;
  const host = svg.parentElement;
  if (!host) return;

  host.classList.add("relative");
  svg.dataset.topologyInteractive = "true";
  svg.style.transformOrigin = "center center";
  svg.style.willChange = "transform";
  svg.style.cursor = "grab";
  svg.style.touchAction = "none";

  const state = { zoom: 1, x: 0, y: 0, dragging: false, pointerId: null, lastX: 0, lastY: 0, toolbar: null, readout: null };

  const render = () => {
    svg.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.zoom})`;
    if (state.readout) state.readout.textContent = `${Math.round(state.zoom * 100)}%`;
  };

  const updateZoom = (nextZoom) => {
    if (typeof nextZoom === "number") state.zoom = clamp(nextZoom);
    render();
  };

  createToolbar(svg, state, updateZoom);
  render();

  const onWheel = (event) => {
    event.preventDefault();
    const direction = event.deltaY < 0 ? 1 : -1;
    updateZoom(state.zoom + direction * STEP);
  };

  const onPointerDown = (event) => {
    if (event.target !== svg) return;
    state.dragging = true;
    state.pointerId = event.pointerId;
    state.lastX = event.clientX;
    state.lastY = event.clientY;
    svg.style.cursor = "grabbing";
    svg.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event) => {
    if (!state.dragging || event.pointerId !== state.pointerId) return;
    state.x += event.clientX - state.lastX;
    state.y += event.clientY - state.lastY;
    state.lastX = event.clientX;
    state.lastY = event.clientY;
    render();
  };

  const stopDrag = (event) => {
    if (event.pointerId != null && state.pointerId != null && event.pointerId !== state.pointerId) return;
    state.dragging = false;
    state.pointerId = null;
    svg.style.cursor = "grab";
  };

  svg.addEventListener("wheel", onWheel, { passive: false });
  svg.addEventListener("pointerdown", onPointerDown);
  svg.addEventListener("pointermove", onPointerMove);
  svg.addEventListener("pointerup", stopDrag);
  svg.addEventListener("pointercancel", stopDrag);
  svg.addEventListener("pointerleave", stopDrag);

  const cleanup = () => {
    svg.removeEventListener("wheel", onWheel);
    svg.removeEventListener("pointerdown", onPointerDown);
    svg.removeEventListener("pointermove", onPointerMove);
    svg.removeEventListener("pointerup", stopDrag);
    svg.removeEventListener("pointercancel", stopDrag);
    svg.removeEventListener("pointerleave", stopDrag);
    state.toolbar?.remove();
    delete svg.dataset.topologyInteractive;
  };

  svg._netEscalateTopologyCleanup = cleanup;
}

export default function TopologyInteraction() {
  const observerRef = useRef(null);

  useEffect(() => {
    const scan = () => document.querySelectorAll("svg").forEach(installOnSvg);
    scan();

    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
    observerRef.current = observer;

    return () => {
      observer.disconnect();
      document.querySelectorAll("svg[data-topology-interactive=\"true\"]").forEach(svg => svg._netEscalateTopologyCleanup?.());
      observerRef.current = null;
    };
  }, []);

  return null;
}
