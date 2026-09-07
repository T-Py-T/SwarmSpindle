# Command sandbox

Build from the repository root with a running rootless Podman machine:

```sh
podman build --tag localhost/simpleswarm-sandbox:1 --file tooling/sandbox/Dockerfile .
```

The Node Debian base supports Linux ARM64, including the local Apple Silicon VM. The image installs Node, Python, Pillow, CairoSVG, Playwright 1.58.2, and its Chromium browser at build time. The image build needs network access; commands run with `--network=none` and need none of these downloads. For browser validation, use `require('playwright').chromium.launch({headless:true,args:['--no-sandbox']})`; the browser is contained by the outer rootless Podman boundary. Modules are installed under `/opt/tooling/node_modules` and are discoverable by CommonJS `require` through `NODE_PATH`. ESM imports must use the absolute installed module path.

```sh
bun test tests/sandbox.test.ts
SIMPLESWARM_SANDBOX_INTEGRATION=1 bun test tests/sandbox.integration.test.ts
```

The optional integration suite executes real Podman containers. Without its environment flag it explicitly skips; skipped tests are never evidence of containment. It checks output changes, binary data, timeout, cancellation, FIFO/symlink/hardlink rejection, host path protection, absent provider secrets, offline Python/browser tools, and queue pressure. The normal tests validate the public snapshot/diff boundary and invalid execution requests without replacing Podman.

Commands receive a fresh read-only snapshot at `/snapshot` and a 64 MiB writable tmpfs at `/workspace`. The immutable image runner copies the snapshot, captures bounded output, stops all command processes in the private PID namespace, and exports only validated ordinary files through JSON. The host independently validates the returned paths/base64 and computes revision-preserving changes. Nothing writes canonical state. `/tmp` and shared memory are separately bounded tmpfs mounts; there are no host home, socket, credential, or canonical workspace mounts. Four commands at most run per adapter instance.

Fresh host snapshots live under `~/.cache/simpleswarmsystem/sandbox` by default because macOS Podman machines generally share the home directory with the VM. Only the fresh snapshot subdirectory is mounted. A custom `runtimeDirectory` must already exist, be absolute, contain no symlink components or commas, and be shared into the Podman machine.

The private host snapshot directory remains if engine failure prevents verified container removal; that preserves its read-only source until cleanup can be retried. `stop(swarmId)` cancels only execution records from this instance, and removal verifies its unpredictable instance label. The machine/engine remains trusted infrastructure: failure to connect, a non-rootless engine, or an absent/unrecognized image fails closed. No host shell fallback exists.

Release verification must record the built image ID and real integration results on the target Mac. The base is version-pinned but not digest-pinned; build-time Debian packages are not locked, so the image is not bit-for-bit reproducible. OS hardening relies on Podman's default seccomp profile in addition to dropped capabilities, no-new-privileges, read-only root, CPU/memory/process/file limits, and the private network/PID/IPC namespaces.
