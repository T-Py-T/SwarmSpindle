# Canvas challenge: targeted recovery evidence

Research date: 2026-09-07. Source: [IndyDevDan Simple Swarm System demo](https://www.youtube.com/watch?v=S2sjyokoxeE). Frame evidence is preserved privately at `.research-staging/simple-swarm-video/frames/` within HomeLife. This note supplements the full demo requirements; it does not claim recovery of unpublished source.

## Question and current answer

Can we recover the canvas challenge's exact starting goal, definition of done, and source clip URL from the video?

**Exact source page now recovered; original prompt and media URL remain unresolved.** Frame1676 identifies [The Hugging Face incident and the road ahead](https://openai.com/index/hugging-face-incident-and-the-road-ahead/) as the actual original animation page. This is an article hero, not the OpenAI homepage. The launch command, local reference filename, canonical deliverable, verification directories, selected peer reports, rendered result, and final run metrics are visible. Do not label a newly written canvas prompt as an exact recovered prompt.

## Directly observed evidence

| Frame | Observation |
|---|---|
| `0260.png` (4:20) | Launch command uses `just swarm 30 gemini37-flash 30 prompts/demo/USER_PROMPT_CANVAS_FROM_VIDEO.md`. Positional arguments are count, model alias, dollar cap, and prompt file. |
| `0620.png` (10:20) | Swarm list identifies CANVAS FROM VIDEO, 30 agents, one thread, live execution. |
| `0630.png` (10:30) | Main thread modal shows public thread, created by system, per-thread budget strip, member roster, SHOW ALL and PREVIEW/RAW buttons. Initial messages are collapsed. |
| `0640.png` (10:40) | Agent `critic` says its verification pipeline extracts reference frames from **`reference/hero-video.webm`** into **`verify/ref_1fps/`**, and captures rendered frames into **`verify/render_1fps/`**. Multiple peers refer to canonical **`shared/hero.html`**. |
| `0650.png` (10:50) | Expanded `critic` report says an initial canonical `hero.html` is running: vanilla JavaScript, a single canvas, 3D curl-noise murmuration, viewport resize/DPR handling, black background, monochrome white/alpha particles. This is observed agent testimony about its created result, not the original prompt or an independent code inspection. |
| `0660.png` (11:00) | Expanded agent reference-measurement report and verification plans; details below. |
| `1650.png`, `1660.png` (27:30, 27:40) | Completed canvas swarm displays 30 agents, one thread, **45 messages**, **1,895 calls**, **61,270,296 tokens**, **$16.4139 of $30**, **50m23s**, and DONE. The screenshot does not prove that all 30 agents individually finished successfully. |
| `1670.png` (27:50) | Presenter opens exported result from local path ending `tmp/demo/hero-gemini37flash.html`. Chrome shows dense white particle ribbons/clouds on black. This is the generated result, not the original reference. |
| `1680.png` (28:00) | Same local result with developer tools open. Inspector content is not yet readable in this frame. Transcript at 27:58–28:11 explicitly states actual HTML5 canvas and contrasts it with SVG. |

In the transcript at 4:07–4:31 the target is the OpenAI landing-page animation. The presenter anticipates site-access guards. At 27:42–27:58 he compares the generated result with the original and says the original moves more slowly and fluidly. These statements establish motion fidelity as relevant even though exact acceptance thresholds remain unknown.

## Reference measurements: agent-reported, not independently verified

Frame0660 contains `drift`'s report. These values are useful hypotheses for a benchmark fixture, but **are not verified source metadata or mandatory original prompt criteria**:

- 1600×892 pixels, 25 fps, 20 seconds / 500 frames.
- Black background and grayscale particle drawing.
- Approximately 8,000–12,000 particles, median area around 7 pixels, approximate radius 0.8–1.8 pixels.
- Approximate mass center `(0.488 W, 0.473 H)` and spreads `(0.178 W, 0.157 H)`.
- Approximate average speed 45–50 px/s; median around 30 px/s; 90th percentile around 125 px/s at the reported reference resolution.
- Agent proposes toroidal/elliptical 3D circulation with multiscale curl/simplex noise as a model of the visual behavior. That is **an algorithmic inference**, not recovered implementation.
- Agent says surrounding site text/buttons are static UI and that the deliverable should contain only the full-screen particle murmuration against black.

The same frame shows planned adversarial verification of resize/DPR handling, frame-rate/delta-time consistency across 30/60/120 Hz, prolonged memory/particle stability, and absence of external dependencies, plus perceptual/MSE/SSIM frame comparisons. These are observed peer plans. No passing artifacts or thresholds are visible here.

## Criteria safe to use and their provenance

**Confirmed task intent:** recreate the observed OpenAI hero animation as an actual working HTML5-canvas animation, with peer collaboration and verification. Preserve an inspectable canonical HTML result and compare motion as well as still appearance.

**Supported reconstruction choices:** one self-contained `hero.html`, monochrome particle murmuration on black, responsive viewport handling, offline runtime, one-fps reference/render sequences, independent and adversarial review, multiple time/viewport checks. These follow the visible implementation/workflow and can be written as explicit new acceptance criteria, while acknowledging the exact original prompt is missing.

**Do not assert without more evidence:** the reference's exact URL/asset identity; exact particle population and mathematical field; hard numeric similarity thresholds; a mandatory 1600×892 runtime size; precise original frame count; whether an underlying original hero is itself canvas, WebGL, or a video; proof that all30 original agents completed successfully.

**User settings supersede the original run:** 30 GPT-5.5 High agents, a shared $50 maximum, after the pelican challenge. Never substitute Gemini because the demo used it.

## Official-source check

The [current OpenAI homepage](https://openai.com/) was read through the web tool. Its text representation does not expose the source hero clip URL. A read-only direct HTML request returned HTTP403; no access-control bypass was attempted. Search for an official `hero-video.webm` reference produced no result. This is a retrieval limitation, not proof that the clip is unavailable.

## Pros and cons of reference options

| Option | Pros | Cons / limitations |
|---|---|---|
| Recover the exact public clip URL from an original-site frame or public page markup | Strongest fidelity and reproducible asset identity | URL not recovered yet; current site content may differ from the recording |
| Use clean footage of the original animation visible within the user-provided demo | Can preserve historical visual reference even if site changed | Camera/UI overlays, scaling and compression can contaminate comparisons; must distinguish original from generated result |
| Use the screenshot-visible agent measurements | Useful for hypotheses and initial validation planning | Not independently verified; insufficient for exact visual fidelity claims |
| Invent an attractive particle animation | Easy to deliver a working canvas | Does not fulfill close recreation without evidence of comparison to original |

## Next targeted frame requests

Requested from parent (do not run ffmpeg from this task): **0642, 0644, 0646, 0648**, when the canvas conversation may reach its starting goal before returning to top; **0254, 0256, 0258** for the original site during launch; **1674, 1676** for the original during the final comparison.

No public repository files, runtime configuration, model credentials, or research vault notes were modified by this bounded task.

## Additional frame inspection — source page resolved

Inspected all requested additional frames:0642/0644/0646/0648/0254/0256/0258/1674/1676.

- **0642** shows peer announcements partway through the thread. **0644–0648** show the presenter returning to the thread's top and selecting SHOW ALL. None shows the goal or DoD; the earlier suspected opportunity did not expose the starting prompt.
- **0254–0258** repeat the canvas launch command. They do not show the external reference site.
- **1674** still shows the generated local `hero-gemini37flash.html` result. The presenter hovers over the OpenAI article tab, revealing its title.
- **1676** switches to the **original**. The address bar clearly reads `openai.com/index/hugging-face-incident-and-the-road-ahead/`; the article title, August26,2026 date, and hero animation are visible. This is direct visual evidence of source identity and corrects all earlier uses of “homepage.”

The original hero shown in1676 is a broad, dense cloud/sheet of very fine white particles on black, under a large centered article headline and three buttons. There are sparse red marks/rings visible, but this screenshot alone does not establish whether they are intrinsic animation features, pointer effects, or another overlay; do not impose them as task criteria yet. Compared with the generated result in1674, the original has visibly finer points and a less ribbon-like, less streaked appearance. Temporal speed cannot be measured from this one frame, so retain the presenter's spoken slower/flowier comparison as qualitative evidence.

### Primary-source follow-up

Opened the [exact official article](https://openai.com/index/hugging-face-incident-and-the-road-ahead/) using the web tool. Its current title/date match the observed page. The tool's text extraction displays a loading placeholder after the article header and **does not expose a hero media URL**. Searches within that extracted page for `.webm`, `.mp4`, and `video` return no matches. This does not prove the absence of a clip: it means the web tool's text representation omits it. Parent can inspect the article's normal browser DOM/network for the media resource or runtime canvas; no downloads or processing were attempted by this task.

**Current authoritative reference:** the exact official article URL, with original hero appearance verified in frame1676. **Still missing:** exact clip/resource URL, whether the original is video or runtime graphics, literal canvas goal/DoD, and independently measured reference metadata. The local `reference/hero-video.webm` filename remains evidence that the demo agents had a video reference, but not evidence of its remote origin.
