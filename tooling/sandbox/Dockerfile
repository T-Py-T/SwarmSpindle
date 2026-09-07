FROM node:22.14.0-bookworm-slim

LABEL io.simpleswarm.sandbox-protocol="1"

ENV PLAYWRIGHT_BROWSERS_PATH=/opt/browsers \
    NODE_PATH=/opt/tooling/node_modules \
    PYTHONDONTWRITEBYTECODE=1

RUN apt-get update \
    && apt-get install --yes --no-install-recommends bash python3 python3-pil python3-cairosvg ca-certificates \
    && npm install --prefix /opt/tooling --no-audit --no-fund playwright@1.58.2 \
    && /opt/tooling/node_modules/.bin/playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/* /root/.npm \
    && chmod -R a+rX /opt/browsers /opt/tooling

COPY tooling/sandbox/runner.mjs /opt/simpleswarm/runner.mjs
RUN chmod 0555 /opt/simpleswarm/runner.mjs

USER 1000:1000
WORKDIR /workspace
ENTRYPOINT ["node", "/opt/simpleswarm/runner.mjs"]
