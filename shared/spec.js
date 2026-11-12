// The model turns a science topic into a diagram *spec* — titled layers with a colour,
// a shape and a share of the stack. Nothing the model writes is executed: colours are
// validated hex values, shapes come from a fixed list, and every number is clamped before
// it reaches the SVG. That keeps one bad reply from breaking the drawing.

export const VERIFIED_MODELS = ["openai/gpt-5.4-nano", "z-ai/glm-5.3-flash"];

export function isVerifiedModel(id) {
  return VERIFIED_MODELS.includes(String(id || ""));
}

export const SHAPES = ["slab", "ring", "core", "wave", "blob"];
export const PALETTE = ["#6f5dff", "#27d4cd", "#74ff7e", "#ffb45c", "#ff6f91", "#9ad0ff", "#d1a3ff"];

// A bundled spec so the page can be seen (and screenshotted) without spending Pollen.
export const DEMO_SPEC = {
  title: "Why leaves are green",
  summary: "White light in, red and blue absorbed, green sent back to your eye.",
  layers: [
    { label: "Incoming sunlight", detail: "White light reaches the leaf carrying every visible wavelength at once.", color: "#9ad0ff", shape: "wave", share: 0.2 },
    { label: "Chlorophyll", detail: "Pigments inside the chloroplasts absorb red and blue light strongly and green only weakly.", color: "#27d4cd", shape: "blob", share: 0.35 },
    { label: "Photosynthesis", detail: "The absorbed energy drives electron transfer, splitting water and building sugar from CO2.", color: "#74ff7e", shape: "core", share: 0.25 },
    { label: "Green reflected", detail: "Green wavelengths are not absorbed, so they leave the leaf and reach your eye — that is the colour you see.", color: "#ffb45c", shape: "ring", share: 0.2 },
  ],
  model: "demo",
};

export const MIN_LAYERS = 2;
export const MAX_LAYERS = 7;

export function systemPrompt() {
  return [
    "You turn a science topic into an exploded diagram that a reader can take apart.",
    "You are not chatting: you emit one JSON object that a renderer draws.",
    "",
    "Answer with ONE JSON object and nothing else — no prose, no code fence:",
    '{"title":"…","summary":"…","layers":[{"label":"…","detail":"…","color":"#rrggbb","shape":"slab","share":0.4}]}',
    "",
    "Rules:",
    "- 3 to 6 layers, ordered from the outside in (or top to bottom) as the thing is built.",
    "- label: 1 to 4 words, the name of that part or process.",
    "- detail: one or two sentences (max 220 characters) explaining what it does and why it matters.",
    "- color: a hex colour that suits the layer, from #6f5dff #27d4cd #74ff7e #ffb45c #ff6f91 #9ad0ff #d1a3ff.",
    "- shape: one of slab, ring, core, wave, blob — pick what the part looks like.",
    "- share: 0.15 to 1, how much room the layer takes in the stack (thick outer shells larger).",
    "- summary: one sentence (max 160 characters) naming the whole system.",
    "- Be concrete and correct. No metaphors about journeys, no “not just X but Y”.",
    "- Check directions before answering: which way ions, electrons, light or heat actually move, and in which order the steps happen. A diagram that runs backwards is worse than no diagram.",
  ].join("\n");
}

export function userPrompt(topic) {
  return [
    `Topic: ${String(topic || "").trim().slice(0, 200)}`,
    "",
    "Reply with the JSON object only.",
  ].join("\n");
}

export const RETRY_INSTRUCTION =
  "That was not the diagram object. Reply again with one JSON object only: title, summary, layers[{label, detail, color, shape, share}]. No prose, no fence.";

function firstObject(source) {
  const start = source.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

export function cleanColor(value, index = 0) {
  const raw = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(raw)) {
    const [, a, b, c] = raw;
    return `#${a}${a}${b}${b}${c}${c}`.toLowerCase();
  }
  return PALETTE[index % PALETTE.length];
}

function trim(value, limit) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, limit);
}

export function normalizeLayer(raw, index) {
  const layer = raw && typeof raw === "object" ? raw : {};
  const share = Number(layer.share);
  return {
    label: trim(layer.label, 42) || `Layer ${index + 1}`,
    detail: trim(layer.detail, 240),
    color: cleanColor(layer.color, index),
    shape: SHAPES.includes(layer.shape) ? layer.shape : SHAPES[index % SHAPES.length],
    share: Number.isFinite(share) ? Math.min(1, Math.max(0.15, share)) : 0.4,
  };
}

/** Parse a model reply into a drawable spec, or null when there is nothing usable. */
export function parseSpec(raw) {
  const source = String(raw == null ? "" : raw)
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const candidate = firstObject(source);
  if (!candidate) return null;
  let body;
  try {
    body = JSON.parse(candidate);
  } catch {
    return null;
  }
  const layers = Array.isArray(body.layers) ? body.layers.filter((l) => l && typeof l === "object") : [];
  if (layers.length < MIN_LAYERS) return null;
  return {
    title: trim(body.title, 80) || "Untitled system",
    summary: trim(body.summary, 200),
    layers: layers.slice(0, MAX_LAYERS).map(normalizeLayer),
    model: body.model ? trim(body.model, 40) : "",
  };
}

/** Vertical exploded stack: `explode` 0 packs the layers, 1 pulls them apart. */
export function layout(layers, explode = 0.4, options = {}) {
  const width = Number(options.width) || 720;
  const height = Number(options.height) || 460;
  const pad = 34;
  const list = Array.isArray(layers) ? layers : [];
  if (!list.length) return [];

  const gap = 6 + Math.min(1, Math.max(0, explode)) * 64;
  const shares = list.map((layer) => Math.max(0.15, Number(layer.share) || 0.4));
  const total = shares.reduce((sum, value) => sum + value, 0);
  const usable = height - pad * 2 - gap * (list.length - 1);
  const unit = Math.max(18, usable / total);

  let cursor = pad;
  return list.map((layer, index) => {
    const h = Math.max(18, unit * shares[index]);
    const w = Math.min(width - pad * 2, width * (0.34 + 0.46 * shares[index]));
    const row = {
      ...layer,
      index,
      x: (width - w) / 2,
      y: cursor,
      w,
      h,
      cx: width / 2,
      cy: cursor + h / 2,
    };
    cursor += h + gap;
    return row;
  });
}

/** Total height a layout needs, so the SVG viewBox can stay tight. */
export function layoutExtent(rows) {
  if (!rows.length) return { top: 0, bottom: 0 };
  const top = Math.min(...rows.map((row) => row.y));
  const bottom = Math.max(...rows.map((row) => row.y + row.h));
  return { top, bottom };
}
