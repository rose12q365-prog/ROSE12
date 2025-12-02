// server.js - backend for fake coins cricket game
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(express.json());

// In-memory data (restart hone par reset ho jayega – demo ke liye ok)
const users = {};          // userId -> {id, name, coins}
let nextUserId = 1;
const tokens = {};         // token -> { room, matchId, createdBy }
const matchToRooms = {};   // matchId -> [room names]
const withdrawRequests = [];

// initial coins per new user
const INITIAL_COINS = Number(process.env.INITIAL_COINS || 1000);

// Simple health check
app.get('/', (req, res) => {
  res.send('OK - server running');
});

// ------------ TOKEN / ROOM CREATION ---------------

// Create a new token / room for match
app.post('/create', (req, res) => {
  const { matchId, createdBy } = req.body || {};
  const token = (Math.random() + 1).toString(36).substring(2, 10);
  const room = `room_${token}`;

  tokens[token] = { room, matchId: matchId || null, createdBy: createdBy || null };

  if (matchId) {
    matchToRooms[matchId] = matchToRooms[matchId] || [];
    matchToRooms[matchId].push(room);
  }

  const frontendBase = process.env.FRONTEND_URL || 'http://localhost:5173';

  return res.json({
    token,
    room,
    link: `${frontendBase}/?token=${token}`
  });
});

// -------------- LIVE EVENT SIMULATION ----------------

app.post('/simulate', (req, res) => {
  const { matchId, over, runs, wicket, message } = req.body || {};
  if (!matchId) {
    return res.status(400).json({ error: 'matchId required' });
  }

  const rooms = matchToRooms[matchId] || [];
  const event = {
    ts: Date.now(),
    matchId,
    over: over || null,
    runs: runs != null ? runs : null,
    wicket: !!wicket,
    message: message || null
  };

  rooms.forEach(r => io.to(r).emit('gameEvent', event));

  return res.json({ ok: true, event, rooms });
});

// -------------- USER + COINS SYSTEM ------------------

// Create user with starting coins
app.post('/user/create', (req, res) => {
  const { name } = req.body || {};
  const id = String(nextUserId++);
  users[id] = {
    id,
    name: name || `player_${id}`,
    coins: INITIAL_COINS
  };
  return res.json({ user: users[id] });
});

// Player action: play a round, spend coins
app.post('/player-action', (req, res) => {
  const { token, userId, action } = req.body || {};

  if (!token || !tokens[token]) {
    return res.status(400).json({ error: 'INVALID_TOKEN' });
  }
  if (!userId || !users[userId]) {
    return res.status(400).json({ error: 'INVALID_USER' });
  }

  const user = users[userId];

  // For now, sirf ek action: "play" – cost 20 coins
  const COST_PER_PLAY = 20;
  if (action === 'play') {
    if (user.coins < COST_PER_PLAY) {
      return res.status(400).json({ error: 'INSUFFICIENT_COINS', coins: user.coins });
    }
    user.coins -= COST_PER_PLAY;
  } else {
    return res.status(400).json({ error: 'UNKNOWN_ACTION' });
  }

  const room = tokens[token].room;
  // broadcast balance update to everyone in room
  io.to(room).emit('balanceUpdate', { userId, coins: user.coins });

  return res.json({ ok: true, coins: user.coins });
});

// Request withdraw (demo – only records request and deducts coins)
app.post('/withdraw', (req, res) => {
  const { userId, amount } = req.body || {};
  const amt = Number(amount || 0);

  if (!userId || !users[userId]) {
    return res.status(400).json({ error: 'INVALID_USER' });
  }
  if (!amt || amt <= 0) {
    return res.status(400).json({ error: 'INVALID_AMOUNT' });
  }
  const user = users[userId];
  if (user.coins < amt) {
    return res.status(400).json({ error: 'INSUFFICIENT_COINS', coins: user.coins });
  }

  user.coins -= amt;

  const reqObj = {
    id: withdrawRequests.length + 1,
    userId,
    amount: amt,
    status: 'PENDING',
    createdAt: Date.now()
  };
  withdrawRequests.push(reqObj);

  // optional: emit event
  io.emit('withdrawRequest', reqObj);

  return res.json({ ok: true, request: reqObj, coins: user.coins });
});

// ------------ SOCKET.IO SETUP ------------------------

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true }
});

io.on('connection', socket => {
  console.log('socket connected', socket.id);

  socket.on('join', token => {
    const meta = tokens[token];
    if (!meta) {
      socket.emit('error', 'Invalid token');
      return;
    }
    socket.join(meta.room);
    socket.emit('joined', { room: meta.room });
  });

  socket.on('disconnect', () => {
    console.log('socket disconnected', socket.id);
  });
});

// ------------ START SERVER ---------------------------

const PORT = Number(process.env.PORT || 3000);
server.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});
