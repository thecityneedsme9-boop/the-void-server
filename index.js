const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.get('/', (req, res) => res.status(200).send('Void Engine Active'));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

let activeUsers = 0;
let vanishedChats = 8420; 
let waitingPool = []; 
const roomsData = {}; 

io.on('connection', (socket) => {
    activeUsers++;
    socket.lastPartnerId = null; 
    io.emit('stats_update', { activeUsers, vanishedChats });

    // === PASSWORD LOCKED ADMIN PROTOCOL ===
    socket.on('get_admin_data', (secret) => {
        if (secret === "Samsung09") {
            socket.emit('admin_dashboard', {
                totalUsers: activeUsers,
                waitingUsers: waitingPool.length,
                activeRooms: Object.keys(roomsData).length,
                totalVanished: vanishedChats
            });
        } else {
            socket.emit('admin_error'); // Sends a rejection if they guess wrong
        }
    });

    socket.on('find_match', (data) => {
        const karma = data?.localKarma || "5.0";
        const matchIndex = waitingPool.findIndex(user => user.id !== socket.id && user.id !== socket.lastPartnerId);

        if (matchIndex !== -1) {
            const partner = waitingPool.splice(matchIndex, 1)[0];
            const room = `room_${partner.id}_${socket.id}`;
            
            socket.join(room);
            partner.join(room);
            
            roomsData[room] = { maxChars: 1500, usedChars: 0 };
            socket.lastPartnerId = partner.id;
            partner.lastPartnerId = socket.id;

            io.to(room).emit('match_found', { flag: '🇧🇩', karma: karma });
            socket.room = room;
            partner.room = room;
        } else {
            if (!waitingPool.find(u => u.id === socket.id)) waitingPool.push(socket);
        }
    });

    socket.on('send_message', (msg) => {
        if (socket.room && roomsData[socket.room]) {
            roomsData[socket.room].usedChars += msg.length;
            const used = roomsData[socket.room].usedChars;
            const max = roomsData[socket.room].maxChars;
            socket.to(socket.room).emit('receive_message', msg);
            io.to(socket.room).emit('sync_chars', { used, max });
            if (used >= max) io.to(socket.room).emit('force_shatter');
        }
    });

    socket.on('typing', () => { if (socket.room) socket.to(socket.room).emit('typing'); });
    socket.on('request_extend', () => { if (socket.room) socket.to(socket.room).emit('extend_requested'); });
    socket.on('accept_extend', () => {
        if (socket.room && roomsData[socket.room]) {
            roomsData[socket.room].maxChars += 500;
            io.to(socket.room).emit('extend_accepted', { max: roomsData[socket.room].maxChars, used: roomsData[socket.room].usedChars });
        }
    });
    socket.on('game_action', (actionData) => { if (socket.room) socket.to(socket.room).emit('game_action', actionData); });
    socket.on('submit_rating', (rating) => { if (socket.room) socket.to(socket.room).emit('receive_rating', rating); });
    socket.on('chat_shattered', () => { vanishedChats++; io.emit('stats_update', { activeUsers, vanishedChats }); });

    socket.on('leave_chat', () => {
        if (socket.room) {
            io.to(socket.room).emit('stranger_disconnected'); 
            io.to(socket.room).emit('force_shatter');
            delete roomsData[socket.room];
            socket.leave(socket.room);
            socket.room = null;
        }
        waitingPool = waitingPool.filter(u => u.id !== socket.id);
    });

    socket.on('disconnect', () => {
        activeUsers--;
        waitingPool = waitingPool.filter(u => u.id !== socket.id);
        if (socket.room) {
            io.to(socket.room).emit('stranger_disconnected');
            io.to(socket.room).emit('force_shatter');
            delete roomsData[socket.room];
            vanishedChats++;
        }
        io.emit('stats_update', { activeUsers, vanishedChats });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Void active on ${PORT}`));
