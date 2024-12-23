FROM node:20.11.1-alpine AS base

# ---------------
# Setup for deps and build
# ---------------
FROM base AS setup

RUN corepack enable && corepack prepare pnpm@latest --activate

ENV PNPM_HOME=/usr/local/bin
ENV DISABLE_OPENCOLLECTIVE=true

RUN apk add --no-cache python3 make g++

WORKDIR /app
COPY . /app

# ---------------
# Install dependencies
# ---------------
FROM setup AS deps

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm i -g prisma
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --ignore-scripts
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm run prisma:generate

# ---------------
# Build app
# ---------------
FROM deps AS build

RUN pnpm run build

# ---------------
# Remove dev deps
# ---------------
FROM deps AS prod-deps

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm prune --prod --ignore-scripts
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm run prisma:generate

# ---------------
# Final App
# ---------------
FROM base

RUN npm i -g pnpm

ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist/ ./dist/
COPY package.json ./

EXPOSE 3000

# Install AWSCLI
RUN apk add --no-cache python3 py3-pip
RUN pip3 install --upgrade pip --break-system-packages
RUN pip3 install --no-cache-dir awscli --break-system-packages
RUN rm -rf /var/cache/apk/*

COPY ./scripts/startup.sh /startup.sh
ENTRYPOINT ["sh", "/startup.sh" ]