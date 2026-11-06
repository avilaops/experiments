ARG NODE_IMAGE
FROM ${NODE_IMAGE}
WORKDIR /pilot
COPY --chown=node:node policy.mjs client.mjs mcp.mjs ./
USER node
ENTRYPOINT ["node", "/pilot/mcp.mjs"]
