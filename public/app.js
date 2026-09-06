const socket = io();

// Web Audio Synthesizer setup
let audioCtx = null;

function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function playSpinSound() {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(200, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 2.5);
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 2.5);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 2.5);
}

function playWinSound() {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    [523.25, 659.25, 783.99, 1046.50, 1318.51].forEach((freq, idx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.15, now + idx * 0.1);
        gain.gain.linearRampToValueAtTime(0.01, now + idx * 0.1 + 0.3);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now + idx * 0.1);
        osc.stop(now + idx * 0.1 + 0.3);
    });
}

function playLossSound() {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    [300, 250, 200, 150].forEach((freq, idx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.1, now + idx * 0.2);
        gain.gain.linearRampToValueAtTime(0.01, now + idx * 0.2 + 0.3);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now + idx * 0.2);
        osc.stop(now + idx * 0.2 + 0.3);
    });
}

// App State Variables
let currentUser = null;
let cumulativeRotation = 0;
let activeUpiId = '';
let logoClicks = [];

// User Betting State for current round
let myBetHeads = 0;
let myBetTails = 0;

// 10-Click Secret Admin Panel Trigger Logic
document.getElementById('brandLogo').addEventListener('click', () => {
    const now = Date.now();
    logoClicks.push(now);
    logoClicks = logoClicks.filter(t => now - t < 1500); // Reset if too slow
    if (logoClicks.length >= 10) {
        logoClicks = [];
        openModal('adminModal');
    }
});

// Auto-Login
socket.on('connect', () => {
    const savedUser = localStorage.getItem('casino_user');
    if (savedUser) {
        try {
            const credentials = JSON.parse(savedUser);
            socket.emit('user_login', { username: credentials.username, password: credentials.password, isSignUp: false }, (res) => {
                if (res && res.success) setupUserSession(res);
            });
        } catch (e) { console.error(e); }
    }
});

function handleDirectAuth(isSignUp) {
    initAudio();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    const msg = document.getElementById('authMsg');

    if (!username || !password) return msg.innerText = "Provide valid credentials!";

    socket.emit('user_login', { username, password, isSignUp }, (res) => {
        if (res.success) {
            localStorage.setItem('casino_user', JSON.stringify({ username, password }));
            setupUserSession(res);
            closeModal('authModal');
        } else {
            msg.innerText = res.msg;
        }
    });
}

function setupUserSession(res) {
    currentUser = res.userData;
    activeUpiId = res.adminUpi;
    document.getElementById('walletBalance').innerText = `₹${currentUser.balance}`;
    document.getElementById('authBtn').classList.add('hidden');
    document.getElementById('userState').classList.remove('hidden');
    updateQrCode();
}

function setChip(val) {
    document.getElementById('betAmount').value = val;
}

function placeBet(side) {
    initAudio();
    const amount = parseFloat(document.getElementById('betAmount').value);
    if (isNaN(amount) || amount <= 0) return alert("Enter valid bet amount!");
    if (!currentUser) return openModal('authModal');

    socket.emit('place_bet', { side, amount }, (res) => {
        if (res.success) {
            currentUser.balance = res.newBalance;
            document.getElementById('walletBalance').innerText = `₹${currentUser.balance}`;
            // Track local bets for Win/Loss animation
            if (side === 'HEADS') myBetHeads += amount;
            if (side === 'TAILS') myBetTails += amount;
        } else {
            alert(res.msg);
        }
    });
}

// Timer & Live Data updates
socket.on('timer_tick', (data) => {
    // Regular users see timer
    document.getElementById('timerDisplay').innerText = `00:${data.timer < 10 ? '0' : ''}${data.timer}`;
    document.getElementById('timerBar').style.width = `${(data.timer / 30) * 100}%`;
    
    // Only Admin UI gets updated with total bets
    const admHeads = document.getElementById('admHeadsTotal');
    const admTails = document.getElementById('admTailsTotal');
    if(admHeads) admHeads.innerText = `₹${data.headsTotal}`;
    if(admTails) admTails.innerText = `₹${data.tailsTotal}`;
});

