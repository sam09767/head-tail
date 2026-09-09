const socket = io();

let currentChip = 100;
let userAuthenticated = false;

// Set Chip Amount
function setChip(amount) {
    currentChip = amount;
    document.getElementById('betAmount').value = amount;
}

// Modal Handlers
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('hidden');
    
    // Agar history khul rahi hai toh data fetch karo
    if (modalId === 'historyModal') {
        fetchUserHistory();
    }
    // Agar admin modal khul raha hai toh reset view
    if (modalId === 'adminModal') {
        document.getElementById('adminAuthSection').classList.remove('hidden');
        document.getElementById('adminDashboard').classList.add('hidden');
        document.getElementById('adminPass').value = '';
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('hidden');
}

// Keyboard shortcut for Admin Panel (Ctrl + Shift + A)
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        openModal('adminModal');
    }
});

// Authentication (Login / Sign Up)
function handleDirectAuth(isSignUp) {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    const msgEl = document.getElementById('authMsg');

    if (!username || !password) {
        msgEl.innerText = "Please enter username and password";
        return;
    }

    socket.emit('user_login', { username, password, isSignUp }, (response) => {
        if (response.success) {
            userAuthenticated = true;
            document.getElementById('walletBalance').innerText = `₹${response.userData.balance}`;
            document.getElementById('userState').classList.remove('hidden');
            document.getElementById('userState').classList.add('flex');
            document.getElementById('authBtn').classList.add('hidden');
            closeModal('authModal');
            msgEl.innerText = "";
            
            // Set QR Code if available
            if (response.adminUpi) {
                setupQrCode(response.adminUpi);
            }
        } else {
            msgEl.innerText = response.msg;
        }
    });
}

// Setup QR Code for Deposit
function setupQrCode(upiId) {
    const upiString = `upi://pay?pa=${upiId}&pn=COIN3D%20Casino&cu=INR`;
    document.getElementById('upiIdDisplay').innerText = `UPI: ${upiId}`;
    const qrContainer = document.getElementById('qrcode');
    qrContainer.innerHTML = "";
    new QRCode(qrContainer, {
        text: upiString,
        width: 180,
        height: 180,
    });
}

// Place Bet
function placeBet(side) {
    if (!userAuthenticated) {
        openModal('authModal');
        return;
    }
    const amount = parseInt(document.getElementById('betAmount').value);
    if (isNaN(amount) || amount <= 0) {
        alert("Please enter a valid bet amount");
        return;
    }

    socket.emit('place_bet', { side, amount }, (response) => {
        if (response.success) {
            document.getElementById('walletBalance').innerText = `₹${response.newBalance}`;
        } else {
            alert(response.msg);
        }
    });
}

// Submit Deposit Request
function submitDeposit() {
    const amount = parseInt(document.getElementById('depAmount').value);
    const txnId = document.getElementById('depTxn').value.trim();

    if (isNaN(amount) || amount <= 0 || !txnId) {
        alert("Enter valid amount and transaction ID");
        return;
    }

    socket.emit('submit_deposit', { amount, txnId }, (response) => {
        alert(response.msg);
        if (response.success) {
            document.getElementById('depAmount').value = '';
            document.getElementById('depTxn').value = '';
            closeModal('depositModal');
        }
    });
}

// Submit Withdrawal Request
function submitWithdrawal() {
    const amount = parseInt(document.getElementById('depAmount')?.value || document.getElementById('wdAmount').value);
    const upi = document.getElementById('wdUpi').value.trim();

    if (isNaN(amount) || amount <= 0 || !upi) {
        alert("Enter valid amount and UPI ID");
        return;
    }

    socket.emit('submit_withdrawal', { amount, upi }, (response) => {
        alert(response.msg);
        if (response.success) {
            document.getElementById('walletBalance').innerText = `₹${response.newBalance}`;
            document.getElementById('wdAmount').value = '';
            document.getElementById('wdUpi').value = '';
            closeModal('withdrawModal');
        }
    });
}

// Fetch User History (Deposit & Withdrawal)
function fetchUserHistory() {
    socket.emit('get_user_history', (response) => {
        if (response.success) {
            const depositTable = document.getElementById('userDepositHistory');
            const withdrawTable = document.getElementById('userWithdrawHistory');
            
            depositTable.innerHTML = response.deposits.length ? response.deposits.map(d => `
                <tr>
                    <td>₹${d.amount}</td>
                    <td class="status-${d.status.toLowerCase()}">${d.status}</td>
                    <td>${new Date(d.createdAt).toLocaleDateString()}</td>
                </tr>
            `).join('') : `<tr><td colspan="3" class="text-center text-slate-500 py-2">No deposits yet</td></tr>`;

            withdrawTable.innerHTML = response.withdrawals.length ? response.withdrawals.map(w => `
                <tr>
                    <td>₹${w.amount}</td>
                    <td class="status-${w.status.toLowerCase()}">${w.status}</td>
                    <td>${new Date(w.createdAt).toLocaleDateString()}</td>
                </tr>
            `).join('') : `<tr><td colspan="3" class="text-center text-slate-500 py-2">No withdrawals yet</td></tr>`;
        }
    });
}

