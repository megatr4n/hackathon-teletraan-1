FROM node:22-alpine AS build

WORKDIR /app/frontend
RUN npm install --global pnpm@11.25.0

COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY config/coefficients.json config/countries.json config/modis_viirs_coefficients.csv config/regions.yaml /app/config/
COPY frontend/index.html frontend/tsconfig.json frontend/vite.config.ts ./
COPY frontend/shims ./shims
COPY frontend/src ./src
COPY frontend/public ./public
RUN pnpm build

FROM nginx:alpine
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
