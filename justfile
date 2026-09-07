default:
    @just --list

swarm count model budget prompt:
    bun run swarm {{quote(count)}} {{quote(model)}} {{quote(budget)}} {{quote(prompt)}}

web:
    bun run web

worker:
    bun run worker

doctor:
    bun run doctor

test:
    bun test

check:
    bun run typecheck
    bun run build

sandbox-build:
    podman --connection "${SWARM_PODMAN_CONNECTION:-podman-machine-default}" build --tag localhost/simpleswarm-sandbox:1 --file tooling/sandbox/Dockerfile .
