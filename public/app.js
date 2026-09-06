const socket = io();

// Web Audio Synthesizer
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
    [523.25, 659.25, 783.99, 1046.50].forEach((freq, idx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.1, now + idx * 0.1);
        gain.gain.linearRampToValueAtTime(0.01, now + idx * 0.1 + 0.3);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now + idx * 0.1);
        osc.stop(now + idx * 0.1 + 0.3);
    });
}

// App State
let currentUser = null;
let cumulativeRotation = 0;
let activeUpiId = '';
let logoClicks = [];

// 10-Click Secret Admin Panel Trigger Logic
document.getElementById('brandLogo').addEventListener('click', () => {
    const now = Date.now();
    logoClicks.push(now);
    logoClicks = logoClicks.filter(t => now - t < 1500);
    if (logoClicks.length >= 10) {
        logoClicks = [];
        openModal('adminModal');
    }
});

// Auto-Login Session Restoration
socket.on('connect', () => {
    const savedUser = localStorage.getItem('casino_user');
    if (savedUser) {
        try {
            const credentials = JSON.parse(savedUser);
            socket.emit('user_login', { username: credentials.username, password: credentials.password, isSignUp: false }, (res) => {
                if (res && res.success) {
                    setupUserSession(res);
                }
            });
        } catch (e) { console.error(e); }
    }
});

function handleDirectAuth(isSignUp) {
    initAudio();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    const msg = document.getElementById('authMsg');

    if (!username || !password) return msg.innerText = "Provide credentials!";

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

    socket.emit('place_bet', { side, amount }, (res) => {
        if (res.success) {
            currentUser.balance = res.newBalance;
            document.getElementById('walletBalance').innerText = `₹${currentUser.balance}`;
        } else {
            alert(res.msg);
        }
    });
}

// Timer Tick Listener
socket.on('timer_tick', (data) => {
    document.getElementById('timerDisplay').innerText = `00:${data.timer < 10 ? '0' : ''}${data.timer}`;
    document.getElementById('timerBar').style.width = `${(data.timer / 30) * 100}%`;
    document.getElementById('headsTotal').innerText = `₹${data.headsTotal}`;
    document.getElementById('tailsTotal').innerText = `₹${data.tailsTotal}`;
});

// Game Result & 3D Coin Spin Animation Logic
socket.on('game_result', (data) => {
    playSpinSound();
    
    // Continuous Rotation Calculation without Y-axis snap-backs
    let currentMod = cumulativeRotation % 360;
    let targetMod = (data.outcome === 'HEADS') ? 0 : 180;
    let diff = targetMod - currentMod;
    if (diff < 0) diff += 360;
    
    // 5 Full Turns + offset
    cumulativeRotation += (360 * 5) + diff;
    
    const coinEl = document.getElementById('coin');
    coinEl.style.transform = `rotateY(${cumulativeRotation}deg)`;

    setTimeout(() => {
        const winner = data.winners.find(w => w.username === (currentUser ? currentUser.username : ''));
        if (winner) {
            playWinSound();
            currentUser.balance += winner.amount;
            document.getElementById('walletBalance').innerText = `₹${currentUser.balance}`;
        }

        // Render History Badges
        const histEl = document.getElementById('history');
        histEl.innerHTML = data.history.map(h => 
            `<span class="px-1.5 py-0.5 rounded text-xs font-bold ${h === 'HEADS' ? 'bg-amber-500 text-slate-950' : 'bg-amber-700 text-white'}">${h[0]}</span>`
        ).join('');
    }, 3000);
});

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

        // Populate Deposits
        document.getElementById('admDepositsList').innerHTML = data.deposits.map(d => `
            <div class="flex justify-between items-center bg-slate-950 p-2 rounded">
                <span>${d.username} - ₹${d.amount} (TXN: ${d.txnId})</span>
                <div>
                    <button onclick="processDeposit('${d._id}', 'APPROVED')" class="bg-emerald-600 px-2 py-1 rounded text-xs">Approve</button>
                    <button onclick="processDeposit('${d._id}', 'REJECTED')" class="bg-red-600 px-2 py-1 rounded text-xs">Reject</button>
                </div>
            </div>
        `).join('') || '<p class="text-slate-500">No pending deposits</p>';

        // Populate Withdrawals
        document.getElementById('admWithdrawalsList').innerHTML = data.withdrawals.map(w => `
            <div class="flex justify-between items-center bg-slate-950 p-2 rounded">
                <span>${w.username} - ₹${w.amount} (UPI: ${w.upiDetails})</span>
                <div>
                    <button onclick="processWithdrawal('${w._id}', 'APPROVED')" class="bg-emerald-600 px-2 py-1 rounded text-xs">Approve</button>
                    <button onclick="processWithdrawal('${w._id}', 'REJECTED')" class="bg-red-600 px-2 py-1 rounded text-xs">Reject</button>
                </div>
            </div>
        `).join('') || '<p class="text-slate-500">No pending withdrawals</p>';

        // Populate User Management
        document.getElementById('admUsersList').innerHTML = data.users.map(u => `
            <div class="flex justify-between items-center bg-slate-950 p-2 rounded">
                <span>${u.username} (${u.isOnline ? '🟢' : '🔴'}) - ₹${u.balance}</span>
                <div class="space-x-1">
                    <button onclick="adjustUserBalance('${u.username}', 500)" class="bg-emerald-600 px-2 py-1 rounded text-xs">+500</button>
                    <button onclick="adjustUserBalance('${u.username}', -500)" class="bg-red-600 px-2 py-1 rounded text-xs">-500</button>
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
    if (!document.getElementById('adminDashboard').classList.contains('hidden')) {
        fetchAdminData();
    }
});

socket.on('upi_updated', (upi) => {
    activeUpiId = upi;
    updateQrCode();
});

// Deposit & Modal Helpers
function updateQrCode() {
    const qrDiv = document.getElementById('qrcode');
    qrDiv.innerHTML = '';
    document.getElementById('upiIdDisplay').innerText = `UPI: ${activeUpiId}`;
    if (activeUpiId) {
        new QRCode(qrDiv, {
            text: `upi://pay?pa=${activeUpiId}&pn=Casino`,
            width: 180,
            height: 180
        });
    }
}

function submitDeposit() {
    const amount = parseFloat(document.getElementById('depAmount').value);
    const txnId = document.getElementById('depTxn').value.trim();
    if (!amount || !txnId) return alert("Fill deposit details!");
    socket.emit('submit_deposit', { amount, txnId }, (res) => {
        alert(res.msg);
        closeModal('depositModal');
    });
}

function submitWithdrawal() {
    const amount = parseFloat(document.getElementById('wdAmount').value);
    const upi = document.getElementById('wdUpi').value.trim();
    if (!amount || !upi) return alert("Fill withdrawal details!");
    socket.emit('submit_withdrawal', { amount, upi }, (res) => {
        alert(res.msg);
        if (res.success) {
            currentUser.balance = res.newBalance;
            document.getElementById('walletBalance').innerText = `₹${currentUser.balance}`;
        }
        closeModal('withdrawModal');
    });
}

function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
