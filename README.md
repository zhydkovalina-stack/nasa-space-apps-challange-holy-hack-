# Through NISAR’s Lens

NASA Space Apps Challenge 2026, Poznań. Team holy@hack:~$

Alina Zhydkova, Obada Alabbadi, Omar Hemid, Shady Hemid, Zeyad Al-Najjar

A website that makes NISAR's radar readable: what the satellite is, how radar sees, and what it shows about the ground we live on.

**Open the site:** https://zhydkovalina-stack.github.io/nasa-space-apps-challange-holy-hack-/

**Open the presentation:** https://zhydkovalina-stack.github.io/nasa-space-apps-challange-holy-hack-/presentation/

Pages:
- `v2/index.html`: main story (take NISAR apart, how radar sees, radar colours translated, stories from Poland and the Amazon)
- `v2/orbit.html`: NISAR's orbit, live in 3D
- `v2/explorer.html`: search NASA's real NISAR archive on a map
- `v2/konin.html`: Konin lakes case study

## Presentation

`presentation/index.html` is our 7-slide pitch, each slide with a short screen recording of the site:

1. Through NISAR’s Lens
2. Take NISAR apart
3. How radar sees
4. Radar colours, translated
5. Under our feet: Knurów
6. NISAR’s orbit, live
7. The Explorer

Controls: ← / → (or Space, Page Up / Page Down) to move between slides, Home / End to jump to the first or last slide, or use the buttons in the bottom-right corner, which include fullscreen. Each slide has its own link (`#1` to `#7`).

## Running locally

It is a static site: no build step. To run it locally, serve this folder with any static server and open `v2/index.html`.

## Use of AI tools

Our team designed, researched and built *Through NISAR's Lens*. We chose the story, gathered and processed the NISAR and Sentinel data, created the visuals and wrote the content. We used Claude (Anthropic) as a coding assistant for a few specific tasks:

- **Code support:** help writing and tidying parts of the front-end JavaScript and CSS for the interactive pages.
- **Debugging:** tracking down broken image and data paths and rendering issues, and checking that every link on the site resolves correctly.
- **Deployment:** setting up GitHub Pages hosting and publishing the website and the pitch presentation.

The team reviewed and tested all AI-assisted changes before including them.

```yaml
project: Through NISAR's Lens
event: NASA Space Apps Challenge 2026, Poznań
challenge: Dancing with the SARs
team: holy@hack
authors: [Alina Zhydkova, Obada Alabbadi, Omar Hemid, Shady Hemid, Zeyad Al-Najjar]
ai_assistance:
  tool: Claude (Anthropic), via Claude Code
  role: coding assistant
  used_for: [front-end code support, debugging, GitHub Pages deployment]
  not_used_for: [concept, research, data processing, visual design, written content]
  human_review: all AI-assisted changes reviewed and tested by the team
```