// Game Result, 3D Spin & Win/Loss Animation
socket.on('game_result', (data) => {
    playSpinSound();
    
    // Exact Rotation Calculation to match outcome 100%
    let currentMod = cumulativeRotation % 360;
    let targetMod = (data.outcome === 'HEADS') ? 0 : 180;
    let diff = targetMod - currentMod;
    if (diff < 0) diff += 360;
    
    // Add 5 full spins (1800 deg) + exact difference to land perfectly
    cumulativeRotation += (360 * 5) + diff;
    
    const coinEl = document.getElementById('coin');
    coinEl.style.transform = `rotateY(${cumulativeRotation}deg)`;

    // Wait for animation (3 seconds) to finish before resolving logic
    setTimeout(() => {
        let winAmount = 0;
        let didUserBet = (myBetHeads > 0 || myBetTails > 0);
        
        // Find if this user won from backend data
        const winner = data.winners.find(w => w.username === (currentUser ? currentUser.username : ''));
        
        if (winner) {
            winAmount = winner.amount;
            currentUser.balance += winAmount;
            document.getElementById('walletBalance').innerText = `₹${currentUser.balance}`;
            showResultAnimation('WIN', winAmount);
            playWinSound();
        } else if (didUserBet) {
            // User bet but didn't win, meaning they lost
            let lostAmount = myBetHeads + myBetTails; 
            showResultAnimation('LOSS', lostAmount);
            playLossSound();
        }

        // Reset local bet tracking for next round
        myBetHeads = 0;
        myBetTails = 0;

        // Render History Badges on Top Bar
        const histEl = document.getElementById('history');
        if (histEl) {
            histEl.innerHTML = data.history.map(h => 
                `<span class="history-badge ${h === 'HEADS' ? 'heads' : 'tails'}">${h[0]}</span>`
            ).join('');
        }
    }, 3000);
});

// Overlay Animation Controller
function showResultAnimation(type, amount) {
    const overlay = document.getElementById('resultOverlay');
    const box = document.getElementById('resultBox');
    const title = document.getElementById('resultTitle');
    const amountText = document.getElementById('resultAmount');

    overlay.classList.remove('hidden');
    
    if (type === 'WIN') {
        title.innerText = "YOU WON!";
        title.className = "text-7xl font-black drop-shadow-2xl tracking-tight result-win";
        amountText.innerText = `+ ₹${amount}`;
        amountText.className = "text-4xl font-bold mt-4 text-emerald-400";
    } else {
        title.innerText = "YOU LOST";
        title.className = "text-7xl font-black drop-shadow-2xl tracking-tight result-loss";
        amountText.innerText = `- ₹${amount}`;
        amountText.className = "text-4xl font-bold mt-4 text-red-500";
    }

    // Pop-in effect
    setTimeout(() => box.classList.add('scale-100'), 50);

    // Auto-hide after 3 seconds
    setTimeout(() => {
        box.classList.remove('scale-100');
        setTimeout(() => overlay.classList.add('hidden'), 500);
    }, 3000);
}

// User Personal History Fetcher
function fetchUserHistory() {
    if (!currentUser) return alert("Please login first!");
    
    socket.emit('get_my_history', (res) => {
        // Fallback added: Even if backend throws error, empty array pass hoga and modal khulega
        const deposits = (res && res.deposits) ? res.deposits : [];
        const withdrawals = (res && res.withdrawals) ? res.withdrawals : [];
        
        renderUserHistory(deposits, withdrawals);
        openModal('historyModal');
    });
}

    
    // Need backend event 'get_my_history' to return user's data
    socket.emit('get_my_history', (res) => {
        if(res && res.success) {
            renderUserHistory(res.deposits, res.withdrawals);
            openModal('historyModal');
        } else {
            alert("Could not load history. Ensure backend is configured.");
        }
    });
}

