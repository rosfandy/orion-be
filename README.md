# Orion BE

Express.js API dengan TypeScript.

## Menjalankan

```bash
npm install
cp .env.example .env
npm run db:up
npm run prisma:generate
npm run prisma:migrate -- --name init
npm run dev
```

Backend berjalan di port `3001`. Endpoint pengecekan: `GET /api/health`
Endpoint auth: `POST /api/auth/register` dan `POST /api/auth/login`
OAuth: `GET /api/auth/google`, `GET /api/auth/google/callback`, `GET /api/auth/github`, dan `GET /api/auth/github/callback`
Google One Tap: `POST /api/auth/google/one-tap`
Current user: `GET /api/auth/me`
Add workspace member: `POST /api/workspaces/:id/members` with `{ "email": "user@example.com", "role": "member" }`
Graph update: `PATCH /api/graphs/:id` accepts `children`; provide a child `id` to update it, or omit `id` to create a new child.
Graph search: `GET /api/graphs/label/:label?props={"name":"My%20Workspace"}` filters by exact properties.

Saat startup, Express memverifikasi koneksi Neo4j melalui `verifyConnectivity()` sebelum menerima request. Jika Neo4j tidak tersedia, server tidak akan dijalankan.

## Struktur

```text
src/
├── config/         # Konfigurasi environment
│   ├── database.ts  # Prisma Client
│   └── neo4j.ts     # Neo4j Driver dan session helper
├── controllers/    # Handler request/response
├── dtos/           # Kontrak data untuk API
├── routes/         # Definisi endpoint
├── services/       # Business logic
├── app.ts          # Konfigurasi Express
└── server.ts       # HTTP server entrypoint
prisma/
├── schema.prisma   # Konfigurasi Prisma PostgreSQL
└── models/
    └── user.schema.prisma # Model tabel users dan accounts OAuth
```

Set `DATABASE_URL` di `.env` sesuai konfigurasi PostgreSQL lokal Anda.
Set `NEO4J_URI`, `NEO4J_USERNAME`, dan `NEO4J_PASSWORD` sesuai konfigurasi Neo4j Anda.
OAuth config tersedia di `src/config/oauth.ts`. Isi `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, dan `GITHUB_CLIENT_SECRET` di `.env` sesuai credentials dari masing-masing provider.
Callback OAuth membuat JWT di backend, menyimpannya sebagai cookie `HttpOnly`, lalu redirect ke FE dengan `?success=true`. Daftarkan callback URL backend yang sama di Google/GitHub Developer Console.
Untuk memulai OAuth, gunakan browser navigation, bukan Axios/XHR:

```ts
window.location.href = 'http://localhost:3001/api/auth/google';
```
Logging menggunakan `pino` dan `pino-http`: development mencatat semua request dalam format readable dengan `pino-pretty`, production hanya mencatat request error (`4xx/5xx`) dan error aplikasi dalam JSON.

Perintah PostgreSQL Docker:

```bash
npm run db:up       # start PostgreSQL
npm run db:down     # stop PostgreSQL
```

Gunakan `getNeo4jSession()` dari `src/config/neo4j.ts` di service, lalu selalu panggil `session.close()` setelah query selesai.
