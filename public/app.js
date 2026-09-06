const socket = io({
    transports: ['polling', 'websocket'],
    reconnectionAttempts: 10
});

let currentUser = null;
let currentRotation = 0;
let currentAdminSecret = null;
let activeUpiId = "casino@upi";

// Web Audio Engine
let audioCtx = null;
function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
}
document.addEventListener('click', initAudio, { once: true });

function playSound(type) {
    try {
        initAudio();
        if (!audioCtx) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        const now = audioCtx.currentTime;

        if (type === 'spin') {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(300, now);
            osc.frequency.exponentialRampToValueAtTime(800, now + 0.3);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.linearRampToValueAtTime(0.01, now + 0.3);
            osc.start(now);
            osc.stop(now + 0.3);
        } else if (type === 'win') {
            const notes = [523.25, 659.25, 783.99, 1046.50];
            notes.forEach((freq, index) => {
                const nOsc = audioCtx.createOscillator();
                const nGain = audioCtx.createGain();
                nOsc.connect(nGain); nGain.connect(audioCtx.destination);
                nOsc.type = 'sine'; nOsc.frequency.value = freq;
                const start = now + (index * 0.12);
                nGain.gain.setValueAtTime(0.3, start);
                nGain.gain.exponentialRampToValueAtTime(0.001, start + 0.3);
                nOsc.start(start); nOsc.stop(start + 0.3);
            });
        } else if (type === 'lose') {
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(300, now);
            osc.frequency.exponentialRampToValueAtTime(100, now + 0.4);
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.linearRampToValueAtTime(0.01, now + 0.4);
            osc.start(now);
            osc.stop(now + 0.4);
        }
    } catch (e) { console.error("Audio error:", e); }
}

// Socket Connection Status
socket.on('connect', () => {
    const msg = document.getElementById('authMsg');
    if (msg) { msg.innerText = "Server Connected! Login to play."; msg.style.color = "#22c55e"; }
});

socket.on('connect_error', () => {
    const msg = document.getElementById('authMsg');
    if (msg) { msg.innerText = "Server waking up (10-15s)..."; msg.style.color = "#facc15"; }
});

// Authentication
window.handleDirectAuth = function(isSignUp) {
    initAudio();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    const msg = document.getElementById('authMsg');

    if (!username || !password) return msg.innerText = "Enter credentials!", msg.style.color = "#ef4444";
    msg.innerText = "Authenticating...";

    socket.emit('user_login', { username, password, isSignUp }, (res) => {
        if (res.success) {
            currentUser = res.userData;
            activeUpiId = res.adminUpi;
            document.getElementById('walletBalance').innerText = `₹${currentUser.balance}`;
            closeModal('authModal');
            updateQrCode();
        } else {
            msg.innerText = res.msg;
            msg.style.color = "#ef4444";
        }
    });
};

// Game Sync
socket.on('time_sync', (data) => {
    document.getElementById('roundIdText').innerText = `#${data.roundId}`;
    document.getElementById('countdownTimer').innerText = `${data.secondsRemaining}s`;
    document.getElementById('istTimeText').innerText = `IST Time: ${data.istTime}`;
});

socket.on('round_result', (data) => {
    playSound('spin');
    const coin = document.getElementById('coin3d');
    
    // Accumulate degrees to prevent snap-back
    currentRotation += 1800; // 5 spins
    if (data.outcome === 'TAILS') currentRotation += 180;
    
    // Correction for modulo alignment
    const targetRem = data.outcome === 'HEADS' ? 0 : 180;
    const currentRem = currentRotation % 360;
    if (currentRem !== targetRem) {
        currentRotation += (targetRem - currentRem);
    }

    coin.style.transform = `rotateY(${currentRotation}deg)`;

    setTimeout(() => {
        document.getElementById('resultText').innerText = `RESULT: ${data.outcome}`;
        document.getElementById('statusMsg').innerText = "";
        renderHistory(data.history);
    }, 1300);
});