function renderUserHistory(deposits, withdrawals) {
    const depTable = document.getElementById('userDepositHistory');
    const wthTable = document.getElementById('userWithdrawHistory');

    const getStatusHTML = (status) => {
        if(status === 'APPROVED') return `<span class="status-success">Approved</span>`;
        if(status === 'REJECTED') return `<span class="status-failed">Rejected</span>`;
        return `<span class="status-pending">Pending</span>`;
    };

    depTable.innerHTML = deposits.length ? deposits.map(d => `
        <tr class="border-b border-slate-800">
            <td class="py-2 text-slate-300">₹${d.amount}</td>
            <td class="py-2 text-xs text-slate-500">TXN: ${d.txnId}</td>
            <td class="py-2 text-right">${getStatusHTML(d.status)}</td>
        </tr>
    `).join('') : `<tr><td colspan="3" class="text-center text-slate-500 py-4">No deposits found</td></tr>`;

    wthTable.innerHTML = withdrawals.length ? withdrawals.map(w => `
        <tr class="border-b border-slate-800">
            <td class="py-2 text-slate-300">₹${w.amount}</td>
            <td class="py-2 text-xs text-slate-500">UPI: ${w.upiDetails}</td>
            <td class="py-2 text-right">${getStatusHTML(w.status)}</td>
        </tr>
    `).join('') : `<tr><td colspan="3" class="text-center text-slate-500 py-4">No withdrawals found</td></tr>`;
}

// Admin Control Logic
function authenticateAdmin() {
    const pass = document.getElementById('adminPass').value;
    socket.emit('admin_auth', pass, (res) => {
        if (res.success) {
            document.getElementById('adminAuthSection').classList.add('hidden');
            document.getElementById('adminDashboard').classList.remove('hidden');
            fetchAdminData();
        } else {
            alert(res.msg);
        }
    });
}

function fetchAdminData() {
    socket.emit('admin_get_data', (data) => {
        document.getElementById('admProfit').innerText = `₹${data.houseProfit}`;
        document.getElementById('admVolume').innerText = `₹${data.totalVolume}`;
        document.getElementById('admOutcomeSelect').value = data.forcedOutcome;
        document.getElementById('admUpiInput').value = data.adminUpi;

        // Pending Deposits
        document.getElementById('admDepositsList').innerHTML = data.deposits.map(d => `
            <div class="flex flex-col sm:flex-row justify-between sm:items-center bg-slate-950 p-3 rounded-lg border border-slate-800 gap-2">
                <span class="text-sm font-bold text-slate-300">${d.username} <span class="text-amber-400 ml-2">₹${d.amount}</span> <br><span class="text-xs text-slate-500 font-normal">TXN: ${d.txnId}</span></span>
                <div class="flex gap-2">
                    <button onclick="processDeposit('${d._id}', 'APPROVED')" class="bg-emerald-600 hover:bg-emerald-500 px-3 py-1 rounded text-xs font-bold text-white transition">Approve</button>
                    <button onclick="processDeposit('${d._id}', 'REJECTED')" class="bg-red-600 hover:bg-red-500 px-3 py-1 rounded text-xs font-bold text-white transition">Reject</button>
                </div>
            </div>
        `).join('') || '<p class="text-slate-500 text-sm">No pending deposits</p>';

        // Pending Withdrawals
        document.getElementById('admWithdrawalsList').innerHTML = data.withdrawals.map(w => `
            <div class="flex flex-col sm:flex-row justify-between sm:items-center bg-slate-950 p-3 rounded-lg border border-slate-800 gap-2">
                <span class="text-sm font-bold text-slate-300">${w.username} <span class="text-amber-400 ml-2">₹${w.amount}</span> <br><span class="text-xs text-slate-500 font-normal">UPI: ${w.upiDetails}</span></span>
                <div class="flex gap-2">
                    <button onclick="processWithdrawal('${w._id}', 'APPROVED')" class="bg-emerald-600 hover:bg-emerald-500 px-3 py-1 rounded text-xs font-bold text-white transition">Approve</button>
                    <button onclick="processWithdrawal('${w._id}', 'REJECTED')" class="bg-red-600 hover:bg-red-500 px-3 py-1 rounded text-xs font-bold text-white transition">Reject</button>
                </div>
            </div>
        `).join('') || '<p class="text-slate-500 text-sm">No pending withdrawals</p>';

        // User Management
        document.getElementById('admUsersList').innerHTML = data.users.map(u => `
            <div class="flex justify-between items-center bg-slate-950 p-3 rounded-lg border border-slate-800">
                <span class="text-sm font-bold text-white">${u.username} <span class="text-xs ml-1">${u.isOnline ? '🟢' : '🔴'}</span> <br><span class="text-amber-400">₹${u.balance}</span></span>
                <div class="flex gap-2">
                    <button onclick="adjustUserBalance('${u.username}', 500)" class="bg-emerald-600/20 text-emerald-400 border border-emerald-600/50 hover:bg-emerald-600 hover:text-white px-3 py-1 rounded text-xs font-bold transition">+500</button>
                    <button onclick="adjustUserBalance('${u.username}', -500)" class="bg-red-600/20 text-red-400 border border-red-600/50 hover:bg-red-600 hover:text-white px-3 py-1 rounded text-xs font-bold transition">-500</button>
                </div>
            </div>
        `).join('');
    });
}

