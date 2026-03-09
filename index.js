const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.get('/', (req, res) => res.status(200).send('The Void Engine is flawless and active.'));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

let activeUsers = 0;
let vanishedChats = 8420; 
let waitingUser = null;

io.on('connection', (socket) => {
    activeUsers++;
    io.emit('stats_update', { activeUsers, vanishedChats });

    socket.on('find_match', (data) => {
        const karma = data?.localKarma || "5.0";
        if (waitingUser && waitingUser.id !== socket.id) {
            const room = `room_${waitingUser.id}_${socket.id}`;
            socket.join(room);
            waitingUser.join(room);
            
            io.to(room).emit('match_found', { flag: '🏳️', karma: karma });
            
            socket.room = room;
            waitingUser.room = room;
            waitingUser = null; 
        } else {
            waitingUser = socket;
        }
    });

    // Chat Routing
    socket.on('send_message', (msg) => {
        if (socket.room) socket.to(socket.room).emit('receive_message', msg);
    });

    socket.on('typing', () => {
        if (socket.room) socket.to(socket.room).emit('typing');
    });

    // Extension Logic
    socket.on('request_extend', () => {
        if (socket.room) socket.to(socket.room).emit('extend_requested');
    });

    socket.on('accept_extend', () => {
        if (socket.room) io.to(socket.room).emit('extend_accepted');
    });

    // 1v1 Games Routing (RPS & TTT)
    socket.on('game_action', (actionData) => {
        if (socket.room) socket.to(socket.room).emit('game_action', actionData);
    });

    // Disconnect & Shatter Logic
    socket.on('chat_shattered', () => {
        vanishedChats++;
        io.emit('stats_update', { activeUsers, vanishedChats });
    });

    socket.on('leave_chat', () => {
        if (socket.room) {
            socket.to(socket.room).emit('stranger_disconnected');
            socket.leave(socket.room);
            socket.room = null;
        }
    });

    socket.on('disconnect', () => {
        activeUsers--;
        if (waitingUser && waitingUser.id === socket.id) waitingUser = null;
        if (socket.room) {
            socket.to(socket.room).emit('stranger_disconnected');
            vanishedChats++;
        }
        io.emit('stats_update', { activeUsers, vanishedChats });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Void active on ${PORT}`));
