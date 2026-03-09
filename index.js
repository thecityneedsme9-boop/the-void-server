const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors()); 

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" } 
});

let activeUsers = 0;
let vanishedChats = 8400; 
let waitingUser = null; 

function getFlagEmoji(countryCode) {
    if (!countryCode) return '🏳️';
    const codePoints = countryCode
        .toUpperCase()
        .split('')
        .map(char =>  127397 + char.charCodeAt());
    return String.fromCodePoint(...codePoints);
}

io.on('connection', (socket) => {
    activeUsers++;
    io.emit('stats_update', { activeUsers, vanishedChats });

    socket.on('find_match', async (userData) => {
        let userFlag = '🏳️';
        try {
            const ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
            const response = await axios.get(`http://ip-api.com/json/${ip.split(',')[0]}`);
            if (response.data && response.data.countryCode) {
                userFlag = getFlagEmoji(response.data.countryCode);
            }
        } catch (error) { console.log("IP fetch failed"); }

        socket.userData = { id: socket.id, flag: userFlag, karma: userData.localKarma || "5.0" };

        if (waitingUser && waitingUser.id !== socket.id) {
            const roomName = `room_${waitingUser.id}_${socket.id}`;
            socket.join(roomName);
            waitingUser.join(roomName);
            socket.emit('match_found', { flag: waitingUser.userData.flag, karma: waitingUser.userData.karma });
            waitingUser.emit('match_found', { flag: socket.userData.flag, karma: socket.userData.karma });
            socket.room = roomName;
            waitingUser.room = roomName;
            waitingUser = null; 
        } else { waitingUser = socket; }
    });

    socket.on('send_message', (text) => {
        if (socket.room) { socket.to(socket.room).emit('receive_message', text); }
    });

    socket.on('typing', () => {
        if (socket.room) { socket.to(socket.room).emit('stranger_typing'); }
    });

    socket.on('chat_shattered', () => {
        vanishedChats++;
        io.emit('stats_update', { activeUsers, vanishedChats });
    });

    socket.on('disconnect', () => {
        activeUsers--;
        io.emit('stats_update', { activeUsers, vanishedChats });
        if (waitingUser && waitingUser.id === socket.id) { waitingUser = null; }
        if (socket.room) { socket.to(socket.room).emit('stranger_disconnected'); }
    });
});

server.listen(3000, () => {
    console.log(`The Void Server is alive on port 3000`);
});
