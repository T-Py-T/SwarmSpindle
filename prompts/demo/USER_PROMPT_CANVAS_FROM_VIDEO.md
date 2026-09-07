# Recreate the observed particle canvas

Final output: shared/hero.html

Recreate the animated particle artwork in the hero of https://openai.com/index/hugging-face-incident-and-the-road-ahead/ as a self-contained HTML canvas experience. Reference material, when supplied, lives under reference/. Inspect those files and shared reference notes before designing the animation. The worker has no network access, so do not rely on fetching the website or third-party scripts.

The target is the original article's animation: a very dark background with a dense cloud of fine light particles moving in fluid, organized flow, with restrained red tracking/curve accents. Match its density, scale, spatial distribution, contrast, motion character, and composition. Recreate the artwork rather than the article text, navigation, cursor highlight, recording overlays, or the larger streaks in the demo's later generated candidate. The original reference appears near 27:56–27:57 in the supplied demo; the local generated output shown from 27:58 onward is a comparison candidate, not the source of truth.

Use actual HTML canvas rendering, without substituting a static image, prerecorded video, or an SVG animation. Keep all code and assets local. Coordinate parallel analysis, animation engineering, performance work, reference measurement, and adversarial review through the shared tools. Publish an early complete canonical shared/hero.html, then improve it with exclusive file claims. Keep supporting material in verify/ and compare the canonical version rather than maintaining competing finals. Assign one peer to capture the shared timed frame sequence; other reviewers should inspect that evidence instead of duplicating large raster dumps. Use /tmp for disposable intermediate renders, and retain only deliberate verification files in the canonical workspace.

## Definition of Done

- shared/hero.html opens offline, contains an actual canvas, produces a nonblank animated particle scene, and reports no browser errors or missing resources.
- Compare the result against the available original reference evidence for particle density, brightness, composition, color accents, and apparent flow. Record limitations where the source evidence does not establish an exact parameter.
- Capture at least 22 seconds at one frame per second under verify/render_1fps/. Use available original frames under reference/ for honest side-by-side comparison; never present generated frames as original reference evidence.
- Measure nonblank coverage, brightness distribution, and frame-to-frame change. Inspect representative early, middle, and late frames for unwanted jumps, disappearance, clipping, drift, and flicker.
- Verify resizing and device pixel ratios of 1 and 2, and run a longer stability check of at least 60 seconds. Record observed errors and frame behavior rather than assuming success from source code.
- An independent peer should challenge visual fidelity and another should review performance and stability. Resolve substantive findings and have two peers sign off on the same final file hash with evidence.
- Keep one canonical final HTML artifact. Call done only with a concrete completion explanation tied to the produced artifact and the checks above.

Provenance: this is an independent reconstruction from the visible demo and original article. The complete original canvas prompt was not visible. The 22-frame comparison, resize/DPR checks, and 60-second stability check make the reconstructed acceptance measurable; they are not claimed as verbatim original requirements. Taylor's execution settings are 30 GPT-5.5 High Pi peers and a separate $50 aggregate cap.
