import test from "node:test";
import assert from "node:assert/strict";
import {
  parseSpec,
  normalizeLayer,
  cleanColor,
  layout,
  layoutExtent,
  systemPrompt,
  userPrompt,
  isVerifiedModel,
  VERIFIED_MODELS,
  PALETTE,
  SHAPES,
  MAX_LAYERS,
} from "../shared/spec.js";

const reply = (over = {}) =>
  JSON.stringify({
    title: "Green leaf",
    summary: "How a leaf turns light into sugar.",
    layers: [
      { label: "Cuticle", detail: "Waxy coat that limits water loss.", color: "#74ff7e", shape: "slab", share: 0.3 },
      { label: "Mesophyll", detail: "Cells packed with chloroplasts.", color: "#6f5dff", shape: "blob", share: 0.5 },
      { label: "Vein", detail: "Carries water in and sugar out.", color: "#9ad0ff", shape: "wave", share: 0.2 },
    ],
    ...over,
  });

test("a clean reply becomes a drawable spec", () => {
  const spec = parseSpec(reply());
  assert.equal(spec.title, "Green leaf");
  assert.equal(spec.layers.length, 3);
  assert.deepEqual(spec.layers[2], {
    label: "Vein",
    detail: "Carries water in and sugar out.",
    color: "#9ad0ff",
    shape: "wave",
    share: 0.2,
  });
});

test("fences and chatter around the object are tolerated", () => {
  const spec = parseSpec("Here:\n```json\n" + reply() + "\n```\nThat is all.");
  assert.equal(spec.title, "Green leaf");
  assert.equal(spec.layers.length, 3);
});

test("prose, broken JSON and too few layers are rejected", () => {
  assert.equal(parseSpec("Sure! A leaf has several layers."), null);
  assert.equal(parseSpec('{"title":"x","layers":['), null);
  assert.equal(parseSpec(JSON.stringify({ title: "x", layers: [{ label: "one" }] })), null);
  assert.equal(parseSpec(""), null);
});

test("hostile values are clamped instead of trusted", () => {
  const spec = parseSpec(
    JSON.stringify({
      title: "t".repeat(300),
      summary: "s".repeat(500),
      layers: Array.from({ length: 20 }, (_, i) => ({
        label: "L" + i,
        detail: "d".repeat(600),
        color: "javascript:alert(1)",
        shape: "triangle",
        share: 99,
      })),
    }),
  );
  assert.equal(spec.title.length, 80);
  assert.equal(spec.summary.length, 200);
  assert.equal(spec.layers.length, MAX_LAYERS);
  for (const layer of spec.layers) {
    assert.ok(PALETTE.includes(layer.color), `${layer.color} should fall back to the palette`);
    assert.ok(SHAPES.includes(layer.shape));
    assert.ok(layer.share >= 0.15 && layer.share <= 1);
    assert.ok(layer.detail.length <= 240);
  }
});

test("colours are validated, expanded and never passed through", () => {
  assert.equal(cleanColor("#ABCDEF"), "#abcdef");
  assert.equal(cleanColor("#abc"), "#aabbcc");
  assert.equal(cleanColor("red", 2), PALETTE[2]);
  assert.equal(cleanColor("rgb(1,2,3)", 0), PALETTE[0]);
  assert.equal(cleanColor(undefined, 1), PALETTE[1]);
});

test("a layer without a label or numbers still renders", () => {
  const layer = normalizeLayer({}, 0);
  assert.equal(layer.label, "Layer 1");
  assert.equal(layer.share, 0.4);
  assert.ok(SHAPES.includes(layer.shape));
});

test("layout stacks top to bottom inside the canvas", () => {
  const rows = layout(parseSpec(reply()).layers, 0);
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.ok(row.x >= 0 && row.x + row.w <= 720);
    assert.ok(row.y >= 0);
    assert.ok(row.h > 0);
  }
  assert.ok(rows[0].y < rows[1].y && rows[1].y < rows[2].y, "order is preserved");
});

test("exploding separates the layers and keeps the order", () => {
  const layers = parseSpec(reply()).layers;
  const packed = layout(layers, 0);
  const exploded = layout(layers, 1);
  const gap = (rows) => rows[1].y - (rows[0].y + rows[0].h);
  assert.ok(gap(exploded) > gap(packed), "the gaps grow with the slider");
  assert.deepEqual(exploded.map((r) => r.label), packed.map((r) => r.label));
  const extent = layoutExtent(exploded);
  assert.ok(extent.bottom <= 460, "the exploded stack still fits the canvas");
});

test("layout survives empty and single-layer input", () => {
  assert.deepEqual(layout([], 0.5), []);
  const one = layout([{ label: "only", share: 1 }], 0.5);
  assert.equal(one.length, 1);
  assert.ok(one[0].h > 0);
  assert.deepEqual(layoutExtent([]), { top: 0, bottom: 0 });
});

test("the prompts ask for the diagram object and nothing else", () => {
  const system = systemPrompt();
  assert.match(system, /ONE JSON object/);
  assert.match(system, /3 to 6 layers/);
  assert.match(system, /hex colour/);
  assert.match(userPrompt("photosynthesis"), /Topic: photosynthesis/);
  assert.ok(userPrompt("x".repeat(500)).length <= 260, "the topic is trimmed");
});

test("only the measured models are marked verified", () => {
  assert.deepEqual(VERIFIED_MODELS, ["openai/gpt-5.4-nano", "z-ai/glm-5.3-flash"]);
  assert.equal(isVerifiedModel("openai/gpt-5.4-nano"), true);
  assert.equal(isVerifiedModel("other/model"), false);
  assert.equal(isVerifiedModel(undefined), false);
});
