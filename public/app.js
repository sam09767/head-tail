// Automatic domain detection (Render & local host handling)
const socket = io({
    transports: ['polling', 'websocket'],
    upgrade: true,
    rememberUpgrade: false,
    timeout: 20000,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000
});
socket.on('connect', () => {
    console.log('SOCKET CONNECTED:', socket.id);
});

socket.on('connect_error', (error) => {
    console.log('SOCKET CONNECT ERROR:', error.message);
});

socket.on('disconnect', (reason) => {
    console.log('SOCKET DISCONNECTED:', reason);
});

let currentUser = null;
let currentRotation = 0;
let currentAdminSecret = null;
let activeUpiId = "ishaquehaque107@okaxis";

// WEB AUDIO SYNTHESIZER SOUND ENGINE
let audioCtx = null;

function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

document.addEventListener('click', () => {
    initAudio();
}, { once: true });

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
                const noteOsc = audioCtx.createOscillator();
                const noteGain = audioCtx.createGain();
                noteOsc.connect(noteGain);
                noteGain.connect(audioCtx.destination);
                
                noteOsc.type = 'sine';
                noteOsc.frequency.value = freq;
                
                const startTime = now + (index * 0.12);
                noteGain.gain.setValueAtTime(0.3, startTime);
                noteGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.3);
                
                noteOsc.start(startTime);
                noteOsc.stop(startTime + 0.3);
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
    } catch (e) {
        console.log("Audio play error:", e);
    }
}

socket.on('connect', () => {
    console.log("Connected to Render Server! ID:", socket.id);
    const msgBox = document.getElementById('authMsg');
    if (msgBox) {
        msgBox.innerText = "Server Connected! Direct login karein."; // CHANGED
        msgBox.style.color = "#22c55e";
    }
});

socket.on('connect_error', (err) => {
    console.error("Socket Error:", err);
    const msgBox = document.getElementById('authMsg');
    if (msgBox) {
        msgBox.innerText = "Server waking up... 10-15 sec wait karein!";
        msgBox.style.color = "#ef4444";
    }
});

// DIRECT LOGIN/SIGNUP FUNCTION (No OTP)
window.handleDirectAuth = function(isSignUp) {
    initAudio();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    const msgBox = document.getElementById('authMsg');

    if (!username || !password) {
        if (msgBox) {
            msgBox.innerText = "Username aur Password dono zaroori hain!";
            msgBox.style.color = "#ef4444";
        }
        return;
    }

    if (!socket.connected) {
        if (msgBox) {
            msgBox.innerText = "Server connecting... 5 sec wait karein!";
            msgBox.style.color = "#facc15";
        }
        return;
    }

    if (msgBox) {
        msgBox.innerText = isSignUp ? "Account ban raha hai..." : "Login ho raha hai...";
        msgBox.style.color = "#facc15";
    }

    socket.emit('user_login', { username, password, isSignUp }, (res) => {
        if (res && res.success) {
            if (msgBox) {
                msgBox.innerText = "Success!";
                msgBox.style.color = "#22c55e";
            }
            onLoginSuccess(res.userData, res.adminUpi, username, password);
        } else {
            if (msgBox) {
                msgBox.innerText = (res && res.msg) ? res.msg : "Login Error!";
                msgBox.style.color = "#ef4444";
            }
        }
    });
};

function onLoginSuccess(userData, adminUpi, username, password) {
    currentUser = userData;
    activeUpiId = adminUpi;
    localStorage.setItem('coin_app_user', JSON.stringify({ username, password }));
    
    const authModal = document.getElementById('authModal');
    if (authModal) authModal.style.setProperty('display', 'none', 'important');

    const balEl = document.getElementById('walletBalance');
    if (balEl) balEl.innerText = `₹${userData.balance}`;
    
    updateQrCode();
}

// Timer & IST Sync
socket.on('time_sync', (data) => {
    const roundEl = document.getElementById('roundIdText');
    const timerEl = document.getElementById('countdownTimer');
    const istEl = document.getElementById('istTimeText');
    
    if (roundEl) roundEl.innerText = `#${data.roundId}`;
    if (timerEl) timerEl.innerText = `${data.secondsRemaining}s`;
    if (istEl) istEl.innerText = `IST Time: ${data.istTime}`;
});

// Coin Spin Animation + Spin Sound
socket.on('round_result', (data) => {
    const coin = document.getElementById('coin3d');
    playSound('spin');

    currentRotation += 1800;
    if (data.outcome === 'TAILS') {
        currentRotation += 180;
    }
    
    if (currentRotation % 360 !== (data.outcome === 'HEADS' ? 0 : 180)) {
        currentRotation += (data.outcome === 'HEADS' ? 0 : 180) - (currentRotation % 360);
    }

    if (coin) coin.style.transform = `rotateY(${currentRotation}deg)`;

    setTimeout(() => {
        const resText = document.getElementById('resultText');
        if (resText) resText.innerText = `RESULT: ${data.outcome}`;
        const stMsg = document.getElementById('statusMsg');
        if (stMsg) stMsg.innerText = "";
    }, 1300);

    renderHistory(data.history);
});

