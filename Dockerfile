FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node package.json server.mjs gemini-live.mjs ./
COPY --chown=node:node public ./public
USER node
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
CMD ["node", "server.mjs"]
