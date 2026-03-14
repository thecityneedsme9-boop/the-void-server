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
let adminHistory = []; 

const ipPhotoLimits = {}; 

setInterval(() => { 
    for (let ip in ipPhotoLimits) delete ipPhotoLimits[ip]; 
}, 86400000);

io.on('connection', (socket) => {
    activeUsers++;
    socket.lastPartnerId = null; 
    socket.isAdmin = false; 

    const forwarded = socket.handshake.headers["x-forwarded-for"];
    const userIp = forwarded ? forwarded.split(',')[0] : socket.handshake.address;
    socket.userIp = userIp;
    
    io.emit('stats_update', { activeUsers, vanishedChats });

    socket.on('get_admin_data', (secret) => {
        if (secret.trim() === "Samsung09") {
            socket.isAdmin = true; 
            socket.emit('admin_dashboard', {
                totalUsers: activeUsers,
                waitingUsers: waitingPool.length,
                activeRooms: Object.keys(roomsData).length,
                totalVanished: vanishedChats
            });
            adminHistory.forEach(m => socket.emit('spy_feed', m));
        } else { socket.emit('admin_error'); }
    });

    socket.on('find_match', (data) => {
        const karma = data?.localKarma || "5.0";
        const matchIndex = waitingPool.findIndex(user => user.id !== socket.id && user.id !== socket.lastPartnerId);

        if (matchIndex !== -1) {
            const partner = waitingPool.splice(matchIndex, 1)[0];
            const room = `room_${partner.id}_${socket.id}`;
            socket.join(room); partner.join(room);
            roomsData[room] = { maxChars: 1500, usedChars: 0, disconnectTimer: null };
            socket.lastPartnerId = partner.id; partner.lastPartnerId = socket.id;
            io.to(room).emit('match_found', { flag: '🇧🇩', karma: karma, roomId: room });
            socket.room = room; partner.room = room;
        } else {
            if (!waitingPool.find(u => u.id === socket.id)) waitingPool.push(socket);
        }
    });

    socket.on('reclaim_session', (roomId) => {
        if (roomsData[roomId]) {
            socket.join(roomId); socket.room = roomId;
            if (roomsData[roomId].disconnectTimer) { clearTimeout(roomsData[roomId].disconnectTimer); roomsData[roomId].disconnectTimer = null; }
            socket.to(roomId).emit('stranger_status', 'online');
        }
    });

    socket.on('send_message', (msg) => {
        if (!msg || !socket.room || !roomsData[socket.room]) return; 
        
        const isImage = msg.type === 'image';
        const isMusic = msg.type === 'music';
        let textContent = typeof msg === 'string' ? msg : msg.text;
        
        if (isImage) { textContent = "📷 Photo"; msg.text = textContent; }
        if (isMusic) { textContent = "🎵 Shared a frequency"; msg.text = textContent; }

        if (!textContent && !isImage && !isMusic) return; 

        if (isImage) {
            const currentCount = ipPhotoLimits[socket.userIp] || 0;
            if (currentCount >= 20) {
                return socket.emit('receive_message', { system: true, text: "⚠️ VOID ERROR: Daily photo limit (20) reached." });
            }
            ipPhotoLimits[socket.userIp] = currentCount + 1;
            roomsData[socket.room].usedChars += 70; 
        } else if (isMusic) {
            roomsData[socket.room].usedChars += 50; 
        } else {
            roomsData[socket.room].usedChars += textContent.length;
        }

        const used = roomsData[socket.room].usedChars;
        const max = roomsData[socket.room].maxChars;
        
        if (isImage || isMusic) {
            io.to(socket.room).emit('receive_message', msg); 
        } else {
            socket.to(socket.room).emit('receive_message', msg); 
        }
        
        io.to(socket.room).emit('sync_chars', { used, max });

        // Admin History Sync
        const msgData = { 
            text: textContent, roomId: socket.room, type: msg.type, 
            url: msg.url, cover: msg.cover, title: msg.title, artist: msg.artist 
        };
        adminHistory.push(msgData);
        setTimeout(() => { adminHistory = adminHistory.filter(m => m !== msgData); }, 3600000); 

        io.sockets.sockets.forEach((s) => { if (s.isAdmin) s.emit('spy_feed', msgData); });
        if (used >= max) io.to(socket.room).emit('force_shatter');
    });

    socket.on('react_message', (data) => { if (socket.room && data) socket.to(socket.room).emit('receive_reaction', data); });
    socket.on('typing', () => { if (socket.room) socket.to(socket.room).emit('typing'); });
    socket.on('request_extend', () => { if (socket.room) socket.to(socket.room).emit('extend_requested'); });
    socket.on('accept_extend', () => {
        if (socket.room && roomsData[socket.room]) {
            roomsData[socket.room].maxChars += 500;
            io.to(socket.room).emit('extend_accepted', { max: roomsData[socket.room].maxChars, used: roomsData[socket.room].usedChars });
        }
    });
    
    socket.on('game_action', (actionData) => { 
        if (socket.room) socket.to(socket.room).emit('game_action', actionData); 
    });

    socket.on('submit_rating', (rating) => { if (socket.room) socket.to(socket.room).emit('receive_rating', rating); });
    socket.on('chat_shattered', () => { vanishedChats++; io.emit('stats_update', { activeUsers, vanishedChats }); });
    socket.on('user_status', (status) => { if (socket.room) socket.to(socket.room).emit('stranger_status', status); });

    socket.on('leave_chat', () => {
        if (socket.room) {
            io.to(socket.room).emit('stranger_disconnected'); io.to(socket.room).emit('force_shatter');
            delete roomsData[socket.room]; socket.leave(socket.room); socket.room = null;
        }
        waitingPool = waitingPool.filter(u => u.id !== socket.id);
    });

    socket.on('disconnect', () => {
        activeUsers--; waitingPool = waitingPool.filter(u => u.id !== socket.id);
        io.emit('stats_update', { activeUsers, vanishedChats });
        if (socket.room && roomsData[socket.room]) {
            socket.to(socket.room).emit('stranger_status', 'offline');
            roomsData[socket.room].disconnectTimer = setTimeout(() => {
                if (roomsData[socket.room]) { 
                    io.to(socket.room).emit('stranger_disconnected'); io.to(socket.room).emit('force_shatter');
                    delete roomsData[socket.room]; vanishedChats++; io.emit('stats_update', { activeUsers, vanishedChats });
                }
            }, 20000);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Void active on ${PORT}`));
