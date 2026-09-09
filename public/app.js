const socket = io();
let currentChip = 100;
let currentUser = localStorage.getItem('username') || null;

// --- INITIAL LOAD & PERSISTENT LOGIN ---
window.onload = () => {
    if (currentUser) {
        socket.emit('user_reconnect', currentUser, (res) => {
            if (res.success) {
                loginUIUpdate(currentUser, res.balance, res.adminUpi);
            } else {
                logout(); // Session invalid
            }
        });
    }
};

// --- TOAST NOTIFICATIONS ---
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast-anim p-4 rounded-lg shadow-lg font-bold text-white flex items-center min-w-[250px] ${
        type === 'success' ? 'bg-emerald-600' : type === 'error' ? 'bg-red-600' : 'bg-slate-700'
    }`;
    toast.innerHTML = `<span>${message}</span>`;
    
    container.appendChild(toast);
    setTimeout(() => { toast.remove(); }, 3500);
}

// --- UTILS ---
function setChip(amount) {
    currentChip = amount;
    document.getElementById('betAmount').value = amount;
}
function openModal(id) {
    document.getElementById(id).classList.remove('hidden');
    if (id === 'historyModal') fetchUserHistory();
}
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

// --- AUTHENTICATION ---
function handleDirectAuth(isSignUp) {
    const userStr = document.getElementById('loginUsername').value.trim();
    const pass = document.getElementById('loginPassword').value.trim();
    
    if (!userStr || !pass) return document.getElementById('authMsg').innerText = "Enter details";

    socket.emit('user_login', { username: userStr, password: pass, isSignUp }, (res) => {
        if (res.success) {
            currentUser = userStr;
            localStorage.setItem('username', userStr); // Persistent
            loginUIUpdate(userStr, res.balance, res.adminUpi);
            closeModal('authModal');
            showToast(`Welcome ${userStr}!`, 'success');
        } else {
            document.getElementById('authMsg').innerText = res.msg;
        }
    });
}

function loginUIUpdate(username, balance, upi) {
    document.getElementById('walletBalance').innerText = `₹${balance}`;
    document.getElementById('authBtn').classList.add('hidden');
    document.getElementById('userState').classList.remove('hidden');
    document.getElementById('userState').classList.add('flex');
    if (upi) setupQrCode(upi);
}

function logout() {
    localStorage.removeItem('username');
    location.reload(); // Refresh page to clear state completely
}

function setupQrCode(upiId) {
    const upiStr = `upi://pay?pa=${upiId}&pn=COIN3D%20Casino&cu=INR`;
    document.getElementById('upiIdDisplay').innerText = `UPI: ${upiId}`;
    document.getElementById('qrcode').innerHTML = "";
    new QRCode(document.getElementById('qrcode'), { text: upiStr, width: 160, height: 160 });
}

// --- GAME ACTIONS ---
function placeBet(side) {
    if (!currentUser) return openModal('authModal');
    
    const amount = parseInt(document.getElementById('betAmount').value);
    socket.emit('place_bet', { username: currentUser, side, amount }, (res) => {
        if (res.success) {
            document.getElementById('walletBalance').innerText = `₹${res.newBalance}`;
            showToast(`Bet ₹${amount} on ${side} placed!`, 'info');
        } else {
            showToast(res.msg, 'error');
        }
    });
}

function submitDeposit() {
    const amount = parseInt(document.getElementById('depAmount').value);
    const txnId = document.getElementById('depTxn').value;
    socket.emit('submit_deposit', { username: currentUser, amount, txnId }, (res) => {
        showToast(res.msg, res.success ? 'success' : 'error');
        if(res.success) closeModal('depositModal');
    });
}

function submitWithdrawal() {
    const amount = parseInt(document.getElementById('wdAmount').value);
    const upi = document.getElementById('wdUpi').value;
    socket.emit('submit_withdrawal', { username: currentUser, amount, upi }, (res) => {
        showToast(res.msg, res.success ? 'success' : 'error');
        if(res.success) {
            document.getElementById('walletBalance').innerText = `₹${res.newBalance}`;
            closeModal('withdrawModal');
        }
    });
}

function fetchUserHistory() {
    socket.emit('get_user_history', currentUser, (res) => {
        if (res.success) {
            // Bets History
            document.getElementById('userBetHistory').innerHTML = res.bets.map(b => `
                <tr class="border-b border-slate-700">
                    <td class="p-2">${b.side}</td><td class="p-2">₹${b.amount}</td>
                    <td class="p-2 status-${b.result.toLowerCase()}">${b.result}</td>
                    <td class="p-2">₹${b.payout}</td>
                </tr>
            `).join('');

            // Txn History (Shortened for brevity)
            document.getElementById('userDepositHistory').innerHTML = res.deposits.map(d => `<tr><td>₹${d.amount}</td><td class="status-${d.status.toLowerCase()}">${d.status}</td></tr>`).join('');
            document.getElementById('userWithdrawHistory').innerHTML = res.withdrawals.map(w => `<tr><td>₹${w.amount}</td><td class="status-${w.status.toLowerCase()}">${w.status}</td></tr>`).join('');
        }
    });
}

