---
title: Installation
description: Get GarzaHive running in under a minute.
---

GarzaHive runs as a single process with an embedded SQLite database. No Postgres, no Redis, no external dependencies.

## Docker (recommended)

```bash
docker run -d --name garzahive \
  -p 3000:3000 \
  -v garzahive-data:/app/data \
  ghcr.io/itsablabla/garza-hive:latest
```

Open `http://localhost:3000` and Queenie, your setup guide, handles the rest.

## One-liner script (Linux / macOS)

```bash
curl -fsSL https://raw.githubusercontent.com/itsablabla/garza-hive/main/install.sh | bash
```

This will:
1. Install [Bun](https://bun.sh) if not present
2. Clone the repository to `/opt/garzahive`
3. Install dependencies and build the frontend
4. Run database migrations
5. Create a system service (systemd on Linux, launchd on macOS)
6. Start GarzaHive on port **3000**

### Customizing the install

```bash
GARZAHIVE_DIR=/home/me/garzahive \
GARZAHIVE_DATA_DIR=/home/me/garzahive-data \
GARZAHIVE_PORT=8080 \
  bash <(curl -fsSL https://raw.githubusercontent.com/itsablabla/garza-hive/main/install.sh)
```

## Docker Compose

```bash
git clone https://github.com/itsablabla/garza-hive.git
cd garzahive/docker
ENCRYPTION_KEY=$(openssl rand -hex 32) docker compose up -d
```

See [`docker/docker-compose.yml`](https://github.com/itsablabla/garza-hive/blob/main/docker/docker-compose.yml) for all options.

## Manual install

```bash
git clone https://github.com/itsablabla/garza-hive.git
cd garzahive
bun install
bun run build
bun run db:migrate
NODE_ENV=production bun run start
```

### Prerequisites

- [Bun](https://bun.sh) >= 1.0
- Git

## What's next?

Head to [First Agent](/docs/getting-started/first-agent/) to create your first AI agent.

Already installed? See [Updating GarzaHive](/docs/getting-started/updating/) for the in-app updater, update channels, and automatic rollback.
