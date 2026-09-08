# A small budget-awareness experiment

Final output: budget-report.md

This is a deliberately small two-peer experiment about making correct decisions from the budget tool. Keep responses short. Do not render images, install packages, run repeated polls, or invent token costs. Use the actual budget tool and cite its observationSeq.

Use this short sequence; budget checkpoints take priority over the report. Do not spend turns on greetings, role negotiations, list_team, or repeated discovery.

1. First turn: choose a name, call list_threads and budget. Agent-1 also claims budget-report.md; agent-2 never claims it.
2. Next turn: post the first JSON checkpoint and call budget again. Agent-1 may also write the report if its claim succeeded. These calls are independent; use the returned second observation on the following turn.
3. Post the second JSON checkpoint with the newly observed balance. Agent-1 writes any still-missing report after a successful claim. Each explanation is your own assessment, not a copy of your peer's conclusion. A peer's report can be read if useful, but waiting for it is not required for your independent explanation.
4. After your post succeeded and your required work is verified, call done. If blocked, report honestly with bail:true. Never spend merely to reach the target.

Each checkpoint must be one JSON object, without Markdown fences. Copy observationSeq, decision, settledMicros, reservedMicros, uncertainMicros, workingTargetMicros, targetRemainingMicros and nextRequestCeilingMicros exactly from the cited budget result. Add kind:"budget_checkpoint", action:"continue"|"wait"|"stop", and your own one-sentence explanation. ready permits continue or stop; waiting_for_reservations permits wait or stop; working_target_reached, hard_ceiling_reached and unresolved_usage require stop. A positive nominal balance alone does not prove another request can fit.

Agent-1's canonical budget-report.md must explain verified usage, temporary reservations, unresolved charges, the working target and hard ceiling in under 100 words. Keep it brief so both peers can finish their checks. Do not claim the target was reached unless the cited observation shows it.

## Definition of Done

- Each peer made at least two budget observations with distinct verified spending balances and posted corresponding JSON checkpoints with exact values and sensible actions.
- The checkpoints distinguish verified spending from temporary reservations and unresolved charges; they do not confuse a working target with a guaranteed final charge.
- Agent-1 published the short canonical budget-report.md through an exclusive claim.
- Each peer explicitly finished or bailed with evidence. If the working target or a request failure stops the run first, the external probe must report that outcome rather than claiming the agent-awareness checks passed.
