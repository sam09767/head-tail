const socket = io(); // Connect Socket
let selectedBetAmount = 10;
let userBalance = 1000;
let gameHistory = []; 
let isFlipping = false;

// Bet Amount Selection
function selectChip(amount) {
    selectedBetAmount = amount;
    document.getElementById('currentBet').innerText = amount;
}

// Place Bet
function placeBet(side) {
    if (isFlipping) return alert("Coin is flipping, wait for result!");
    if (userBalance < selectedBetAmount) return alert("Insufficient balance!");

    userBalance -= selectedBetAmount;
    updateBalanceUI();

    // Send to Server
    socket.emit('placeBet', { side: side, amount: selectedBetAmount });
    alert(`Bet placed on ${side} for ₹${selectedBetAmount}`);
}

function updateBalanceUI() {
    document.getElementById('userBalance').innerText = userBalance;
}

// ---------------------------------------------------
// Parabolic 3D Coin Flip Logic
// ---------------------------------------------------
socket.on('coinFlipResult', (data) => {
    if(isFlipping) return;
    isFlipping = true;
    
    const coin = document.getElementById('coin');
    const coinBounce = document.getElementById('coinBounce');
    const coinShadow = document.getElementById('coinShadow');
    
    // Parabolic Bounce up
    coinBounce.style.transform = "translateY(-300px)";
    coinShadow.style.transform = "scale(0.3)";
    coinShadow.style.opacity = "0.3";

    // Random Spins + Winning Side mapping
    const spins = Math.floor(Math.random() * 5) + 10; // 10 to 15 spins
    const spinDegrees = spins * 360;
    // Heads = 0deg, Tails = 180deg
    const finalRotation = data.winner === 'HEADS' ? spinDegrees : spinDegrees + 180;
    
    coin.style.transform = `rotateX(${finalRotation}deg)`;

    // Landing After 3 seconds
    setTimeout(() => {
        coinBounce.style.transform = "translateY(0)";
        coinShadow.style.transform = "scale(1)";
        coinShadow.style.opacity = "1";
        
        setTimeout(() => {
            isFlipping = false;
            updateGameHistory(data.winner);
            // Handle Winnings if user won (Mock logic, Backend should send balance update)
        }, 500);
    }, 1500); 
});

// ---------------------------------------------------
// Last 10 Results History Logic
// ---------------------------------------------------
function updateGameHistory(result) {
    gameHistory.push(result);
    if(gameHistory.length > 10) gameHistory.shift();
    
    const historyList = document.getElementById('historyList');
    historyList.innerHTML = '';
    
    const recent = [...gameHistory].reverse();
    recent.forEach(res => {
        const div = document.createElement('div');
        const isHeads = res === 'HEADS';
        div.className = `history-badge ${isHeads ? 'heads' : 'tails'}`;
        div.innerText = isHeads ? 'H' : 'T';
        historyList.appendChild(div);
    });
}

// ---------------------------------------------------
// Deposit & Withdrawal Modals and Status Table Logic
// ---------------------------------------------------
function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

// Function to render transactions dynamically in table
function renderTransactionHistory(type, transactions) {
    const tableBody = document.getElementById(type + 'TableBody');
    tableBody.innerHTML = '';

    if (transactions.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="3" style="text-align:center;">No records found</td></tr>';
        return;
    }

    transactions.forEach(tx => {
        const row = document.createElement('tr');
        // Define Status Class for Coloring
        let statusClass = '';
        if (tx.status.toLowerCase() === 'success') statusClass = 'status-success';
        else if (tx.status.toLowerCase() === 'pending') statusClass = 'status-pending';
        else if (tx.status.toLowerCase() === 'failed') statusClass = 'status-failed';

        row.innerHTML = `
            <td>${tx.date}</td>
            <td>₹${tx.amount}</td>
            <td class="${statusClass}">${tx.status}</td>
        `;
        tableBody.appendChild(row);
    });
}

// Fetching history from Server via Socket (Mock trigger included)
socket.on('updateHistoryRecords', (data) => {
    // data example: { deposits: [...], withdrawals: [...] }
    renderTransactionHistory('deposit', data.deposits);
    renderTransactionHistory('withdraw', data.withdrawals);
});

// -- Mock Data for testing UI (Delete this in production, server will send real data) --
const mockData = {
    deposits: [
        { date: '2026-09-06', amount: 500, status: 'Success' },
        { date: '2026-09-05', amount: 200, status: 'Pending' }
    ],
    withdrawals: [
        { date: '2026-09-06', amount: 1000, status: 'Pending' },
        { date: '2026-09-04', amount: 300, status: 'Failed' }
    ]
};
renderTransactionHistory('deposit', mockData.deposits);
renderTransactionHistory('withdraw', mockData.withdrawals);