socket.on('bet_settled', (data) => {
    currentUser = data.user;
    document.getElementById('walletBalance').innerText = `₹${data.user.balance}`;
    
    setTimeout(() => {
        if (data.isWin) {
            playSound('win');
            document.getElementById('winAmountText').innerText = `+₹${data.amountWon}`;
            document.getElementById('winOverlay').style.display = 'flex';
            setTimeout(() => document.getElementById('winOverlay').style.display = 'none', 2000);
        } else {
            playSound('lose');
        }
    }, 1300);
});

// UI Interactions
window.setBetAmount = (amt) => {
    const input = document.getElementById('betAmountInput');
    input.value = Number(input.value || 0) + amt;
};

window.placeBet = (choice) => {
    initAudio();
    if (!currentUser) return alert("Please Login!");
    const amt = Number(document.getElementById('betAmountInput').value);
    
    socket.emit('place_bet', { username: currentUser.username, choice, amount: amt }, (res) => {
        const msg = document.getElementById('statusMsg');
        msg.innerText = res.msg;
        msg.style.color = res.success ? "#22c55e" : "#ef4444";
    });
};

// Feeds & History
socket.on('live_bet_feed', (feed) => {
    const box = document.getElementById('betsFeed');
    box.innerHTML = feed.length ? feed.map(f => `<span class="feed-item">${f}</span>`).join('') : '<span class="feed-item">Waiting for bets...</span>';
});

socket.on('history_update', renderHistory);
function renderHistory(hist) {
    document.getElementById('historyChips').innerHTML = hist.map(h => `<div class="chip ${h.toLowerCase()}">${h[0]}</div>`).join('');
}

// User Sync & Notifications
socket.on('user_sync', (user) => {
    currentUser = user;
    document.getElementById('walletBalance').innerText = `₹${user.balance}`;
});

socket.on('admin_payment_notification', (data) => {
    playSound('win');
    document.getElementById('notifyTitle').innerText = data.title;
    document.getElementById('notifyMessage').innerText = data.message;
    document.getElementById('notifyOverlay').style.display = 'flex';
});

socket.on('upi_changed', (upi) => {
    activeUpiId = upi;
    updateQrCode();
});

