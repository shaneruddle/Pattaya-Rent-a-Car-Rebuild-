FROM node:20-slim AS base
COPY . /app
WORKDIR /app

FROM base AS build
RUN npm install
RUN npm run build

FROM base
COPY --from=build /app/dist /app/dist
RUN npm install --omit=dev
EXPOSE 3000
CMD [ "node", "dist/server.js" ]
