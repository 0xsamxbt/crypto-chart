# Crypto Live Price Chart

React (Vite) + Node.js (Express) + MongoDB.
The browser only talks to the backend. The backend asks Binance only for data that is not
already in MongoDB, and every user shares the same cache.

## Run

Needs Node 18+ and a MongoDB (local or Atlas).

Terminal 1 (API, port 4000):
    cd backend && cp .env.example .env     # set MONGODB_URI
    npm install && npm run dev

Terminal 2 (web, port 5173):
    cd frontend && npm install && npm run dev

Open http://localhost:5173