// Deposit / Withdraw Modals
window.updateQrCode = () => {
    const amt = document.getElementById('depAmount').value || 100;
    const upiStr = `upi://pay?pa=${encodeURIComponent(activeUpiId)}&pn=Casino&am=${amt}&cu=INR`;
    document.getElementById('depositQrImage').src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(upiStr)}`;
};

document.getElementById('openDepositBtn').onclick = () => { updateQrCode(); document.getElementById('depositModal').style.display = 'flex'; };
document.getElementById('openWithdrawBtn').onclick = () => { 
    if(!currentUser) return alert("Login first"); 
    document.getElementById('withdrawModal').style.display = 'flex'; 
    fetchWithdrawals(); 
};

window.submitDeposit = () => {
    socket.emit('request_deposit', { username: currentUser.username, amount: document.getElementById('depAmount').value, txnId: document.getElementById('depTxnId').value }, res => {
        alert(res.msg); if(res.success) closeModal('depositModal');
    });
};

window.submitWithdrawal = () => {
    socket.emit('request_withdrawal', { username: currentUser.username, amount: document.getElementById('wdrAmount').value, upiDetails: document.getElementById('wdrUpi').value }, res => {
        alert(res.msg); if(res.success) fetchWithdrawals();
    });
};

function fetchWithdrawals() {
    socket.emit('get_user_withdrawals', { username: currentUser.username }, res => {
        if(res.success) {
            document.getElementById('userWithdrawalHistory').innerHTML = res.history.reverse().map(i => `<div style="display:flex; justify-content:space-between; border-bottom:1px solid #334155; padding:5px 0;"><span>₹${i.amount} <small style="color:#94a3b8">(${i.time})</small></span> <span>${i.status}</span></div>`).join('');
        }
    });
}

// Secret Admin Trigger
let tapTime = [];
document.getElementById('brandBtn').onclick = () => {
    const now = Date.now();
    tapTime.push(now);
    tapTime = tapTime.filter(t => now - t <= 1500);
    if (tapTime.length >= 10) {
        tapTime = [];
        if (currentAdminSecret) {
            socket.emit('admin_login', { adminPassword: currentAdminSecret }, res => { renderAdminPanel(res.data); document.getElementById('adminModal').style.display = 'flex'; });
        } else {
            document.getElementById('adminAuthModal').style.display = 'flex';
        }
    }
};

window.verifyAdminPassword = () => {
    const pass = document.getElementById('adminPassInput').value;
    socket.emit('admin_login', { adminPassword: pass }, res => {
        if (res.success) { currentAdminSecret = pass; closeModal('adminAuthModal'); renderAdminPanel(res.data); document.getElementById('adminModal').style.display = 'flex'; }
        else document.getElementById('adminAuthMsg').innerText = "Access Denied";
    });
};

socket.on('admin_state_update', (data) => {
    if (document.getElementById('adminModal').style.display === 'flex') renderAdminPanel(data);
});

function renderAdminPanel(data) {
    if(!data) return;
    document.getElementById('adminProfit').innerText = `₹${data.houseProfit}`;
    document.getElementById('adminVolume').innerText = `₹${data.totalVolume}`;
    
    document.getElementById('adminUsersContainer').innerHTML = data.usersList.map(u => `<div style="display:flex; justify-content:space-between; margin-bottom:5px; border-bottom:1px solid #334155; padding-bottom:5px;">
        <div><strong>${u.username}</strong> ${u.isOnline?'🟢':'🔴'}<br><small>Bal: ₹${u.balance} | Bet: ₹${u.activeBet}</small></div>
        <button class="btn btn-gold" style="padding:5px;" onclick="addCash('${u.username}')">± Cash</button>
    </div>`).join('') || "No Users";

    document.getElementById('adminDepositsContainer').innerHTML = data.deposits.map(d => `<div style="display:flex; justify-content:space-between; margin-bottom:5px; border-bottom:1px solid #334155; padding-bottom:5px;">
        <div><strong>${d.uid}</strong>: ₹${d.amount} <br><small>Txn: ${d.txnId}</small></div>
        <div>
            ${d.status === 'PENDING' ? `<button class="btn btn-green" style="padding:5px;" onclick="procDep(${d.id}, 'APPROVED')">✓</button> <button class="btn btn-red" style="padding:5px;" onclick="procDep(${d.id}, 'REJECTED')">✕</button>` : d.status}
        </div>
    </div>`).join('') || "No Deposits";

    document.getElementById('adminWithdrawalsContainer').innerHTML = data.withdrawals.map(w => `<div style="display:flex; justify-content:space-between; margin-bottom:5px; border-bottom:1px solid #334155; padding-bottom:5px;">
        <div><strong>${w.uid}</strong>: ₹${w.amount} <br><small>UPI: ${w.upiDetails}</small></div>
        <div>
            ${w.status === 'PENDING' ? `<button class="btn btn-green" style="padding:5px;" onclick="procWdr(${w.id}, 'APPROVED')">✓</button> <button class="btn btn-red" style="padding:5px;" onclick="procWdr(${w.id}, 'REJECTED')">✕</button>` : w.status}
        </div>
    </div>`).join('') || "No Withdrawals";
}

window.setAdminMode = mode => socket.emit('admin_set_mode', { adminSecret: currentAdminSecret, mode });
window.updateAdminUpi = () => socket.emit('admin_update_upi', { adminSecret: currentAdminSecret, newUpi: document.getElementById('newUpiInput').value });
window.addCash = u => { const a = prompt("Amount (+ or -):"); if(a) socket.emit('admin_modify_wallet', { adminSecret: currentAdminSecret, username: u, amount: Number(a) }); };
window.procDep = (id, action) => socket.emit('admin_process_deposit', { adminSecret: currentAdminSecret, id, action });
window.procWdr = (id, action) => socket.emit('admin_process_withdrawal', { adminSecret: currentAdminSecret, id, action });
window.closeModal = id => document.getElementById(id).style.display = 'none';
