# Deploying Slophoot on Coolify

This guide walks you through deploying **Slophoot** ([vibehoot](https://github.com/Olinkkt/vibehoot)) on [Coolify](https://coolify.io).

---

## Architecture Overview

Before deploying, keep in mind:
- **Unified Server**: Slophoot runs Next.js and Socket.io together on a single Node HTTP server (`server.ts`). Both web pages and WebSocket traffic run on the same port (`3000`).
- **In-Memory State**: Active rooms and player lobbies live in memory. No database (PostgreSQL, MongoDB, Redis) is required.
- **Single Instance**: Because state is in-memory, run **1 container replica**. Multiple replicas without sticky sessions or a shared pub/sub adapter would partition players across separate instances.

---

## Quick Start (Recommended: Dockerfile)

A production-ready multi-stage `Dockerfile` is provided in the repository. Coolify will automatically detect it.

### Step 1: Add Application in Coolify

1. Open your Coolify dashboard and select your **Project** and **Environment**.
2. Click **+ New** > **Application**.
3. Choose **Public Repository** (or **GitHub App** / **Private Repository** if using a private fork).
4. Enter the repository URL:
   ```text
   https://github.com/Olinkkt/vibehoot
   ```
   *(or your personal fork URL)*
5. Set the Branch to `main` (or your preferred branch).
6. Click **Save**.

### Step 2: Configure Application Settings

1. **Build Pack**: Coolify will automatically select **Dockerfile**.
2. **Ports**:
   - **Port Exposes**: `3000`
3. **Domains**:
   - Set your custom domain with `https://` (e.g. `https://quiz.example.com` or `https://quiz.your-server-ip.sslip.io`).
   - Coolify will automatically generate Let's Encrypt SSL certificates and route traffic via Traefik.

### Step 3: Configure Environment Variables

Navigate to the **Environment Variables** tab in your application and set the following:

| Variable | Recommended Value | Description |
|---|---|---|
| `NODE_ENV` | `production` | Enables production optimizations for Next.js. |
| `PORT` | `3000` | Port the internal server listens on. |
| `HOST` | `0.0.0.0` | Binds server to all interfaces inside the Docker container. |
| `ALLOWED_HOSTS` | `quiz.example.com` *(optional)* | Comma-separated list of allowed hostnames (without `https://`). Protects against DNS rebinding. If unset, all incoming hosts are allowed. |
| `ALLOWED_ORIGINS` | `https://quiz.example.com` *(optional)* | Comma-separated list of allowed WebSocket browser origins. If unset, origins matching the request `Host` header are allowed automatically. |
| `HOST_CREATE_COOLDOWN_MS` | `1000` *(optional)* | Cooldown in milliseconds between room creation attempts per connection (default: `1000`). |
| `HOST_CREATE_MAX_PER_IP` | `20` *(optional)* | Maximum active rooms allowed per client IP (default: `20`). |

> [!TIP]
> If you are testing with dynamic hostnames or unsure of your final domain yet, leave `ALLOWED_HOSTS` and `ALLOWED_ORIGINS` empty. The server defaults to accepting any valid host and matching origin.

### Step 4: Health Check (Optional)

In Coolify's **Health Check** section:
- **Path**: `/`
- **Port**: `3000`
- **Expected Status**: `200`

### Step 5: Deploy

1. Click **Deploy** in the top right.
2. Watch the deployment logs in real time.
3. Once deployed, verify:
   - Host lobby: `https://quiz.example.com/host` (A 4-digit PIN should appear).
   - Player join: `https://quiz.example.com` (Enter the PIN and a nickname to join).

---

## Alternative: Deploying via Nixpacks

If you prefer using **Nixpacks** instead of the Dockerfile:

1. In Coolify application settings, change **Build Pack** to **Nixpacks**.
2. **CRITICAL STEP**: By default, Nixpacks detects Next.js and attempts to run `next start`. **This will break the app**, as `next start` does not initialize the Socket.io server in `server.ts`.
3. In Coolify, under **Custom Commands**:
   - **Start Command**: Set to `npm start` (or `npx tsx server.ts`).
   - **Build Command**: `npm run build`
   - **Install Command**: `npm ci`
4. Set the same environment variables listed above (`HOST=0.0.0.0`, `PORT=3000`, `NODE_ENV=production`).
5. Set **Port Exposes** to `3000`.
6. Deploy.

---

## WebSockets & Reverse Proxy Notes

- **Traefik (Coolify Default)**: Coolify's built-in Traefik proxy natively supports HTTP upgrades for WebSockets without custom headers needed.
- **SSL / HTTPS**: When accessing the site via `https://`, Socket.io automatically connects using secure WebSockets (`wss://`). Ensure your domain has an active SSL certificate in Coolify.
- **Host Header Forwarding**: Traefik automatically passes the client `Host` header to the container. If you set `ALLOWED_HOSTS`, ensure it matches your public domain (e.g. `quiz.example.com`).

---

## Troubleshooting

### 1. Players see "Connecting to server..." or WebSocket fails
- **Cause A (Wrong Start Command)**: If using Nixpacks, verify that the start command is `npm start` and NOT `next start`.
- **Cause B (SSL Mismatch)**: If you visit `http://` instead of `https://` on a domain with HSTS or vice versa, the WebSocket handshake may be blocked by mixed-content security rules.
- **Cause C (Allowed Hosts/Origins)**: If you configured `ALLOWED_HOSTS` or `ALLOWED_ORIGINS`, double-check for typos. Temporarily unset both variables to verify if they are causing the refusal.

### 2. HTTP 403 Forbidden on page load
- `ALLOWED_HOSTS` is set in the environment, but the incoming request `Host` header does not match. Either add the domain to `ALLOWED_HOSTS` or unset the variable.

### 3. Rooms disappear or disconnect unexpectedly
- Room state is stored entirely in RAM. Every container restart or redeploy wipes the current lobbies.
- Ensure container **Instances / Replicas** is set to `1`. If multiple replicas are running, a player might hit instance A while the host is on instance B.
