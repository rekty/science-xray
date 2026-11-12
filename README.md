[![Made with pollinations.ai](https://raw.githubusercontent.com/pollinations/pollinations/main/packages/ui/src/brand/badge-made-with.svg)](https://pollinations.ai/?ref=badge)

# XRAY

A science topic, drawn as layers you can pull apart. Type *why leaves are green* and a Pollinations
text model returns a diagram **spec** — a title, a summary and three to six layers with a colour, a
shape and a share of the stack. The page validates that spec and draws the SVG itself; nothing the
model writes is executed.

Live: <https://rekty.github.io/science-xray/>

Built for Pollinations quest **#19181 — an app that turns a science topic into something you can explore**.

## What you can do with it

- **Pull the layers apart.** One slider drives the gaps between layers, so a leaf, a battery or a
  volcano reads as a stack of parts instead of a paragraph.
- **Click a layer.** Each layer carries one or two sentences saying what it does and why it matters.
- **Draw another.** Regenerate with a different topic or a different model; every drawing is one chat
  completion on the reader's own Pollen.

## Why the model never draws

The reply is `{title, summary, layers:[{label, detail, color, shape, share}]}` and it is treated as
untrusted input:

- colours must be hex (`#rrggbb` or `#rgb`) or they fall back to the app's palette — no
  `javascript:` or arbitrary CSS reaches the DOM;
- shapes come from a fixed list (`slab`, `ring`, `core`, `wave`, `blob`);
- `share` is clamped to 0.15–1, labels to 42 characters, details to 240, at most 7 layers;
- if the reply is not the object, one strict retry runs before the app gives up with a message.

## Files

- `index.html`, `style.css` — page, SVG stage, legend, slider.
- `app.js` — request, retry, cost display, SVG rendering (one function per shape).
- `shared/spec.js` — prompt, tolerant parsing, clamping, layout maths, verified-model list.
- `shared/pollen.js` — Bring Your Own Pollen over the device flow; the `sk_` key stays in this tab's
  session storage and is only sent to `gen.pollinations.ai`.
- `test/spec.test.mjs` — `node --test`.

## Run and test

```bash
cd science-xray
python -m http.server 8080     # ES modules need http(s), not file://
node --test
```

## Cost

One drawing = one chat completion (plus one retry only if the first reply was not the diagram).
The footer shows the price of the last drawing and the running total, computed from the usage the API
returns and the per-token prices in `/models`. The default model is `openai/gpt-5.4-nano`; models
measured on this exact prompt are marked `✓` in the picker, everything else is marked `⚠`.

## License

MIT
