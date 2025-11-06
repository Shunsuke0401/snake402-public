# Snake402

A classic Snake game with x402 integration for pay-to-play and leaderboard rewards.

## Project Structure

```
snake402/
├── client/          # Phaser 3 + Vite + TypeScript frontend
├── server/          # Express + TypeScript backend
├── shared/          # Shared type definitions
└── package.json     # Monorepo configuration
```

## Getting Started

### Prerequisites
- Node.js 20+
- pnpm

### Installation

```bash
# Install dependencies for all workspaces
pnpm install
```

### Development

```bash
# Run both client and server concurrently
pnpm dev

# Run client only (http://localhost:3000)
pnpm dev:client

# Run server only (http://localhost:3001)
pnpm dev:server
```

### Building

```bash
# Build all packages
pnpm build

# Build individual packages
pnpm build:client
pnpm build:server
pnpm build:shared
```

## API Endpoints

### Server (http://localhost:3001)

- `GET /health` - Health check endpoint
- `GET /api` - API information

### Planned Endpoints
- `POST /api/join` - Join game session
- `POST /api/verify-payment` - Verify x402 payment
- `POST /api/submit-score` - Submit game score

## Features

### Phase 0 (Current)
- ✅ Monorepo setup with pnpm workspaces
- ✅ Client: Phaser 3 canvas with Play button
- ✅ Server: Express with /health endpoint
- ✅ Shared: Type definitions for future features

### Planned Features
- x402 payment integration
- Snake game mechanics
- Leaderboard system
- Score submission and verification# S402
