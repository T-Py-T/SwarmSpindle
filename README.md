# Simple Swarm System

An independent, open-source reconstruction of the observable peer-swarm behavior in [IndyDevDan’s demo](https://www.youtube.com/watch?v=S2sjyokoxeE), built on Pi.

Status: implementation in progress. This is not the original unpublished repository. It is not ready to run yet.

## Intended deployment

The web service and Pi worker run on the same M4 Max MacBook. Agent shell commands execute in isolated containers in a local Podman VM. A separate Mac Mini is not required.

## Required behavior

Peer agents collaborate through threads and mailboxes, name themselves, claim shared files, inspect and restore file versions, view collective budget, and explicitly finish or bail out. The browser exposes swarms, threads, agents, complete traces, timelines, usage, status, and final artifacts.

A definition of done is required before launch. Hard aggregate dollar caps must account for concurrent in-flight requests and fail closed when costs cannot be established.

## Acceptance work

- [Goal and delivery ledger](docs/GOAL.md)
- [Video-derived requirements](docs/research/video-requirements.md)
- [Public-source evidence](docs/research/public-sources.md)

The requested live acceptance runs are 30 Opus 4.8 High agents for the pelican challenge with a $50 aggregate cap, followed by 30 GPT-5.5 High agents for the canvas-from-video challenge with its own $50 aggregate cap. No substitute models, reduced swarms, or simulated runs count toward completion.
