const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// 1. 'public' folder se static files serve karein
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/coinflip_casino";
mongoose.connect(MONGO_URI)
    .then(() => console.log("MongoDB Database Connected Successfully"))
    .catch(err => console.error("MongoDB Connection Error:", err));

// Database Schemas
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    balance: { type: Number, default: 0 },
    isOnline: { type: Boolean, default: false }
});

const DepositSchema = new mongoose.Schema({
    username: { type: String, required: true },
    amount: { type: Number, required: true },
    txnId: { type: String, required: true },
    status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
    createdAt: { type: Date, default: Date.now }
});

const WithdrawalSchema = new mongoose.Schema({
    username: { type: String, required: true },
    amount: { type: Number, required: true },
    upiDetails: { type: String, required: true },
    status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
    createdAt: { type: Date, default: Date.now }
});

const SettingSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    value: { type: String, required: true }
});

const User = mongoose.model('User', UserSchema);
const Deposit = mongoose.model('Deposit', DepositSchema);
const Withdrawal = mongoose.model('Withdrawal', WithdrawalSchema);
const Setting = mongoose.model('Setting', SettingSchema);

// System State
let gameTimer = 30;
let currentBets = []; // Array of { socketId, username, side, amount }
let forcedOutcome = 'AUTO'; // 'AUTO', 'FORCE_HEADS', 'FORCE_TAILS'
let houseProfit = 0;
let totalVolume = 0;
let history = [];

// Initialize Default Settings
async function initSettings() {
    try {
        const upi = await Setting.findOne({ key: 'admin_upi' });
        if (!upi) {
            await Setting.create({ key: 'admin_upi', value: 'paytmqr@upi' });
        }
    } catch (err) {
        console.error("Settings initialization error:", err);
    }
}
initSettings();

// Core Game Loop
setInterval(async () => {
    gameTimer--;

    const headsTotal = currentBets.filter(b => b.side === 'HEADS').reduce((a, b) => a + b.amount, 0);
    const tailsTotal = currentBets.filter(b => b.side === 'TAILS').reduce((a, b) => a + b.amount, 0);

    let projectedOutcome = 'HEADS';
    if (headsTotal < tailsTotal) {
        projectedOutcome = 'HEADS';
    } else if (tailsTotal < headsTotal) {
        projectedOutcome = 'TAILS';
    } else {
        projectedOutcome = Math.random() < 0.5 ? 'HEADS' : 'TAILS';
    }

    if (gameTimer === 0) {
        let finalOutcome = projectedOutcome;
        if (forcedOutcome === 'FORCE_HEADS') finalOutcome = 'HEADS';
        if (forcedOutcome === 'FORCE_TAILS') finalOutcome = 'TAILS';

        let winners = [];
        let roundPayout = 0;
        let roundBetTotal = headsTotal + tailsTotal;
        totalVolume += roundBetTotal;

        for (let bet of currentBets) {
            if (bet.side === finalOutcome) {
                const winAmount = bet.amount * 2;
                roundPayout += winAmount;
                winners.push({ username: bet.username, amount: winAmount });
                
                await User.findOneAndUpdate(
                    { username: bet.username },
                    { $inc: { balance: winAmount } }
                );
            }
        }

        houseProfit += (roundBetTotal - roundPayout);
        history.unshift(finalOutcome);
        if (history.length > 10) history.pop();

        io.emit('game_result', {
            outcome: finalOutcome,
            winners,
            history,
            headsTotal,
            tailsTotal
        });

        currentBets = [];
        gameTimer = 30;
    }

    io.emit('timer_tick', {
        timer: gameTimer,
        headsTotal,
        tailsTotal,
        projectedAutoOutcome: projectedOutcome,
        forcedOutcome
    });
}, 1000);