// --- SOCKET EVENTS & ANIMATIONS ---
socket.on('timer_tick', (data) => {
    document.getElementById('timerDisplay').innerText = `00:${data.timer < 10 ? '0' : ''}${data.timer}`;
    document.getElementById('timerBar').style.width = `${(data.timer / 30) * 100}%`;

    // Reset coin animation logic slightly if timer restarts
    if(data.timer === 30) {
        document.getElementById('coin').style.transition = 'none';
        document.getElementById('coin').style.transform = 'rotateY(0deg)'; // reset instantly before next spin
    }
});

// Personal Win/Loss Alert
socket.on('personal_result', (data) => {
    if(data.isWin) {
        showToast(`🎉 You Won ₹${data.amount}!`, 'success');
        let currentBal = parseFloat(document.getElementById('walletBalance').innerText.replace('₹', ''));
        document.getElementById('walletBalance').innerText = `₹${currentBal + data.amount}`;
    } else {
        showToast(`❌ You Lost your bet.`, 'error');
    }
});

// Main Game Result & Animation
let spinCount = 0;
socket.on('game_result', (data) => {
    // History strip update
    document.getElementById('history').innerHTML = data.history.map(h => `
        <div class="history-badge ${h.toLowerCase()}">${h[0]}</div>
    `).join('');

    // 3D Coin Spin Animation (Spins 5 times + result)
    spinCount += 5; // Multiplier for extra spins
    const baseRotation = spinCount * 360; 
    const finalRotation = data.outcome === 'HEADS' ? baseRotation : baseRotation + 180;
    
    const coin = document.getElementById('coin');
    coin.style.transition = 'transform 3s cubic-bezier(0.2, 0.8, 0.2, 1)';
    coin.style.transform = `rotateY(${finalRotation}deg)`;
});

// --- ADMIN PANEL SYSTEM ---
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault(); openModal('adminModal');
    }
});

function authenticateAdmin() {
    socket.emit('admin_auth', document.getElementById('adminPass').value, (res) => {
        if(res.success) {
            document.getElementById('adminAuthSection').classList.add('hidden');
            document.getElementById('adminDashboard').classList.remove('hidden');
            loadAdminData();
        } else showToast(res.msg, 'error');
    });
}

function loadAdminData() { socket.emit('admin_get_data', renderAdminData); }
socket.on('admin_data_refresh', loadAdminData);

// Admin real-time pool listener
socket.on('admin_live_bets', (data) => {
    const h = document.getElementById('admHeadsPool');
    const t = document.getElementById('admTailsPool');
    if(h) h.innerText = `₹${data.heads}`;
    if(t) t.innerText = `₹${data.tails}`;
});

function renderAdminData(data) {
    document.getElementById('admProfit').innerText = `₹${data.houseProfit}`;
    document.getElementById('admVolume').innerText = `₹${data.totalVolume}`;
    document.getElementById('admOutcomeSelect').value = data.forcedOutcome;
    
    document.getElementById('admHeadsPool').innerText = `₹${data.livePool.heads}`;
    document.getElementById('admTailsPool').innerText = `₹${data.livePool.tails}`;

    document.getElementById('admDepositsList').innerHTML = data.deposits.map(d => `
        <div class="bg-slate-800 p-2 text-sm rounded flex justify-between">
            <span><b>${d.username}</b>: ₹${d.amount}</span>
            <div>
                <button onclick="socket.emit('admin_process_deposit', {id:'${d._id}', action:'APPROVED'})" class="bg-green-600 px-2 rounded">✓</button>
                <button onclick="socket.emit('admin_process_deposit', {id:'${d._id}', action:'REJECTED'})" class="bg-red-600 px-2 rounded">✖</button>
            </div>
        </div>
    `).join('');

    document.getElementById('admWithdrawalsList').innerHTML = data.withdrawals.map(w => `
        <div class="bg-slate-800 p-2 text-sm rounded flex justify-between">
            <span><b>${w.username}</b>: ₹${w.amount}</span>
            <div>
                <button onclick="socket.emit('admin_process_withdrawal', {id:'${w._id}', action:'APPROVED'})" class="bg-green-600 px-2 rounded">✓</button>
                <button onclick="socket.emit('admin_process_withdrawal', {id:'${w._id}', action:'REJECTED'})" class="bg-red-600 px-2 rounded">✖</button>
            </div>
        </div>
    `).join('');
}

function changeOutcomeMode(mode) { socket.emit('admin_set_outcome', mode); }
