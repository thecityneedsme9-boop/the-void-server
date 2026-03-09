const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors()); 

// 1. THIS FIXES THE 404 FOR GOOD
app.get('/', (req, res) => {
    res.status(200).send('The Void Server is ALIVE and routing traffic.');
});

const server = http.createServer(app);

// 2. THIS ALLOWS YOUR PC HTML FILE TO CONNECT
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] } 
});

let waitingUser = null; 

io.on('connection', (socket) => {
    
    socket.on('find_match', (userData) => {
        if (waitingUser && waitingUser.id !== socket.id) {
            // Pair them up
            const roomName = `room_${waitingUser.id}_${socket.id}`;
            socket.join(roomName);
            waitingUser.join(roomName);
            
            io.to(roomName).emit('match_found', { flag: '🏳️', karma: '5.0' });
            
            socket.room = roomName;
            waitingUser.room = roomName;
            waitingUser = null; 
        } else {
            waitingUser = socket;
        }
    });

    socket.on('send_message', (text) => {
        if (socket.room) {
            socket.to(socket.room).emit('receive_message', text);
        }
    });

    // 3. THIS GUARANTEES THE SHATTER EFFECT TRIGGERS
    socket.on('disconnect', () => {
        if (waitingUser && waitingUser.id === socket.id) {
            waitingUser = null;
        }
        if (socket.room) {
            socket.to(socket.room).emit('stranger_disconnected');
        }
    });
});

// 4. THIS BINDS TO RENDER'S EXACT PORT
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`The Void is breathing on port ${PORT}`);
});
