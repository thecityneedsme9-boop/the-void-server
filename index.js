const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { instrument } = require('@socket.io/admin-ui'); // The Admin Dashboard

const app = express();
app.use(cors());
app.get('/', (req, res) => res.status(200).send('Void Engine Active'));

const server = http.createServer(app);

// We use a function for CORS so it allows your website AND the Admin UI perfectly
const io = new Server(server, { 
    cors: { 
        origin: function(origin, callback) { callback(null, true); }, 
        credentials: true 
    } 
});

// Turn on the Admin Dashboard
instrument(io, {
    auth: false, // No password for now, keep it simple
    mode: "development",
});

let activeUsers = 0;
let vanishedChats = 8420; 
let waitingPool = []; // The Anti-Rematch Array
const roomsData = {}; 

io.on('connection', (socket) => {
    activeUsers++;
    socket.lastPartnerId = null; // Memory of the last person they talked to

    io.emit('stats_update', { activeUsers, vanishedChats });

    socket.on('find_match', (data) => {
        const karma = data?.localKarma || "5.0";
        
        // Find someone waiting who is NOT this user, and NOT their last partner
        const matchIndex = waitingPool.findIndex(user => user.id !== socket.id && user.id !== socket.lastPartnerId);

        if (matchIndex !== -1) {
            // Match found! Pull them out of the pool
            const partner = waitingPool.splice(matchIndex, 1)[0];
            const room = `room_${partner.id}_${socket.id}`;
            
            socket.join(room);
            partner.join(room);
            
            roomsData[room] = { maxChars: 1500, usedChars: 0 };
            
            // Save the memory of this match to prevent instant rematch next time
            socket.lastPartnerId = partner.id;
            partner.lastPartnerId = socket.id;

            io.to(room).emit('match_found', { flag: '🇧🇩', karma: karma });
            
            socket.room = room;
            partner.room = room;
        } else {
            // Nobody valid is waiting, so join the pool
            if (!waitingPool.find(u => u.id === socket.id)) {
                waitingPool.push(socket);
            }
        }
    });

    socket.on('send_message', (msg) => {
        if (socket.room && roomsData[socket.room]) {
            roomsData[socket.room].usedChars += msg.length;
            const used = roomsData[socket.room].usedChars;
            const max = roomsData[socket.room].maxChars;
            
            socket.to(socket.room).emit('receive_message', msg);
            io.to(socket.room).emit('sync_chars', { used, max });

            if (used >= max) {
                io.to(socket.room).emit('force_shatter');
            }
        }
    });

    socket.on('typing', () => {
        if (socket.room) socket.to(socket.room).emit('typing');
    });

    socket.on('request_extend', () => {
        if (socket.room) socket.to(socket.room).emit('extend_requested');
    });

    socket.on('accept_extend', () => {
        if (socket.room && roomsData[socket.room]) {
            roomsData[socket.room].maxChars += 500;
            io.to(socket.room).emit('extend_accepted', { max: roomsData[socket.room].maxChars, used: roomsData[socket.room].usedChars });
        }
    });

    socket.on('game_action', (actionData) => {
        if (socket.room) socket.to(socket.room).emit('game_action', actionData);
    });

    socket.on('submit_rating', (rating) => {
        if (socket.room) {
            socket.to(socket.room).emit('receive_rating', rating);
        }
    });

    socket.on('chat_shattered', () => {
        vanishedChats++;
        io.emit('stats_update', { activeUsers, vanishedChats });
    });

    socket.on('leave_chat', () => {
        if (socket.room) {
            io.to(socket.room).emit('stranger_disconnected'); 
            io.to(socket.room).emit('force_shatter');
            delete roomsData[socket.room];
            socket.leave(socket.room);
            socket.room = null;
        }
        // Remove them from the matchmaking pool if they exit while searching
        waitingPool = waitingPool.filter(u => u.id !== socket.id);
    });

    socket.on('disconnect', () => {
        activeUsers--;
        // Remove them from the pool if they close the tab while searching
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
