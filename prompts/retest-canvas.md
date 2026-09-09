# Two-peer Canvas regression

Final output: shared/hero.html

Build a self-contained offline HTML canvas particle animation from the original reference images under reference/. The source scene has a dark background, dense fine light particles in organized fluid motion, and restrained red accents. Read the supplied reference notes; do not treat the demo's generated candidate as the original. This is a small two-peer regression, not proof of reproducing the entire original motion from two still images.

Use the general board for findings and handoffs. Skip greetings, role negotiations, and repeated environment discovery. Agent-1 briefly inspects the original references, claims shared/hero.html, and publishes a compact working draft before writing verification scripts or extended analysis. Agent-2 independently reads the references and owns one set of measured rendering evidence. Agent-1 fixes reported defects; transfer canonical ownership explicitly if agent-2 must edit it. Release claims after publication and renew evidence claims before long checks.

Every bash call starts a fresh sandbox. /workspace contains published files; /tmp and processes from earlier calls are gone. Create disposable scripts in /tmp within the same call that uses them. Claim every exact retained output path before writing under /workspace. Check the bash result's exitCode and versions: listing files or printing a success message does not prove rendering or publication.

Use installed Node Playwright (`const {chromium}=require('playwright')`) with Chromium launched using `args:['--no-sandbox']`. Open file:///workspace/shared/hero.html. Python Playwright is not installed; Python Pillow is available for image analysis, while CairoSVG cannot render this animated HTML. No installation or network access is needed. Keep the verification script, browser, and timed observations in one bash call with timeout_seconds:120. Allow enough time to close the browser and write results. Give claims a lifetime longer than the call.

Both peers call budget before choosing work, before expensive verification, and before concluding. Combine observationSeq and availableMicros citations with productive findings or handoffs. Read the runtime's current-request guidance: a funded request may continue useful tools while additional requests wait. Treat wrap_up as a direction to finish essential work. If hard-cap headroom is narrow, prioritize publication and review even when the working target remains. Do not poll the budget, treat reservations as confirmed spending, or spend merely to reach a target.

Agent-2 captures one shared sequence under verify/render_1fps/: one PNG each second from t=0 through t=22, inclusive. Use an 800×600 viewport for this sequence and record actual elapsed timestamps. Measure nonblank coverage, brightness, and frame changes throughout a continuous observation lasting at least 60 seconds; the 22-second sequence can be its first portion. Also check resizing and separate DPR1 and DPR2 browser contexts. Record errors, failed resources, canvas dimensions, and motion after each change. Save only useful retained images and measurements, not browser caches or temporary scripts.

Publish verify/report.md with the canonical revision, SHA256 of its bytes, capture paths, measured results, and unresolved findings. After publication, BOTH peers use read on the early, middle, and late PNGs, plus the original reference stills. Compare composition, particle density, brightness, and red accents. Measured changes establish that this output moves; still references cannot establish exact original speed, trajectories, or temporal fidelity. State that limitation explicitly.

After corrections, regenerate affected evidence for the new canonical hash. Each peer independently posts a review of the SAME current revision and SHA256, identifying images personally inspected, findings, and remaining limitations. Identify measurements supplied by the peer as shared evidence instead of claiming a second execution. Both review posts must exist before either peer calls done. If essential criteria remain unmet, preserve the artifact and evidence, post the blocker, and call done with bail:true.

## Definition of Done

- shared/hero.html opens offline with an actual nonblank animated canvas and no missing resources or browser errors.
- Visual composition, particle density, brightness and red accents are compared with the supplied original frames; source-motion limitations are stated.
- A published sequence spans at least 22 seconds at one frame per second, with brightness, nonblank, and frame-change metrics. Both peers inspect representative early, middle, and late captures.
- The canvas survives resizing and DPR1/DPR2 and shows sustained motion without errors for at least 60 seconds.
- verify/report.md and retained captures identify the final canonical revision and SHA256. Substantive defects are corrected or clearly reported unresolved.
- Two distinct peers independently review that same final SHA256 with actual image inspection and explicit source-motion limitations, then explicitly finish.
