FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node server ./server
COPY --chown=node:node shared ./shared
COPY --chown=node:node owner ./owner
COPY --chown=node:node rider ./rider
COPY --chown=node:node book ./book
COPY --chown=node:node setup ./setup
COPY --chown=node:node icons ./icons
COPY --chown=node:node docs ./docs
COPY --chown=node:node index.html sw.js ./
RUN mkdir /app/data && chown node:node /app/data
USER node
ENV HOST=0.0.0.0 PORT=3000 DATA_DIR=/app/data
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["node", "server/app.js"]
