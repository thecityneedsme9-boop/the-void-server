const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.get('/', (req, res) => res.status(200).send('Void Engine Active'));

const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] } 
});

let activeUsers = 0;
let vanishedChats = 8420; 
let waitingPool = []; 
const roomsData = {}; 
let globalHistory = []; 
const ipPhotoLimits = {}; 

// Clean Global RAM every 5 mins
setInterval(() => {
    const twoHoursAgo = Date.now() - 7200000;
    globalHistory = globalHistory.filter(m => m.time > twoHoursAgo);
}, 300000);

setInterval(() => { 
    for (let ip in ipPhotoLimits) delete ipPhotoLimits[ip]; 
}, 86400000);

io.on('connection', (socket) => {
    activeUsers++;
    socket.lastPartnerId = null;
    socket.isNoctyx = false;
    socket.alias = "Shadow-" + Math.floor(Math.random() * 9999);
    socket.lastGlobalSend = 0; 
    
    const userIp = socket.handshake.headers["x-forwarded-for"]?.split(',')[0] || socket.handshake.address;
    socket.userIp = userIp;
    
    io.emit('stats_update', { activeUsers, vanishedChats });

    // === ADMIN & NOCTYX ===
    socket.on('get_admin_data', (secret) => {
        if (secret.trim() === "Samsung09") {
            socket.isAdmin = true; 
            socket.emit('admin_dashboard', {
                totalUsers: activeUsers,
                waitingUsers: waitingPool.length,
                activeRooms: Object.keys(roomsData).length,
                totalVanished: vanishedChats
            });
            globalHistory.forEach(m => socket.emit('spy_feed', m));
        } else { socket.emit('admin_error'); }
    });

    socket.on('auth_noctyx', (data) => {
        if (data.user === "Noctyx_333" && data.pass === "MiaKhalifa42") {
            socket.isNoctyx = true;
            socket.alias = "Noctyx";
            socket.emit('noctyx_verified', { alias: socket.alias });
        } else { socket.emit('auth_failed'); }
    });

    // === GLOBAL CHAT ===
    socket.on('join_global', () => {
        waitingPool = waitingPool.filter(u => u.id !== socket.id);
        socket.join('global_abyss');
        socket.room = 'global_abyss';
        socket.emit('global_joined', { alias: socket.alias });
        socket.emit('global_history', globalHistory);
    });

    socket.on('send_global', (data) => {
        if (!socket.isNoctyx) {
            const now = Date.now();
            if (now - socket.lastGlobalSend < 10000) return;
            socket.lastGlobalSend = now;
        }

        const isImage = data.type === 'image';
        const isMusic = data.type === 'music';
        let textContent = typeof data.text === 'string' ? data.text : "";

        // FLAW FIXED: IP limit for Global Photos
        if (isImage) {
            if (!socket.isNoctyx) {
                const count = ipPhotoLimits[socket.userIp] || 0;
                if (count >= 20) {
                    return socket.emit('receive_message', { system: true, text: "⚠️ VOID ERROR: Daily photo limit (20) reached." });
                }
                ipPhotoLimits[socket.userIp] = count + 1;
            }
            textContent = "📷 Photo";
        }
        if (isMusic) textContent = "🎵 Shared a frequency";

        const msg = {
            id: data.id || 'gmsg_' + Date.now(),
            sender: socket.alias,
            text: textContent,
            isNoctyx: socket.isNoctyx,
            time: Date.now(),
            type: data.type || 'text',
            url: data.url || null,
            cover: data.cover || null,
            title: data.title || null,
            artist: data.artist || null,
            replyTo: data.replyTo || null,
            roomId: 'global_abyss' // FLAW FIXED: Helps Admin Panel identify room
        };
        
        globalHistory.push(msg);
        io.to('global_abyss').emit('receive_global', msg);
        
        // FLAW FIXED: Send global message to Admin Spy Feed too
        io.sockets.sockets.forEach((s) => { if (s.isAdmin) s.emit('spy_feed', msg); });
    });

    // === PRIVATE ROOM INVITE ===
    socket.on('invite_private', (targetAlias) => {
        socket.to('global_abyss').emit('private_request', { 
            from: socket.alias, to: targetAlias, fromId: socket.id 
        });
    });

    socket.on('accept_private', (data) => {
        const partner = io.sockets.sockets.get(data.fromId);
        if (partner) {
            socket.leave('global_abyss');
            partner.leave('global_abyss');

            const room = `private_${partner.id}_${socket.id}`;
            socket.join(room);
            partner.join(room);
            
            const isInfinite = socket.isNoctyx || partner.isNoctyx;
            roomsData[room] = { maxChars: isInfinite ? 9999999 : 500, usedChars: 0, isInfinite: isInfinite };
            socket.room = room; partner.room = room;
            
            io.to(room).emit('match_found', { 
                roomId: room, isPrivateSide: true, isInfinite: isInfinite, strangerNoctyx: isInfinite 
            });
        }
    });

    // === 1v1 MATCHMAKING ===
    socket.on('find_match', (data) => {
        const matchIndex = waitingPool.findIndex(u => u.id !== socket.id);

        if (matchIndex !== -1) {
            const partner = waitingPool.splice(matchIndex, 1)[0];
            const room = `room_${partner.id}_${socket.id}`;
            
            socket.join(room); partner.join(room);
            
            const isInfinite = socket.isNoctyx || partner.isNoctyx;
            roomsData[room] = { maxChars: isInfinite ? 9999999 : 1500, usedChars: 0, isInfinite: isInfinite };
            
            socket.lastPartnerId = partner.id; partner.lastPartnerId = socket.id;

            io.to(room).emit('match_found', { 
                roomId: room, isPrivateSide: false, isInfinite: isInfinite, strangerNoctyx: socket.isNoctyx || partner.isNoctyx 
            });
            
            socket.room = room; partner.room = room;
        } else {
            if (!waitingPool.find(u => u.id === socket.id)) waitingPool.push(socket);
        }
    });

    // === CORE MESSAGE SYNC ===
    socket.on('send_message', (msg) => {
        if (!socket.room || socket.room === 'global_abyss' || !roomsData[socket.room]) return;
        
        const room = roomsData[socket.room];
        const isImage = msg.type === 'image';
        const isMusic = msg.type === 'music';
        let textContent = msg.text || "";

        if (isImage) textContent = "📷 Photo";
        if (isMusic) textContent = "🎵 Shared a frequency";
        
        if (!socket.isNoctyx) {
            if (isImage) {
                const count = ipPhotoLimits[socket.userIp] || 0;
                if (count >= 20) return socket.emit('receive_message', { system: true, text: "⚠️ VOID ERROR: Daily photo limit (20) reached." });
                ipPhotoLimits[socket.userIp] = count + 1;
                room.usedChars += 70;
            } else if (isMusic) {
                room.usedChars += 50;
            } else {
                room.usedChars += textContent.length;
            }
        }

        const msgDataOut = { 
            ...msg, text: textContent, senderAlias: socket.isNoctyx ? "Noctyx" : "Stranger", isNoctyx: socket.isNoctyx 
        };

        if (isImage || isMusic) { io.to(socket.room).emit('receive_message', msgDataOut); } 
        else { socket.to(socket.room).emit('receive_message', msgDataOut); }
        
        io.to(socket.room).emit('sync_chars', { used: room.usedChars, max: room.maxChars });

        if (!socket.room.startsWith('private_')) {
            const adminMsg = { ...msgDataOut, roomId: socket.room };
            io.sockets.sockets.forEach((s) => { if (s.isAdmin) s.emit('spy_feed', adminMsg); });
        }

        if (room.usedChars >= room.maxChars && !room.isInfinite) {
            io.to(socket.room).emit('force_shatter');
        }
    });

    // === UTILITIES ===
    socket.on('react_message', (data) => { if (socket.room && socket.room !== 'global_abyss') socket.to(socket.room).emit('receive_reaction', data); });
    
    // FLAW FIXED: Typing Indicator hidden in Global
    socket.on('typing', () => { 
        if (socket.room && socket.room !== 'global_abyss') socket.to(socket.room).emit('typing'); 
    });
    
    socket.on('request_extend', () => { if (socket.room && socket.room !== 'global_abyss') socket.to(socket.room).emit('extend_requested'); });
    socket.on('accept_extend', () => {
        if (socket.room && roomsData[socket.room]) {
            roomsData[socket.room].maxChars += 500;
            io.to(socket.room).emit('extend_accepted', { max: roomsData[socket.room].maxChars, used: roomsData[socket.room].usedChars });
        }
    });
    
    socket.on('game_action', (data) => { 
        if (socket.room && socket.room !== 'global_abyss') socket.to(socket.room).emit('game_action', data); 
    });

    socket.on('submit_rating', (rating) => { if (socket.room && socket.room !== 'global_abyss') socket.to(socket.room).emit('receive_rating', rating); });
    socket.on('chat_shattered', () => { vanishedChats++; io.emit('stats_update', { activeUsers, vanishedChats }); });

    // === LEAVE & DISCONNECT ===
    socket.on('leave_chat', () => {
        if (socket.room) {
            if (socket.room !== 'global_abyss') {
                io.to(socket.room).emit('stranger_disconnected'); 
                io.to(socket.room).emit('force_shatter');
                if (roomsData[socket.room]) delete roomsData[socket.room]; 
            }
            socket.leave(socket.room); 
            socket.room = null;
        }
        waitingPool = waitingPool.filter(u => u.id !== socket.id);
    });

    socket.on('disconnect', () => {
        activeUsers--; 
        waitingPool = waitingPool.filter(u => u.id !== socket.id);
        io.emit('stats_update', { activeUsers, vanishedChats });
        
        if (socket.room && socket.room !== 'global_abyss' && roomsData[socket.room]) {
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
server.listen(PORT, () => console.log(`Void Engine Active on Port ${PORT}`));
