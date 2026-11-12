import test from "node:test";
import assert from "node:assert/strict";
import {
  parseSpec,
  drawSpec,
  addUsage,
  MAX_ATTEMPTS,
  RETRY_INSTRUCTION,
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
  DEMO_SPEC,
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

/* ---------- the retry path, driven by an injected sender ---------- */

const fakeSender = (replies) => {
  const prompts = [];
  const send = async (prompt) => {
    prompts.push(prompt);
    const next = replies[Math.min(prompts.length - 1, replies.length - 1)];
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next(prompt, prompts.length) : next;
  };
  return { send, prompts };
};

const prose = { text: "Sure! A leaf is mostly water and chlorophyll.", usage: { prompt_tokens: 40, completion_tokens: 12 }, ms: 900 };
const good = { text: reply(), usage: { prompt_tokens: 50, completion_tokens: 220 }, ms: 1200 };

test("a good first reply is drawn with a single call", async () => {
  const { send, prompts } = fakeSender([good]);
  const run = await drawSpec({ topic: "why leaves are green", send });
  assert.equal(prompts.length, 1);
  assert.equal(run.attempts, 1);
  assert.equal(run.retried, false);
  assert.equal(run.spec.layers.length, 3);
  assert.deepEqual(run.usage, { prompt_tokens: 50, completion_tokens: 220 });
  assert.equal(run.ms, 1200);
  assert.match(prompts[0], /^Topic: why leaves are green/);
  assert.ok(!prompts[0].includes(RETRY_INSTRUCTION), "no retry text on the ask itself");
});

test("prose triggers exactly one stricter retry that keeps the topic", async () => {
  const { send, prompts } = fakeSender([prose, good]);
  const run = await drawSpec({ topic: "why the sky is blue", send });
  assert.equal(prompts.length, 2);
  assert.equal(run.attempts, 2);
  assert.equal(run.retried, true);
  assert.equal(run.spec.layers.length, 3);
  assert.match(prompts[1], /^Topic: why the sky is blue/);
  assert.ok(prompts[1].includes(RETRY_INSTRUCTION), "the retry repeats the instruction");
  assert.ok(prompts[1].startsWith(prompts[0]), "the retry is the same ask plus the instruction");
  assert.deepEqual(run.usage, { prompt_tokens: 90, completion_tokens: 232 }, "both calls are billed");
  assert.equal(run.ms, 2100, "both latencies are reported");
});

test("two prose replies stop at the cap instead of looping", async () => {
  const { send, prompts } = fakeSender([prose]);
  const run = await drawSpec({ topic: "volcano", send });
  assert.equal(prompts.length, MAX_ATTEMPTS);
  assert.equal(run.spec, null);
  assert.equal(run.attempts, 2);
  assert.deepEqual(run.usage, { prompt_tokens: 80, completion_tokens: 24 });
  assert.equal(run.ms, 1800);
});

test("maxAttempts is honoured and never sends a third call", async () => {
  const { send, prompts } = fakeSender([prose]);
  const run = await drawSpec({ topic: "volcano", send, maxAttempts: 1 });
  assert.equal(prompts.length, 1);
  assert.equal(run.attempts, 1);
  assert.equal(run.retried, false);
  assert.equal(run.spec, null);
});

test("a broken first reply is retried, a recovered one is drawn", async () => {
  const { send, prompts } = fakeSender([{ text: '{"title":"x","layers":[' }, good]);
  const run = await drawSpec({ topic: "neuron", send });
  assert.equal(prompts.length, 2);
  assert.equal(run.spec.title, "Green leaf");
});

test("a reply without usage leaves nothing to bill, and no NaN", async () => {
  const broken = { text: reply().replace(/}$/, ",") };
  const { send } = fakeSender([broken, broken]);
  const run = await drawSpec({ topic: "leaf", send });
  assert.equal(run.spec, null);
  assert.equal(run.usage, null, "no usage reported means nothing to bill, not NaN");
  assert.equal(run.ms, 0);
  assert.equal(addUsage(undefined, undefined), null);
  assert.deepEqual(addUsage({ prompt_tokens: 1 }, { completion_tokens: 4 }), { prompt_tokens: 1, completion_tokens: 4 });
  assert.deepEqual(addUsage({ prompt_tokens: 1, completion_tokens: 2 }, { prompt_tokens: 3, completion_tokens: 4 }), {
    prompt_tokens: 4,
    completion_tokens: 6,
  });
});

test("a sender that throws surfaces the error and spends no retry", async () => {
  const boom = new Error("insufficient pollen");
  boom.code = "quota";
  const { send, prompts } = fakeSender([boom]);
  await assert.rejects(() => drawSpec({ topic: "leaf", send }), /insufficient pollen/);
  assert.equal(prompts.length, 1);
  await assert.rejects(() => drawSpec({ topic: "leaf" }), /send\(prompt\)/);
});

test("the bundled demo spec is valid by the app's own rules", () => {
  const spec = parseSpec(JSON.stringify(DEMO_SPEC));
  assert.ok(spec, "the demo must survive the same parser the model's reply goes through");
  assert.equal(spec.layers.length, DEMO_SPEC.layers.length);
  for (const layer of spec.layers) {
    assert.ok(SHAPES.includes(layer.shape));
    assert.ok(/^#[0-9a-f]{6}$/.test(layer.color));
    assert.ok(layer.detail.length > 20);
  }
  assert.ok(layout(spec.layers, 1).every((row) => row.y + row.h <= 460));
});
