# Two-peer Pelican regression

Final output: pelican.svg

Draw a recognizable pelican riding a bicycle in one self-contained SVG. This is a two-peer regression, not the original 30-agent experiment. Keep the design simple enough to publish within one model response. Include a long bill and throat pouch, spoked wheels, a coherent frame with chain and crank, feet contacting both pedals, a wing gripping the upper handlebar, and a visible seat supporting the body. Expose a saddle edge touching the body: a saddle hidden beneath an opaque body does not pass. Record contact coordinates in SVG comments or verification notes; keep measurement labels out of the finished illustration. Do not add raster images, scripts, foreign objects, or external resources.

Use the general board for findings and handoffs. Skip greetings, role negotiations, and repeated environment discovery. Agent-1 claims pelican.svg and immediately publishes a complete first draft, before verification scripts or discussion. Use compact paths and repeated groups to avoid a truncated write. Agent-2 reviews the published draft and owns the shared rendering evidence. Agent-1 fixes reported defects; transfer canonical ownership explicitly if agent-2 must edit it. Release claims after publication and renew evidence claims before long checks.

Every bash call starts a fresh sandbox. /workspace contains published files; /tmp and processes from earlier calls are gone. Create disposable scripts in /tmp within the same call that uses them. Claim every exact retained output path before writing under /workspace. Check the bash result's exitCode and versions: a successful command that publishes no evidence is not a completed verification step.

Agent-2 claims verify/pelican.png and verify/report.md. Render /workspace/pelican.svg to /workspace/verify/pelican.png with installed Python CairoSVG (`cairosvg.svg2png(url=..., write_to=...)`). Use Pillow (`from PIL import Image`) for image measurements. For the offline browser error check, use installed Node Playwright (`const {chromium}=require('playwright')`) and launch Chromium with `args:['--no-sandbox']`. Open the canonical file, collect page errors and failed resources, and close the browser. Python Playwright is not installed. Do not install tools or access the network.

After publication, BOTH peers use read on verify/pelican.png and inspect the actual image. Agent-2 records the canonical revision, SHA256 of its bytes, render path, nonblank measurements, browser results, and contact coordinates in verify/report.md. Measure visible wing/grip, both feet/pedals, and exposed saddle/body contacts; coordinate labels alone are not evidence. Share this render instead of duplicating it. If the SVG changes, replace the evidence with a render and report for the new hash before either final review.

Both peers call budget before choosing work, before expensive verification, and before concluding. Combine each short board citation of observationSeq and availableMicros with a useful finding or handoff, not a separate status conversation. Read the runtime's current-request guidance: a funded request can still perform useful tools while additional requests wait. Treat wrap_up as a direction to finish essential work. If hard-cap headroom is narrow, prioritize publication and review even when the working target remains. Do not poll the budget, treat reservations as confirmed spending, or spend merely to reach a target.

After corrections, each peer independently posts a concise review of the SAME current revision and SHA256. Identify the image personally inspected, measured contacts, resolved findings, and any remaining defect. A peer's report can supply shared measurements, but identify those as shared evidence rather than claiming to have rerun them. Both review posts must exist before either peer calls done. Do not claim checks you did not perform. If essential criteria remain unmet, preserve the artifact and evidence, post the blocker, and call done with bail:true.

## Definition of Done

- The canonical pelican.svg parses, renders nonblank offline, and has no raster images, scripts, foreign objects, external references or browser errors.
- A recognizable pelican and bicycle are visible, with a clear bill and pouch, spoked wheels, coherent frame, chain, and crank.
- The wing grips the upper handlebar, both feet touch their pedals, and an exposed saddle edge supports the body. Recorded coordinates agree with the actual render.
- verify/pelican.png and verify/report.md are published, bound to the final canonical revision and SHA256, and both peers inspect the PNG.
- Substantive reviewer defects are fixed in the canonical artifact, or reported as unresolved instead of claiming success.
- Two distinct peers review the same final SHA256 with actual evidence and explicitly finish.
