// server.js - Complete Backend Server
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/coinflip_casino';
mongoose.connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => console.log('MongoDB Connected'))
.catch(err => console.error('MongoDB Connection Error:', err));

// Schemas
const userSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    balance: { type: Number, default: 0 },
    isOnline: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

const depositSchema = new mongoose.Schema({
    username: { type: String, required: true },
    amount: { type: Number, required: true },
    txnId: { type: String, required: true },
    status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
    createdAt: { type: Date, default: Date.now }
});

const withdrawalSchema = new mongoose.Schema({
    username: { type: String, required: true },
    amount: { type: Number, required: true },
    upiDetails: { type: String, required: true },
    status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
    createdAt: { type: Date, default: Date.now }
});

const settingSchema = new mongoose.Schema({
    key: { type: String, unique: true, required: true },
    value: mongoose.Schema.Types.Mixed,
    updatedAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Deposit = mongoose.model('Deposit', depositSchema);
const Withdrawal = mongoose.model('Withdrawal', withdrawalSchema);
const Setting = mongoose.model('Setting', settingSchema);

// Game State
const gameState = {
    currentRound: 1,
    roundStartTime: null,
    roundEndTime: null,
    bets: {
        HEADS: [],
        TAILS: []
    },
    outcome: null,
    totalHeads: 0,
    totalTails: 0,
    houseProfit: 0,
    totalVolume: 0,
    adminMode: 'AUTO',
    settings: {
        receiverUPI: 'default@upi',
        minBet: 10,
        maxBet: 10000
    }
};

// Initialize settings
async function initSettings() {
    try {
        const [receiverUPI, houseProfit, totalVolume] = await Promise.all([
            Setting.findOne({ key: 'receiverUPI' }),
            Setting.findOne({ key: 'houseProfit' }),
            Setting.findOne({ key: 'totalVolume' })
        ]);
        
        if (receiverUPI) gameState.settings.receiverUPI = receiverUPI.value;
        if (houseProfit) gameState.houseProfit = houseProfit.value;
        if (totalVolume) gameState.totalVolume = totalVolume.value;
    } catch (error) {
        console.error('Error initializing settings:', error);
    }
}
initSettings();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Auth Routes
app.post('/api/auth/signup', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }
        
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ error: 'Username already exists' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({
            username,
            password: hashedPassword,
            balance: 100 // Welcome bonus
        });
        
        await user.save();
        res.json({ success: true, message: 'User created successfully' });
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        user.isOnline = true;
        await user.save();
        
        res.json({ 
            success: true, 
            username: user.username, 
            balance: user.balance 
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Deposit Routes
app.post('/api/deposit', async (req, res) => {
    try {
        const { username, amount, txnId } = req.body;
        
        const deposit = new Deposit({
            username,
            amount,
            txnId,
            status: 'PENDING'
        });
        
        await deposit.save();
        res.json({ success: true, deposit });
    } catch (error) {
        console.error('Deposit error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/deposits/:username', async (req, res) => {
    try {
        const deposits = await Deposit.find({ username: req.params.username });
        res.json(deposits);
    } catch (error) {
        console.error('Get deposits error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Withdrawal Routes
app.post('/api/withdrawal', async (req, res) => {
    try {
        const { username, amount, upiDetails } = req.body;
        
        const user = await User.findOne({ username });
        if (!user || user.balance < amount) {
            return res.status(400).json({ error: 'Insufficient balance' });
        }
        
        const session = await mongoose.startSession();
        session.startTransaction();
        
        try {
            user.balance -= amount;
            await user.save({ session });
            
            const withdrawal = new Withdrawal({
                username,
                amount,
                upiDetails,
                status: 'PENDING'
            });
            await withdrawal.save({ session });
            
            await session.commitTransaction();
            res.json({ success: true, withdrawal });
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    } catch (error) {
        console.error('Withdrawal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Socket.IO Connection
io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);
    let currentUser = null;
    
    // User authentication
    socket.on('auth', async (username) => {
        try {
            currentUser = username;
            const user = await User.findOne({ username });
            if (user) {
                user.isOnline = true;
                await user.save();
                socket.emit('auth_success', { balance: user.balance });
                broadcastUserList();
            }
        } catch (error) {
            console.error('Socket auth error:', error);
        }
    });
    
    // Place bet
    socket.on('place_bet', async (data) => {
        try {
            const { username, side, amount } = data;
            
            if (!currentUser || currentUser !== username) {
                socket.emit('bet_error', { message: 'Authentication required' });
                return;
            }
            
            if (Date.now() > gameState.roundEndTime) {
                socket.emit('bet_error', { message: 'Betting time expired' });
                return;
            }
            
            if (amount < gameState.settings.minBet || amount > gameState.settings.maxBet) {
                socket.emit('bet_error', { message: 'Invalid bet amount' });
                return;
            }
            
            const user = await User.findOne({ username });
            if (!user || user.balance < amount) {
                socket.emit('bet_error', { message: 'Insufficient balance' });
                return;
            }
            
            const session = await mongoose.startSession();
            session.startTransaction();
            
            try {
                user.balance -= amount;
                await user.save({ session });
                
                const bet = {
                    username,
                    side,
                    amount,
                    timestamp: Date.now(),
                    socketId: socket.id
                };
                
                gameState.bets[side].push(bet);
                gameState[`total${side}`] += amount;
                gameState.totalVolume += amount;
                
                await session.commitTransaction();
                
                // Update settings for house profit and volume
                await updateStats();
                
                socket.emit('bet_success', { 
                    balance: user.balance,
                    bet: { side, amount }
                });
                
                broadcastGameState();
                broadcastAnalytics();
            } catch (error) {
                await session.abortTransaction();
                throw error;
            } finally {
                session.endSession();
            }
        } catch (error) {
            console.error('Place bet error:', error);
            socket.emit('bet_error', { message: 'Error placing bet' });
        }
    });
    
    // Admin panel
    socket.on('admin_login', async (password) => {
        if (password === 'admin123') {
            socket.emit('admin_auth_success');
            socket.emit('admin_data', {
                totalHeads: gameState.totalHeads,
                totalTails: gameState.totalTails,
                houseProfit: gameState.houseProfit,
                totalVolume: gameState.totalVolume,
                adminMode: gameState.adminMode,
                receiverUPI: gameState.settings.receiverUPI
            });
        } else {
            socket.emit('admin_auth_fail');
        }
    });
    
    // Admin: Update outcome mode
    socket.on('admin_set_mode', (mode) => {
        if (['AUTO', 'FORCE HEADS', 'FORCE TAILS'].includes(mode)) {
            gameState.adminMode = mode;
            broadcastAnalytics();
        }
    });
    
    // Admin: Update receiver UPI
    socket.on('admin_update_upi', async (upi) => {
        gameState.settings.receiverUPI = upi;
        await Setting.findOneAndUpdate(
            { key: 'receiverUPI' },
            { key: 'receiverUPI', value: upi },
            { upsert: true }
        );
        io.emit('upi_updated', upi);
    });
    
    // Admin: Modify user balance
    socket.on('admin_modify_balance', async (data) => {
        try {
            const { username, amount } = data;
            const user = await User.findOne({ username });
            if (user) {
                user.balance += amount;
                await user.save();
                
                // Update stats if it's a manual adjustment
                if (amount < 0) {
                    gameState.houseProfit += Math.abs(amount);
                    await updateStats();
                }
                
                io.emit('balance_updated', { username, balance: user.balance });
                broadcastUserList();
                broadcastAnalytics();
            }
        } catch (error) {
            console.error('Modify balance error:', error);
        }
    });
    
    // Admin: Get deposits
    socket.on('admin_get_deposits', async () => {
        const deposits = await Deposit.find({ status: 'PENDING' });
        socket.emit('admin_deposits', deposits);
    });
    
    // Admin: Approve deposit
    socket.on('admin_approve_deposit', async (depositId) => {
        try {
            const session = await mongoose.startSession();
            session.startTransaction();
            
            try {
                const deposit = await Deposit.findById(depositId).session(session);
                if (deposit && deposit.status === 'PENDING') {
                    deposit.status = 'APPROVED';
                    await deposit.save({ session });
                    
                    const user = await User.findOne({ username: deposit.username }).session(session);
                    if (user) {
                        user.balance += deposit.amount;
                        await user.save({ session });
                    }
                    
                    await session.commitTransaction();
                    
                    const updatedUser = await User.findOne({ username: deposit.username });
                    io.emit('balance_updated', { username: deposit.username, balance: updatedUser.balance });
                }
            } catch (error) {
                await session.abortTransaction();
                throw error;
            } finally {
                session.endSession();
            }
            
            const deposits = await Deposit.find({ status: 'PENDING' });
            socket.emit('admin_deposits', deposits);
            broadcastUserList();
        } catch (error) {
            console.error('Approve deposit error:', error);
        }
    });
    
    // Admin: Reject deposit
    socket.on('admin_reject_deposit', async (depositId) => {
        try {
            const deposit = await Deposit.findById(depositId);
            if (deposit) {
                deposit.status = 'REJECTED';
                await deposit.save();
            }
            
            const deposits = await Deposit.find({ status: 'PENDING' });
            socket.emit('admin_deposits', deposits);
        } catch (error) {
            console.error('Reject deposit error:', error);
        }
    });
    
    // Admin: Get withdrawals
    socket.on('admin_get_withdrawals', async () => {
        const withdrawals = await Withdrawal.find({ status: 'PENDING' });
        socket.emit('admin_withdrawals', withdrawals);
    });
    
    // Admin: Approve withdrawal
    socket.on('admin_approve_withdrawal', async (withdrawalId) => {
        try {
            const withdrawal = await Withdrawal.findById(withdrawalId);
            if (withdrawal) {
                withdrawal.status = 'APPROVED';
                await withdrawal.save();
            }
            
            const withdrawals = await Withdrawal.find({ status: 'PENDING' });
            socket.emit('admin_withdrawals', withdrawals);
        } catch (error) {
            console.error('Approve withdrawal error:', error);
        }
    });
    
    // Admin: Reject withdrawal (refund balance)
    socket.on('admin_reject_withdrawal', async (withdrawalId) => {
        try {
            const session = await mongoose.startSession();
            session.startTransaction();
            
            try {
                const withdrawal = await Withdrawal.findById(withdrawalId).session(session);
                if (withdrawal && withdrawal.status === 'PENDING') {
                    withdrawal.status = 'REJECTED';
                    await withdrawal.save({ session });
                    
                    const user = await User.findOne({ username: withdrawal.username }).session(session);
                    if (user) {
                        user.balance += withdrawal.amount;
                        await user.save({ session });
                    }
                    
                    await session.commitTransaction();
                    
                    const updatedUser = await User.findOne({ username: withdrawal.username });
                    io.emit('balance_updated', { username: withdrawal.username, balance: updatedUser.balance });
                }
            } catch (error) {
                await session.abortTransaction();
                throw error;
            } finally {
                session.endSession();
            }
            
            const withdrawals = await Withdrawal.find({ status: 'PENDING' });
            socket.emit('admin_withdrawals', withdrawals);
            broadcastUserList();
        } catch (error) {
            console.error('Reject withdrawal error:', error);
        }
    });
    
    // Get user list
    socket.on('admin_get_users', async () => {
        await broadcastUserList();
    });
    
    socket.on('disconnect', async () => {
        if (currentUser) {
            const user = await User.findOne({ username: currentUser });
            if (user) {
                user.isOnline = false;
                await user.save();
                broadcastUserList();
            }
        }
        console.log('Client disconnected:', socket.id);
    });
});

async function broadcastUserList() {
    try {
        const users = await User.find({}, { username: 1, balance: 1, isOnline: 1, createdAt: 1 });
        io.emit('user_list', users);
    } catch (error) {
        console.error('Broadcast user list error:', error);
    }
}

function broadcastGameState() {
    io.emit('game_state', {
        round: gameState.currentRound,
        roundEndTime: gameState.roundEndTime,
        totalHeads: gameState.totalHeads,
        totalTails: gameState.totalTails,
        outcome: gameState.outcome,
        bets: {
            HEADS: gameState.bets.HEADS.length,
            TAILS: gameState.bets.TAILS.length
        }
    });
}

function broadcastAnalytics() {
    const autoOutcome = calculateAutoOutcome();
    io.emit('analytics_update', {
        totalHeads: gameState.totalHeads,
        totalTails: gameState.totalTails,
        autoOutcome,
        houseProfit: gameState.houseProfit,
        totalVolume: gameState.totalVolume,
        adminMode: gameState.adminMode
    });
}

function calculateAutoOutcome() {
    if (gameState.totalHeads < gameState.totalTails) return 'HEADS';
    if (gameState.totalTails < gameState.totalHeads) return 'TAILS';
    return Math.random() < 0.5 ? 'HEADS' : 'TAILS';
}

async function updateStats() {
    try {
        await Promise.all([
            Setting.findOneAndUpdate(
                { key: 'houseProfit' },
                { key: 'houseProfit', value: gameState.houseProfit },
                { upsert: true }
            ),
            Setting.findOneAndUpdate(
                { key: 'totalVolume' },
                { key: 'totalVolume', value: gameState.totalVolume },
                { upsert: true }
            )
        ]);
    } catch (error) {
        console.error('Update stats error:', error);
    }
}

// Game Loop (30-second rounds)
async function startGameLoop() {
    gameState.roundStartTime = Date.now();
    gameState.roundEndTime = Date.now() + 30000;
    
    setInterval(async () => {
        try {
            if (Date.now() >= gameState.roundEndTime) {
                await settleRound();
                resetRound();
                broadcastGameState();
            }
        } catch (error) {
            console.error('Game loop error:', error);
        }
    }, 1000);
}

async function settleRound() {
    try {
        let outcome;
        
        // Determine outcome based on admin mode
        if (gameState.adminMode === 'FORCE HEADS') {
            outcome = 'HEADS';
        } else if (gameState.adminMode === 'FORCE TAILS') {
            outcome = 'TAILS';
        } else {
   