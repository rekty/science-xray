import {
  parseSpec,
  layout,
  systemPrompt,
  userPrompt,
  isVerifiedModel,
  VERIFIED_MODELS,
  RETRY_INSTRUCTION,
  SHAPES,
  DEMO_SPEC,
} from "./shared/spec.js";
import {
  connected,
  startDevice,
  pollDevice,
  useKey,
  signOut,
  models,
  ask,
  DEFAULT_MODEL,
} from "./shared/pollen.js";

const NS = "http://www.w3.org/2000/svg";
const $ = (id) => document.getElementById(id);

const EXAMPLES = [
  "why leaves are green",
  "how a lithium-ion battery discharges",
  "what happens inside a volcano",
  "how a neuron fires",
  "why the sky is blue",
];

const state = {
  spec: null,
  selected: -1,
  explode: 0.35,
  total: 0,
  drawings: 0,
  prices: new Map(),
  model: localStorage.getItem("xray.model") || DEFAULT_MODEL,
  busy: false,
};

const el = (tag, attrs = {}) => {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

function say(text, bad = false) {
  const status = $("status");
  status.textContent = text;
  status.classList.toggle("bad", Boolean(bad));
}

function pollenLabel() {
  const button = $("pollen");
  const on = connected();
  button.textContent = on ? "Pollen connected" : "Connect Pollen";
  button.dataset.on = on ? "1" : "0";
}

function estimateCost(usage, pricing) {
  if (!usage || !pricing) return null;
  const prompt = (Number(usage.prompt_tokens) || 0) * Number(pricing.promptTextTokens || 0);
  const completion = (Number(usage.completion_tokens) || 0) * Number(pricing.completionTextTokens || 0);
  return prompt + completion;
}

function shine(color) {
  // A readable label colour on top of the layer fill.
  const hex = String(color).replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "dark" : "light";
}

function shapeNode(row, layer, selected) {
  const group = el("g", { class: `layer${selected ? " selected" : ""}`, tabindex: "0", role: "button" });
  group.dataset.index = String(row.index);

  let shape;
  if (layer.shape === "ring") {
    shape = el("rect", { x: row.x, y: row.y, width: row.w, height: row.h, rx: 14 });
    shape.setAttribute("fill", "none");
    shape.setAttribute("stroke", layer.color);
    shape.setAttribute("stroke-width", Math.min(16, Math.max(6, row.h * 0.3)));
  } else if (layer.shape === "core") {
    shape = el("ellipse", { cx: row.cx, cy: row.cy, rx: row.w / 2, ry: row.h / 2 });
    shape.setAttribute("fill", layer.color);
  } else if (layer.shape === "blob") {
    const rx = row.w / 2;
    const ry = row.h / 2;
    const d = [
      `M ${row.cx - rx} ${row.cy}`,
      `C ${row.cx - rx} ${row.cy - ry * 1.3}, ${row.cx - rx * 0.4} ${row.cy - ry * 1.1}, ${row.cx} ${row.cy - ry}`,
      `C ${row.cx + rx * 0.5} ${row.cy - ry * 0.95}, ${row.cx + rx} ${row.cy - ry * 1.25}, ${row.cx + rx} ${row.cy}`,
      `C ${row.cx + rx} ${row.cy + ry * 1.2}, ${row.cx + rx * 0.45} ${row.cy + ry * 1.05}, ${row.cx} ${row.cy + ry}`,
      `C ${row.cx - rx * 0.5} ${row.cy + ry * 0.95}, ${row.cx - rx} ${row.cy + ry * 1.2}, ${row.cx - rx} ${row.cy}`,
      "Z",
    ].join(" ");
    shape = el("path", { d });
    shape.setAttribute("fill", layer.color);
  } else if (layer.shape === "wave") {
    const amp = Math.max(4, row.h / 2.6);
    const steps = 40;
    const points = [];
    for (let i = 0; i <= steps; i += 1) {
      const x = row.x + (row.w * i) / steps;
      const y = row.cy + Math.sin((i / steps) * Math.PI * 3) * amp;
      points.push(`${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    shape = el("path", { d: points.join(" ") });
    shape.setAttribute("fill", "none");
    shape.setAttribute("stroke", layer.color);
    shape.setAttribute("stroke-width", Math.min(14, Math.max(5, row.h * 0.45)));
    shape.setAttribute("stroke-linecap", "round");
  } else {
    shape = el("rect", { x: row.x, y: row.y, width: row.w, height: row.h, rx: 12 });
    shape.setAttribute("fill", layer.color);
  }

  shape.setAttribute("class", "shape");
  group.appendChild(shape);

  const label = el("text", {
    x: row.cx,
    y: row.cy + 5,
    "text-anchor": "middle",
    class: `layer-label${shine(layer.color) === "light" ? " on-dark" : ""}`,
  });
  label.textContent = layer.label;
  group.appendChild(label);

  group.addEventListener("click", () => select(row.index));
  group.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select(row.index);
    }
  });
  return group;
}

function draw() {
  const group = $("layers");
  group.replaceChildren();
  const spec = state.spec;
  $("empty").hidden = Boolean(spec);
  if (!spec) return;

  const rows = layout(spec.layers, state.explode, { width: 720, height: 460 });
  for (const row of rows) {
    group.appendChild(shapeNode(row, row, row.index === state.selected));
  }
}

function renderLegend() {
  const list = $("legend");
  list.replaceChildren();
  if (!state.spec) return;
  state.spec.layers.forEach((layer, index) => {
    const item = document.createElement("li");
    item.className = index === state.selected ? "active" : "";
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = layer.color;
    const name = document.createElement("span");
    name.textContent = layer.label;
    const shape = document.createElement("span");
    shape.className = "shape-name";
    shape.textContent = SHAPES.includes(layer.shape) ? layer.shape : "slab";
    item.append(swatch, name, shape);
    item.addEventListener("click", () => select(index));
    list.appendChild(item);
  });
}

function select(index) {
  state.selected = index;
  const layer = state.spec?.layers?.[index];
  const detail = $("detail");
  if (!layer) {
    detail.hidden = true;
  } else {
    detail.hidden = false;
    $("detail-label").textContent = layer.label;
    $("detail-text").textContent = layer.detail || "No explanation came with this layer.";
  }
  draw();
  renderLegend();
}

function renderSpec(spec) {
  state.spec = spec;
  state.selected = 0;
  $("title").textContent = spec.title;
  $("summary").textContent = spec.summary || "";
  draw();
  renderLegend();
  select(0);
}

async function generate(topic) {
  if (state.busy) return;
  state.busy = true;
  $("go").disabled = true;
  say("Drawing…");

  const system = systemPrompt();
  const send = (content) =>
    ask({
      model: state.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content },
      ],
      maxTokens: 800,
    });

  try {
    const first = await send(userPrompt(topic));
    let spec = parseSpec(first.text);
    let usage = first.usage;
    let attempts = 1;
    let ms = first.ms;

    if (!spec) {
      const second = await send(`${userPrompt(topic)}\n\n${RETRY_INSTRUCTION}`);
      const retried = parseSpec(second.text);
      attempts = 2;
      ms += second.ms;
      usage = addUsage(usage, second.usage);
      if (retried) spec = retried;
    }

    if (!spec) throw new Error("the model did not return a usable diagram — try another topic or model");

    renderSpec(spec);
    state.drawings += 1;
    const cost = estimateCost(usage, state.prices.get(state.model));
    if (cost != null) state.total += cost;
    $("meter").innerHTML =
      `Diagram <b>${state.drawings}</b> · ${(ms / 1000).toFixed(1)}s · this one <b>${formatPollen(cost)}</b> · ` +
      `total <b>${formatPollen(state.total)}</b> Pollen${attempts > 1 ? " · one retry" : ""}`;
    say(
      attempts > 1
        ? "First reply was not the diagram object; the retry recovered it."
        : `${spec.layers.length} layers. Pull the slider apart, then click a layer.`,
    );
  } catch (error) {
    const message =
      error.code === "auth"
        ? "Connect your Pollen first: drawing is the only paid step."
        : error.code === "quota"
          ? "That key is out of Pollen."
          : error.message || "the request failed";
    say(message, true);
    if (error.code === "auth") openConnect();
  } finally {
    state.busy = false;
    $("go").disabled = false;
  }
}

function addUsage(a, b) {
  if (!a && !b) return null;
  return {
    prompt_tokens: (Number(a?.prompt_tokens) || 0) + (Number(b?.prompt_tokens) || 0),
    completion_tokens: (Number(a?.completion_tokens) || 0) + (Number(b?.completion_tokens) || 0),
  };
}

function formatPollen(value) {
  if (value == null) return "—";
  if (value === 0) return "0";
  if (value < 0.00001) return "<0,00001";
  return value.toFixed(value < 0.01 ? 5 : 4).replace(".", ",");
}

function modelNote() {
  const note = $("model-note");
  const id = $("model").value || state.model;
  if (isVerifiedModel(id)) {
    note.textContent = "✓ measured: returns the diagram object in the asked shape.";
    note.dataset.state = "ok";
  } else {
    note.textContent = `⚠ not measured on this prompt: may answer with prose. Verified: ${VERIFIED_MODELS.join(", ")}.`;
    note.dataset.state = "warn";
  }
}

async function loadModels() {
  const select = $("model");
  select.replaceChildren(new Option(`${isVerifiedModel(state.model) ? "✓" : "⚠"} ${state.model}`, state.model));
  try {
    const list = await models();
    const ids = list
      .filter((entry) => (entry.output_modalities || []).includes("text") && !entry.paid_only)
      .map((entry) => ({ id: entry.name || entry.id, price: entry.pricing || {} }))
      .filter((entry) => entry.id)
      .sort((a, b) => Number(a.price.completionTextTokens || 0) - Number(b.price.completionTextTokens || 0))
      .slice(0, 40);
    if (!ids.some((entry) => entry.id === state.model)) ids.unshift({ id: state.model, price: {} });
    ids.forEach((entry) => state.prices.set(entry.id, entry.price));
    const ranked = [...ids].sort((a, b) => Number(isVerifiedModel(b.id)) - Number(isVerifiedModel(a.id)));
    select.replaceChildren(
      ...ranked.map((entry) => new Option(`${isVerifiedModel(entry.id) ? "✓" : "⚠"} ${entry.id}`, entry.id)),
    );
    select.value = state.model;
  } catch {
    /* the default is enough */
  }
  modelNote();
}

function openConnect() {
  $("modal-body").innerHTML = "<p>Starting the device flow…</p>";
  $("modal").hidden = false;
  startDevice()
    .then((device) => {
      $("modal-body").innerHTML = `
        <p>Open this page and approve XRAY:</p>
        <p><a href="${device.verify}" target="_blank" rel="noopener">${device.verify}</a></p>
        <p>Or enter this code there:</p>
        <p><span class="code">${device.userCode}</span></p>
        <p id="device-state">Waiting for approval…</p>`;
      const timer = setInterval(async () => {
        if ($("modal").hidden) return clearInterval(timer);
        const result = await pollDevice().catch((error) => ({ state: "error", message: error.message }));
        if (result.state === "connected") {
          clearInterval(timer);
          $("modal").hidden = true;
          pollenLabel();
          say("Pollen connected. Type a topic and draw.");
        } else if (result.state === "error" || result.state === "expired") {
          clearInterval(timer);
          const note = $("device-state");
          if (note) note.textContent = `Stopped: ${result.message || result.state}`;
        }
      }, 2200);
    })
    .catch((error) => {
      $("modal-body").innerHTML = `
        <p>Could not start the device flow: ${String(error.message)}</p>
        <p>You can paste an <code>sk_</code> key from
          <a href="https://enter.pollinations.ai/keys" target="_blank" rel="noopener">enter.pollinations.ai/keys</a> instead.</p>
        <p><input id="manual-key" type="text" placeholder="sk_…" autocomplete="off" /></p>
        <p><button id="manual-save" class="pill" type="button">Use this key</button></p>`;
      $("manual-save")?.addEventListener("click", () => {
        try {
          useKey($("manual-key").value);
          $("modal").hidden = true;
          pollenLabel();
          say("Key accepted.");
        } catch (err) {
          alert(err.message);
        }
      });
    });
}

/* ---------- wiring ---------- */

$("examples").replaceChildren(
  ...EXAMPLES.map((topic) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = topic;
    chip.addEventListener("click", () => {
      $("topic").value = topic;
      generate(topic);
    });
    return chip;
  }),
);

$("form").addEventListener("submit", (event) => {
  event.preventDefault();
  const topic = $("topic").value.trim();
  if (!topic) {
    say("Type a topic first.", true);
    return;
  }
  generate(topic);
});

$("explode").addEventListener("input", (event) => {
  state.explode = Number(event.target.value) / 100;
  draw();
});

$("model").addEventListener("change", (event) => {
  state.model = event.target.value;
  localStorage.setItem("xray.model", state.model);
  modelNote();
});

$("pollen").addEventListener("click", () => {
  if (connected()) {
    signOut();
    pollenLabel();
    say("Pollen disconnected.");
    return;
  }
  openConnect();
});

$("modal-close").addEventListener("click", () => {
  $("modal").hidden = true;
});
$("modal").addEventListener("click", (event) => {
  if (event.target === $("modal")) $("modal").hidden = true;
});

pollenLabel();
loadModels();

if (new URLSearchParams(location.search).has("demo")) {
  renderSpec(DEMO_SPEC);
  say("This is a bundled demo diagram. Connect Pollen and type a topic to draw your own.");
}