// Settlement Event
socket.on('bet_settled', (data) => {
    currentUser = data.user;
    const balEl = document.getElementById('walletBalance');
    if (balEl) balEl.innerText = `₹${data.user.balance}`;

    setTimeout(() => {
        if (data.isWin) {
            playSound('win');
            const winText = document.getElementById('winAmountText');
            if (winText) winText.innerText = `+₹${data.amountWon}`;
            const winOverlay = document.getElementById('winOverlay');
            if (winOverlay) winOverlay.style.display = 'flex';
        } else {
            playSound('lose');
        }
    }, 1300);
});

socket.on('admin_payment_notification', (data) => {
    playSound('win');
    const title = document.getElementById('notifyTitle');
    const msg = document.getElementById('notifyMessage');
    const overlay = document.getElementById('notifyOverlay');
    if (title) title.innerText = data.title;
    if (msg) msg.innerText = data.message;
    if (overlay) overlay.style.display = 'flex';
});

socket.on('user_sync', (user) => {
    currentUser = user;
    const balEl = document.getElementById('walletBalance');
    if (balEl) balEl.innerText = `₹${user.balance}`;
});

socket.on('upi_changed', (upi) => {
    activeUpiId = upi;
    updateQrCode();
});

socket.on('live_bet_feed', (feed) => {
    const feedBox = document.getElementById('betsFeed');
    if (!feedBox) return;
    if (!feed || feed.length === 0) {
        feedBox.innerHTML = `<div class="feed-item">Waiting for bets...</div>`;
    } else {
        feedBox.innerHTML = feed.map(f => `<div class="feed-item">${f}</div>`).join('');
    }
});

socket.on('history_update', renderHistory);

function renderHistory(hist) {
    const container = document.getElementById('historyChips');
    if (!container || !hist) return;
    container.innerHTML = hist.map(h => `<div class="chip ${h.toLowerCase()}">${h[0]}</div>`).join('');
}

window.setBetAmount = function(amt) {
    const input = document.getElementById('betAmountInput');
    if (input) input.value = Number(input.value || 0) + amt;
};

window.placeBet = function(choice) {
    initAudio();
    if (!currentUser) return alert("Pehle login karein!");
    const amt = Number(document.getElementById('betAmountInput').value);
    
    socket.emit('place_bet', { username: currentUser.username, choice, amount: amt }, (res) => {
        const msg = document.getElementById('statusMsg');
        if (msg) {
            msg.innerText = res.msg;
            msg.style.color = res.success ? "#22c55e" : "#ef4444";
        }
    });
};