function changeOutcomeMode(mode) { socket.emit('admin_set_outcome', mode); }
function processDeposit(id, action) { socket.emit('admin_process_deposit', { id, action }); }
function processWithdrawal(id, action) { socket.emit('admin_process_withdrawal', { id, action }); }
function adjustUserBalance(username, delta) { socket.emit('admin_update_balance', { username, delta }); }
function saveAdminUpi() {
    const newUpi = document.getElementById('admUpiInput').value.trim();
    if (newUpi) socket.emit('admin_update_upi', newUpi);
}

socket.on('admin_data_refresh', () => {
    if (!document.getElementById('adminDashboard').classList.contains('hidden')) fetchAdminData();
});

socket.on('upi_updated', (upi) => {
    activeUpiId = upi;
    updateQrCode();
});

// Deposit / Withdraw Modals
function updateQrCode() {
    const qrDiv = document.getElementById('qrcode');
    qrDiv.innerHTML = '';
    document.getElementById('upiIdDisplay').innerText = `UPI: ${activeUpiId}`;
    if (activeUpiId) {
        new QRCode(qrDiv, { text: `upi://pay?pa=${activeUpiId}&pn=Casino`, width: 190, height: 190 });
    }
}

function submitDeposit() {
    const amount = parseFloat(document.getElementById('depAmount').value);
    const txnId = document.getElementById('depTxn').value.trim();
    if (!amount || !txnId) return alert("Fill deposit details completely!");
    socket.emit('submit_deposit', { amount, txnId }, (res) => {
        alert(res.msg);
        if(res.success) closeModal('depositModal');
    });
}

function submitWithdrawal() {
    const amount = parseFloat(document.getElementById('wdAmount').value);
    const upi = document.getElementById('wdUpi').value.trim();
    if (!amount || !upi) return alert("Fill withdrawal details completely!");
    socket.emit('submit_withdrawal', { amount, upi }, (res) => {
        alert(res.msg);
        if (res.success) {
            currentUser.balance = res.newBalance;
            document.getElementById('walletBalance').innerText = `₹${currentUser.balance}`;
            closeModal('withdrawModal');
        }
    });
}

// Global Modal Handlers
function openModal(id) { 
    document.getElementById(id).classList.remove('hidden'); 
    document.getElementById(id).classList.add('flex'); 
}
function closeModal(id) { 
    document.getElementById(id).classList.add('hidden'); 
    document.getElementById(id).classList.remove('flex'); 
}
