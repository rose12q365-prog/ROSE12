// server.js - robust minimal server for Render
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(express.json());

app.get('/', (req, res) => res.send('OK - server running'));

// simple in-memory demo (you can keep your earlier logic here)
const users = {};
const tokens = {};
const matchToRooms = {};

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
});

// simple endpoints
app.post('/create', (req, res) => {
  const { matchId, createdBy } = req.body || {};
  const token = (Math.random()+1).toString(36).substring(2,10);
  const room = `room_${token}`;
  tokens[token] = { room, matchId, createdBy: createdBy || null };
  if (matchId) {
    matchToRooms[matchId] = matchToRooms[matchId]||[];
    matchToRooms[matchId].push(room);
  }
  return res.json({ token, room, link: `${process.env.FRONTEND_URL||'http://localhost:5173'}/?token=${token}` });
});

app.post('/simulate', (req, res) => {
  const p = req.body || {};
  const rooms = matchToRooms[p.matchId] || [];
  const event = { ts: Date.now(), ...p };
  rooms.forEach(r => io.to(r).emit('gameEvent', event));
  return res.json({ ok:true, event, rooms });
});

// start server: use process.env.PORT (Render provides it)
const PORT = Number(process.env.PORT || 3000);
server.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});

