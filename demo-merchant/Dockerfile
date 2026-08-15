FROM node:22-bookworm-slim
RUN groupadd --gid 10001 merchant \
 && useradd --uid 10001 --gid merchant --home /app --shell /usr/sbin/nologin merchant
WORKDIR /app
COPY package.json server.mjs ./
COPY lib ./lib
RUN mkdir -p /app/data && chown -R merchant:merchant /app
USER merchant
ENV PORT=3000 DATA_DIR=/app/data
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "server.mjs"]