// Admin Authentication & Dashboard
function authenticateAdmin() {
    const pass = document.getElementById('adminPass').value;
    socket.emit('admin_auth', pass, (res) => {
        if (res.success) {
            document.getElementById('adminAuthSection').classList.add('hidden');
            document.getElementById('adminDashboard').classList.remove('hidden');
            loadAdminData();
        } else {
            alert(res.msg);
        }
    });
}

function loadAdminData() {
    socket.emit('admin_get_data', (data) => {
        document.getElementById('admProfit').innerText = `₹${data.houseProfit}`;
        document.getElementById('admVolume').innerText = `₹${data.totalVolume}`;
        document.getElementById('admUpiInput').value = data.adminUpi;
        document.getElementById('admOutcomeSelect').value = data.forcedOutcome;

        // Render Deposits
        document.getElementById('admDepositsList').innerHTML = data.deposits.length ? data.deposits.map(d => `
            <div class="bg-slate-900 p-3 rounded flex justify-between items-center text-sm">
                <div><b>${d.username}</b>: ₹${d.amount}<br><span class="text-xs text-slate-400">UTR: ${d.txnId}</span></div>
                <div class="space-x-2">
                    <button onclick="processDeposit('${d.id || d._id}', 'APPROVED')" class="bg-emerald-600 px-2 py-1 rounded text-xs font-bold">Approve</button>
                    <button onclick="processDeposit('${d.id || d._id}', 'REJECTED')" class="bg-red-600 px-2 py-1 rounded text-xs font-bold">Reject</button>
                </div>
            </div>
        `).join('') : '<p class="text-xs text-slate-500">No pending deposits</p>';

        // Render Withdrawals
        document.getElementById('admWithdrawalsList').innerHTML = data.withdrawals.length ? data.withdrawals.map(w => `
            <div class="bg-slate-900 p-3 rounded flex justify-between items-center text-sm">
                <div><b>${w.username}</b>: ₹${w.amount}<br><span class="text-xs text-slate-400">UPI: ${w.upiDetails}</span></div>
                <div class="space-x-2">
                    <button onclick="processWithdrawal('${w.id || w._id}', 'APPROVED')" class="bg-emerald-600 px-2 py-1 rounded text-xs font-bold">Approve</button>
                    <button onclick="processWithdrawal('${w.id || w._id}', 'REJECTED')" class="bg-red-600 px-2 py-1 rounded text-xs font-bold">Reject</button>
                </div>
            </div>
        `).join('') : '<p class="text-xs text-slate-500">No pending withdrawals</p>';

        // Render Users
        document.getElementById('admUsersList').innerHTML = data.users.map(u => `
            <div class="bg-slate-900 p-3 rounded flex justify-between items-center text-sm">
                <div><b>${u.username}</b> - Bal: <span class="text-amber-400">₹${u.balance}</span></div>
                <div class="space-x-2">
                    <button onclick="updateUserBal('${u.username}', 100)" class="bg-blue-600 px-2 py-1 rounded text-xs">+₹100</button>
                    <button onclick="updateUserBal('${u.username}', -100)" class="bg-orange-600 px-2 py-1 rounded text-xs">-₹100</button>
                </div>
            </div>
        `).join('');
    });
}

function processDeposit(id, action) {
    socket.emit('admin_process_deposit', { id, action });
}

function processWithdrawal(id, action) {
    socket.emit('admin_process_withdrawal', { id, action });
}

function updateUserBal(username, delta) {
    socket.emit('admin_update_balance', { username, delta });
}

function saveAdminUpi() {
    const newUpi = document.getElementById('admUpiInput').value.trim();
    if (newUpi) {
        socket.emit('admin_update_upi', newUpi);
        alert("UPI Updated Successfully");
    }
}

function changeOutcomeMode(mode) {
    socket.emit('admin_set_outcome', mode);
}

// Realtime Listeners from Socket
socket.on('timer_tick', (data) => {
    document.getElementById('timerDisplay').innerText = `00:${data.timer < 10 ? '0' : ''}${data.timer}`;
    const progress = (data.timer / 30) * 100;
    document.getElementById('timerBar').style.width = `${progress}%`;
});

socket.on('game_result', (data) => {
    document.getElementById('history').innerHTML = data.history.map(h => `
        <div class="history-badge ${h.toLowerCase()}">${h[0]}</div>
    `).join('');

    const coin = document.getElementById('coin');
    if (data.outcome === 'HEADS') {
        coin.style.transform = 'rotateY(0deg)';
    } else {
        coin.style.transform = 'rotateY(180deg)';
    }
});

socket.on('admin_data_refresh', () => {
    loadAdminData();
});