// Realtime Socket Handlers
io.on('connection', (socket) => {

    socket.on('user_login', async (data, callback) => {
        try {
            let user = await User.findOne({ username: data.username });
            if (data.isSignUp) {
                if (user) return callback({ success: false, msg: "User already exists!" });
                user = await User.create({ username: data.username, password: data.password, balance: 100 });
            } else {
                if (!user || user.password !== data.password) {
                    return callback({ success: false, msg: "Invalid username or password!" });
                }
            }
            user.isOnline = true;
            await user.save();
            
            socket.username = user.username;
            const upiSetting = await Setting.findOne({ key: 'admin_upi' });

            callback({
                success: true,
                userData: { username: user.username, balance: user.balance },
                adminUpi: upiSetting ? upiSetting.value : 'paytmqr@upi'
            });
        } catch (e) {
            callback({ success: false, msg: "Server Error during login" });
        }
    });

    socket.on('place_bet', async (data, callback) => {
        if (gameTimer <= 3) return callback({ success: false, msg: "Betting locked for spin!" });
        if (!socket.username) return callback({ success: false, msg: "Please login first!" });

        try {
            const user = await User.findOne({ username: socket.username });
            if (!user || user.balance < data.amount) {
                return callback({ success: false, msg: "Insufficient Balance!" });
            }

            user.balance -= data.amount;
            await user.save();

            currentBets.push({
                socketId: socket.id,
                username: socket.username,
                side: data.side,
                amount: data.amount
            });

            callback({ success: true, newBalance: user.balance });
            io.emit('new_bet_placed', { username: socket.username, side: data.side, amount: data.amount });
        } catch (e) {
            callback({ success: false, msg: "Database operation failed" });
        }
    });

    socket.on('submit_deposit', async (data, callback) => {
        try {
            await Deposit.create({
                username: socket.username,
                amount: data.amount,
                txnId: data.txnId
            });
            callback({ success: true, msg: "Deposit Request Submitted!" });
        } catch (e) {
            callback({ success: false, msg: "Error submitting deposit." });
        }
    });

    socket.on('submit_withdrawal', async (data, callback) => {
        try {
            const user = await User.findOne({ username: socket.username });
            if (!user || user.balance < data.amount) {
                return callback({ success: false, msg: "Insufficient balance!" });
            }

            user.balance -= data.amount;
            await user.save();

            await Withdrawal.create({
                username: socket.username,
                amount: data.amount,
                upiDetails: data.upi
            });

            callback({ success: true, newBalance: user.balance, msg: "Withdrawal Requested!" });
        } catch (e) {
            callback({ success: false, msg: "Error processing withdrawal." });
        }
    });

    // NEW ADDED: Fetch user's deposit and withdrawal history
    socket.on('get_user_history', async (callback) => {
        if (!socket.username) return callback({ success: false, msg: "Please login first!" });
        try {
            const deposits = await Deposit.find({ username: socket.username }).sort({ createdAt: -1 });
            const withdrawals = await Withdrawal.find({ username: socket.username }).sort({ createdAt: -1 });
            callback({ success: true, deposits, withdrawals });
        } catch (e) {
            callback({ success: false, msg: "Error fetching history." });
        }
    });

    // Admin Panel Handlers
    socket.on('admin_auth', (password, callback) => {
        if (password === 'admin123') {
            callback({ success: true });
        } else {
            callback({ success: false, msg: "Incorrect Admin Password" });
        }
    });

    socket.on('admin_get_data', async (callback) => {
        const users = await User.find({}, 'username balance isOnline');
        const deposits = await Deposit.find({ status: 'PENDING' });
        const withdrawals = await Withdrawal.find({ status: 'PENDING' });
        const upiSetting = await Setting.findOne({ key: 'admin_upi' });

        callback({
            users,
            deposits,
            withdrawals,
            houseProfit,
            totalVolume,
            adminUpi: upiSetting ? upiSetting.value : '',
            forcedOutcome
        });
    });

    socket.on('admin_set_outcome', (mode) => {
        forcedOutcome = mode;
        io.emit('admin_state_updated', { forcedOutcome });
    });

    socket.on('admin_process_deposit', async ({ id, action }) => {
        const dep = await Deposit.findById(id);
        if (dep && dep.status === 'PENDING') {
            dep.status = action;
            await dep.save();
            if (action === 'APPROVED') {
                await User.findOneAndUpdate({ username: dep.username }, { $inc: { balance: dep.amount } });
            }
            io.emit('admin_data_refresh');
        }
    });

    socket.on('admin_process_withdrawal', async ({ id, action }) => {
        const wd = await Withdrawal.findById(id);
        if (wd && wd.status === 'PENDING') {
            wd.status = action;
            await wd.save();
            if (action === 'REJECTED') {
                await User.findOneAndUpdate({ username: wd.username }, { $inc: { balance: wd.amount } });
            }
            io.emit('admin_data_refresh');
        }
    });

    socket.on('admin_update_balance', async ({ username, delta }) => {
        await User.findOneAndUpdate({ username }, { $inc: { balance: delta } });
        io.emit('admin_data_refresh');
    });

    socket.on('admin_update_upi', async (newUpi) => {
        await Setting.findOneAndUpdate({ key: 'admin_upi' }, { value: newUpi }, { upsert: true });
        io.emit('upi_updated', newUpi);
    });

    socket.on('disconnect', async () => {
        if (socket.username) {
            await User.findOneAndUpdate({ username: socket.username }, { isOnline: false });
        }
    });
});

// 2. Fallback Route
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Server Listen
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Casino Server running on port ${PORT}`));