function updateQrCode() {
    const amtEl = document.getElementById('depAmount');
    const amt = amtEl ? amtEl.value || 100 : 100;
    const qrImg = document.getElementById('depositQrImage');
    const upiString = `upi://pay?pa=${encodeURIComponent(activeUpiId)}&pn=Casino&am=${amt}&cu=INR`;
    
    if (qrImg) {
        qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(upiString)}`;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const depBtn = document.getElementById('openDepositBtn');
    if (depBtn) {
        depBtn.addEventListener('click', () => {
            updateQrCode();
            document.getElementById('depositModal').style.display = 'flex';
        });
    }

    const wdrBtn = document.getElementById('openWithdrawBtn');
    if (wdrBtn) {
        wdrBtn.addEventListener('click', () => {
            if (!currentUser) return alert("Pehle login karein!");
            document.getElementById('withdrawModal').style.display = 'flex';
            fetchUserWithdrawalHistory();
        });
    }

    // SECRET ADMIN TRIGGER: 10 TAPS IN 1.5 SECONDS
    let logoTapTimestamps = [];
    const brandBtn = document.getElementById('brandBtn');
    if (brandBtn) {
        brandBtn.addEventListener('click', () => {
            const now = Date.now();
            logoTapTimestamps.push(now);
            logoTapTimestamps = logoTapTimestamps.filter(timestamp => now - timestamp <= 1500);

            if (logoTapTimestamps.length >= 10) {
                logoTapTimestamps = [];

                if (currentAdminSecret) {
                    socket.emit('get_admin_data', { adminSecret: currentAdminSecret }, (data) => {
                        renderAdminPanel(data);
                        document.getElementById('adminModal').style.display = 'flex';
                    });
                } else {
                    document.getElementById('adminPassInput').value = "";
                    document.getElementById('adminAuthMsg').innerText = "";
                    document.getElementById('adminAuthModal').style.display = 'flex';
                }
            }
        });
    }
});

window.submitDeposit = function() {
    const amt = document.getElementById('depAmount').value;
    const txn = document.getElementById('depTxnId').value;

    socket.emit('request_deposit', { username: currentUser.username, amount: amt, txnId: txn }, (res) => {
        alert(res.msg);
        if (res.success) closeModal('depositModal');
    });
};

function fetchUserWithdrawalHistory() {
    if (!currentUser) return;
    const container = document.getElementById('userWithdrawalHistory');
    if (!container) return;
    container.innerHTML = `<p style="text-align:center; color:#64748b; font-size:0.8rem;">Loading...</p>`;

    socket.emit('get_user_withdrawals', { username: currentUser.username }, (res) => {
        if (res && res.success && res.history.length > 0) {
            container.innerHTML = res.history.reverse().map(item => `
                <div class="history-item">
                    <div>
                        <strong>₹${item.amount}</strong><br>
                        <small style="color:#94a3b8">${item.time}</small>
                    </div>
                    <div>
                        <span class="badge-${item.status.toLowerCase()}">${item.status}</span>
                    </div>
                </div>
            `).join('');
        } else {
            container.innerHTML = `<p style="text-align:center; color:#64748b; font-size:0.8rem;">Koi withdrawal history nahi hai.</p>`;
        }
    });
}

window.submitWithdrawal = function() {
    const amt = document.getElementById('wdrAmount').value;
    const upi = document.getElementById('wdrUpi').value;

    socket.emit('request_withdrawal', { username: currentUser.username, amount: amt, upiDetails: upi }, (res) => {
        alert(res.msg);
        if (res.success) {
            fetchUserWithdrawalHistory();
        }
    });
};

window.verifyAdminPassword = function() {
    const pass = document.getElementById('adminPassInput').value;
    const msgBox = document.getElementById('adminAuthMsg');

    socket.emit('admin_login', { adminPassword: pass }, (res) => {
        if (res && res.success) {
            currentAdminSecret = pass;
            closeModal('adminAuthModal');
            renderAdminPanel(res.data);
            document.getElementById('adminModal').style.display = 'flex';
        } else {
            if (msgBox) {
                msgBox.innerText = (res && res.msg) ? res.msg : "Incorrect Password!";
                msgBox.style.color = "#ef4444";
            }
        }
    });
};

socket.on('admin_state_update', (data) => {
    if (document.getElementById('adminModal').style.display === 'flex' && currentAdminSecret) {
        renderAdminPanel(data);
    }
});

function renderAdminPanel(data) {
    if (!data) return;
    document.getElementById('adminProfit').innerText = `₹${data.houseProfit}`;
    document.getElementById('adminVolume').innerText = `₹${data.totalVolume}`;

    let uHTML = "";
    if (data.usersList) {
        data.usersList.forEach(u => {
            uHTML += `
                <div class="admin-dep-item">
                    <div>
                        <strong>${u.username}</strong> ${u.isOnline ? '🟢' : '🔴'}<br>
                        <small>Bal: ₹${u.balance} | Bet: ${u.activeBet}</small>
                    </div>
                    <button class="btn-approve" onclick="addMoney('${u.username}')">+ Cash</button>
                </div>
            `;
        });
    }
    document.getElementById('adminUsersContainer').innerHTML = uHTML || "No Users";

    let dHTML = "";
    if (data.deposits) {
        data.deposits.forEach(d => {
            dHTML += `
                <div class="admin-dep-item">
                    <div>
                        <strong>${d.uid}</strong>: ₹${d.amount}<br>
                        <small>Txn: ${d.txnId}</small>
                    </div>
                    <div>
                        <button class="btn-approve" onclick="processDep(${d.id}, 'APPROVED')">✓</button>
                        <button class="btn-reject" onclick="processDep(${d.id}, 'REJECTED')">✕</button>
                    </div>
                </div>
            `;
        });
    }
    document.getElementById('adminDepositsContainer').innerHTML = dHTML || "No Pending Deposits";

    let wHTML = "";
    if (data.withdrawals) {
        data.withdrawals.forEach(w => {
            wHTML += `
                <div class="admin-dep-item">
                    <div>
                        <strong>${w.uid}</strong>: ₹${w.amount}<br>
                        <small>UPI: ${w.upiDetails}</small>
                    </div>
                    <div>
                        <button class="btn-approve" onclick="processWdr(${w.id}, 'APPROVED')">✓ Pay</button>
                        <button class="btn-reject" onclick="processWdr(${w.id}, 'REJECTED')">✕ Reject</button>
                    </div>
                </div>
            `;
        });
    }
    document.getElementById('adminWithdrawalsContainer').innerHTML = wHTML || "No Pending Withdrawals";
}

window.setAdminMode = function(mode) {
    socket.emit('admin_set_mode', { adminSecret: currentAdminSecret, mode });
};

window.updateAdminUpi = function() {
    const upi = document.getElementById('newUpiInput').value;
    socket.emit('admin_update_upi', { adminSecret: currentAdminSecret, newUpi: upi });
};

window.processDep = function(id, action) {
    socket.emit('admin_process_deposit', { adminSecret: currentAdminSecret, id, action });
};

window.processWdr = function(id, action) {
    socket.emit('admin_process_withdrawal', { adminSecret: currentAdminSecret, id, action });
};

window.addMoney = function(username) {
    const amt = prompt(`${username} ke wallet me kitne paise jodna/ghatana chahte hain? (e.g. 500 ya -200)`);
    if (amt) {
        socket.emit('admin_modify_wallet', { adminSecret: currentAdminSecret, username, amount: Number(amt) });
    }
};

window.closeModal = function(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
};

