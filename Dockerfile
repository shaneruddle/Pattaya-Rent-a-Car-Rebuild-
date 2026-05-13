FROM node:20-slim AS base
WORKDIR /app
COPY . .

FROM base AS build
RUN npm install --legacy-peer-deps
RUN npm run build

FROM node:20-slim
WORKDIR /app
COPY --from=build /app/dist /app/dist
COPY --from=build /app/package.json /app/package.json
RUN npm install --omit=dev --legacy-peer-deps
EXPOSE 3000
CMD [ "node", "dist/server.js" ]
