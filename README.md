# Connectly

Real-time chat built with **FastAPI**, **React**, **WebSocket** and **MySQL 8**, with Redis for cross-instance fan-out and presence.

## Run it with Docker (recommended)

```bash
cp .env.example .env        # optional for local use, required before deploying
docker compose up --build
```

Open <http://localhost:3000>, create two accounts in two browsers (or one normal and one private window), start a chat and message yourself.
API docs: <http://localhost:8000/docs>

## Run it without Docker

You need MySQL 8 and Redis running locally.

```sql
CREATE DATABASE connectly CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER 'connectly'@'%' IDENTIFIED BY 'connectly';
GRANT ALL ON connectly.* TO 'connectly'@'%';
```

```bash
# backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000

# frontend (second terminal)
cd frontend
npm install
npm run dev                  # http://localhost:5173, proxies /api, /ws and /files to :8000
```

Tables are created on startup (`AUTO_CREATE_TABLES=true`). For production, set it to `false` and use Alembic:

```bash
cd backend
alembic revision --autogenerate -m "initial schema"   # review the file before applying
alembic upgrade head
```

## Tests

```bash
cd backend && pytest          # security helpers and payload validation
cd frontend && npm test       # message ordering / optimistic-send logic
```

## What is included

- Register, login, refresh-token rotation, logout (Argon2 password hashing, short-lived JWT access tokens)
- 1:1 and group chats; find-or-create DMs are race-safe (`direct_key` unique index)
- Real-time delivery, optimistic sends with `client_id` idempotency (safe retries), failed-send retry
- Cursor-paginated history (`before_id`) and gap-fill after reconnect (`after_id`)
- Presence (Redis counter + heartbeat), typing indicators, unread counts, read receipts ("Seen")
- Image/file uploads (MIME allow-list, size limit, random file names)
- Message edit/delete are implemented in the backend (`message.edit`, `message.delete` events); the UI does not expose them yet
- Multi-instance ready: every instance subscribes to one Redis channel and delivers to its own sockets

## WebSocket protocol (`/ws?token=<access token>`)

Client to server:

```json
{"type":"message.send","conversation_id":1,"client_id":"<uuid>","kind":"text","content":"Hi"}
{"type":"message.send","conversation_id":1,"client_id":"<uuid>","kind":"image","content":"caption","attachment":{"url":"/files/..","mime_type":"image/png","size_bytes":123,"filename":"a.png"}}
{"type":"typing.start","conversation_id":1}
{"type":"message.read","conversation_id":1,"message_id":340}
{"type":"message.edit","message_id":340,"content":"new text"}
{"type":"message.delete","message_id":340}
{"type":"ping"}
```

Server to client: `message.new`, `message.ack`, `message.updated`, `message.read`, `typing`, `presence.update`, `conversation.new`, `error`, `pong`.
Close codes: `4401` bad or expired token (client refreshes and reconnects), `4403` origin not allowed.

## Project layout

```
backend/app/
  api/        REST routers (auth, users, conversations, uploads)
  core/       config, security, redis helpers
  db/         engine/session, base types
  models/     SQLAlchemy models
  schemas/    Pydantic request models
  services/   chat logic, membership cache, presence
  ws/         connection manager (Redis pub/sub), event handlers, endpoint
backend/migrations/   Alembic (async)
frontend/src/
  lib/        api client, socket client, helpers
  store/      Zustand stores (auth, chat)
  features/   auth and chat UI
```

## Before you deploy

- Set a strong `SECRET_KEY` and database passwords; never use the defaults.
- Serve over HTTPS so the socket is `wss://`; set `CORS_ORIGINS` to your real origin (also used for the WebSocket origin check).
- The access token travels in the WebSocket URL query string, so make sure your proxy and access logs do not record query strings.
- Uploads are stored on local disk and are readable by anyone who has the URL. For production, move them to S3-compatible storage with pre-signed URLs.
- The refresh token is kept in `localStorage`. If you need stronger XSS resistance, switch it to an HttpOnly cookie.
- Presence is eventually consistent: if a server crashes, affected users show as online until the 90-second heartbeat TTL expires.

## Simplifications vs. the original plan

- State management uses Zustand only (no TanStack Query), and the message list is a plain scroll container rather than `react-virtuoso`. Both are straightforward to swap in later.
- Social features beyond the MVP are not built: push notifications, search, threads, reactions, end-to-end encryption.
