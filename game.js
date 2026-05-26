const ROOM_PREFIX = "POKER-";
const SUITS = ['♠', '♣', '♥', '♦'];
const VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RED_SUITS = ['♥', '♦'];

// Audio Context for SFX
let audioCtx = null;
function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function playSound(freq, type, duration, volume = 0.1) {
    if (!audioCtx || !audioEnabled) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(volume, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}

const sfx = {
    deal: () => playSound(600, 'triangle', 0.1),
    chips: () => {
        playSound(800, 'square', 0.05);
        setTimeout(() => playSound(1000, 'square', 0.05), 50);
    },
    shuffle: () => {
        for(let i=0; i<5; i++) setTimeout(() => playSound(200 + i*100, 'sine', 0.05), i*50);
    },
    fold: () => playSound(200, 'sawtooth', 0.2, 0.05)
};

let peer = null;
let conn = null;
let isHost = false;
let myName = "";
let myPeerId = "";
let connections = {}; 
let deck = [];

let gameState = {
    players: [], 
    pot: 0,
    communityCards: [],
    phase: 'LOBBY', 
    currentBet: 0,
    minRaise: 20,
    roomCode: "",
    dealerIndex: 0,
    turnIndex: 0,
    smallBlind: 10,
    bigBlind: 20,
    lastAction: "",
    winners: []
};

const elements = {
    lobbyScreen: document.getElementById('lobby-screen'),
    gameScreen: document.getElementById('game-screen'),
    playerName: document.getElementById('player-name'),
    roomCode: document.getElementById('room-code'),
    createBtn: document.getElementById('create-btn'),
    joinBtn: document.getElementById('join-btn'),
    statusMsg: document.getElementById('status-msg'),
    playerContainer: document.getElementById('player-container'),
    communityCards: document.getElementById('community-cards'),
    tableArea: document.getElementById('table-area'),
    roomDisplay: document.getElementById('room-display'),
    gameStatus: document.getElementById('game-status'),
    startGameBtn: document.getElementById('start-game-btn'),
    resetRoomBtn: document.getElementById('reset-room-btn'),
    controlsBar: document.getElementById('controls-bar'),
    gameLog: document.getElementById('game-log'),
    logContent: document.getElementById('log-content'),
    toggleLogBtn: document.getElementById('toggle-log-btn'),
    homeBtn: document.getElementById('home-btn'),
    audioBtn: document.getElementById('audio-btn'),
    raiseModal: document.getElementById('raise-modal'),
    raiseInput: document.getElementById('raise-amount-input'),
    minRaiseInfo: document.getElementById('min-raise-info'),
    maxRaiseInfo: document.getElementById('max-raise-info'),
    confirmRaiseBtn: document.getElementById('confirm-raise'),
    cancelRaiseBtn: document.getElementById('cancel-raise'),
    increaseRaiseBtn: document.getElementById('increase-raise'),
    decreaseRaiseBtn: document.getElementById('decrease-raise'),
    alertModal: document.getElementById('alert-modal'),
    alertTitle: document.getElementById('alert-title'),
    alertMsg: document.getElementById('alert-msg'),
    alertOk: document.getElementById('alert-ok'),
    alertActions: document.getElementById('alert-actions'),
};

function customAlert(msg, title = "MESSAGE") {
    return new Promise((resolve) => {
        elements.alertTitle.innerText = title;
        elements.alertMsg.innerText = msg;
        elements.alertActions.innerHTML = '<button class="modal-btn confirm-btn pixel-border" id="alert-ok">OK</button>';
        elements.alertModal.classList.add('active');
        document.getElementById('alert-ok').onclick = () => {
            elements.alertModal.classList.remove('active');
            resolve();
        };
    });
}

function customConfirm(msg, title = "CONFIRM") {
    return new Promise((resolve) => {
        elements.alertTitle.innerText = title;
        elements.alertMsg.innerText = msg;
        elements.alertActions.innerHTML = `
            <button class="modal-btn cancel-btn pixel-border" id="confirm-no">NO</button>
            <button class="modal-btn confirm-btn pixel-border" id="confirm-yes">YES</button>
        `;
        elements.alertModal.classList.add('active');
        document.getElementById('confirm-no').onclick = () => {
            elements.alertModal.classList.remove('active');
            resolve(false);
        };
        document.getElementById('confirm-yes').onclick = () => {
            elements.alertModal.classList.remove('active');
            resolve(true);
        };
    });
}

elements.toggleLogBtn.onclick = () => {
    elements.gameLog.classList.toggle('collapsed');
};

let currentMinRaise = 0;
let currentMaxRaise = 0;

document.getElementById('raise-btn').onclick = () => {
    const myPlayer = gameState.players.find(p => p.peerId === myPeerId);
    currentMinRaise = Math.max(gameState.currentBet + gameState.minRaise, gameState.bigBlind * 2);
    currentMaxRaise = myPlayer.chips + myPlayer.bet;

    elements.minRaiseInfo.innerText = currentMinRaise;
    elements.maxRaiseInfo.innerText = currentMaxRaise;
    elements.raiseInput.value = currentMinRaise;
    elements.raiseModal.classList.add('active');
};

elements.cancelRaiseBtn.onclick = () => elements.raiseModal.classList.remove('active');

elements.increaseRaiseBtn.onclick = () => {
    let val = parseInt(elements.raiseInput.value) || 0;
    if (val + 10 <= currentMaxRaise) elements.raiseInput.value = val + 10;
};

elements.decreaseRaiseBtn.onclick = () => {
    let val = parseInt(elements.raiseInput.value) || 0;
    if (val - 10 >= currentMinRaise) elements.raiseInput.value = val - 10;
};

elements.confirmRaiseBtn.onclick = async () => {
    const val = parseInt(elements.raiseInput.value);
    if (!isNaN(val) && val >= currentMinRaise && val <= currentMaxRaise) {
        sendAction('RAISE', val);
        elements.raiseModal.classList.remove('active');
    } else {
        await customAlert("Invalid raise amount.", "ERROR");
    }
};

elements.homeBtn.onclick = async () => {
    if (await customConfirm("Leave this room?")) location.reload();
};

let audioEnabled = true;
elements.audioBtn.onclick = () => {
    audioEnabled = !audioEnabled;
    elements.audioBtn.innerText = audioEnabled ? "🔊" : "🔇";
};

function log(msg) {
    const entry = document.createElement('div');
    entry.innerText = msg;
    elements.logContent.prepend(entry);
}

function showStatus(msg, isError = false) {
    elements.statusMsg.innerText = msg;
    elements.statusMsg.style.color = isError ? "#ff5252" : "#ccc";
}

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function createDeck() {
    let deck = [];
    for (let suit of SUITS) {
        for (let value of VALUES) {
            deck.push({ value, suit, color: RED_SUITS.includes(suit) ? 'red' : 'black' });
        }
    }
    return deck;
}

function shuffle(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

function initPeer(id) {
    initAudio();
    return new Promise((resolve, reject) => {
        peer = new Peer(id);
        peer.on('open', (pid) => {
            myPeerId = pid;
            resolve(pid);
        });
        peer.on('error', (err) => {
            showStatus("Peer error: " + err.type, true);
            reject(err);
        });
    });
}

elements.createBtn.onclick = async () => {
    myName = elements.playerName.value.trim() || "Host";
    const code = generateRoomCode();
    gameState.roomCode = code;
    showStatus("Creating room " + code + "...");
    
    try {
        await initPeer(ROOM_PREFIX + code);
        isHost = true;
        elements.roomDisplay.innerText = "Room: " + code;
        elements.startGameBtn.style.display = 'block';
        elements.resetRoomBtn.style.display = 'block';
        
        gameState.players.push({
            peerId: myPeerId,
            name: myName,
            chips: 1000,
            cards: [],
            status: 'IDLE',
            bet: 0
        });

        peer.on('connection', (connection) => {
            setupConnection(connection);
        });

        switchToGame();
        renderTable();
    } catch (e) {
        showStatus("Failed to create room. Try again.", true);
    }
};

elements.startGameBtn.onclick = async () => {
    if (gameState.players.length < 2) {
        await customAlert("Need at least 2 players!", "LOBBY");
        return;
    }
    startHand();
};

elements.resetRoomBtn.onclick = async () => {
    if (!await customConfirm("Reset all chips and game state?")) return;
    gameState = {
        players: gameState.players.map(p => ({ ...p, chips: 1000, cards: [], status: 'IDLE', bet: 0 })),
        pot: 0,
        communityCards: [],
        phase: 'LOBBY',
        currentBet: 0,
        minRaise: 20,
        roomCode: gameState.roomCode,
        dealerIndex: 0,
        turnIndex: 0,
        smallBlind: 10,
        bigBlind: 20,
        lastAction: "Room reset by host."
    };
    broadcastState();
    renderTable();
    log("Room reset by host.");
};


function startHand() {
    sfx.shuffle();
    gameState.phase = 'DEALING';
    gameState.pot = 0;
    gameState.communityCards = [];
    deck = shuffle(createDeck());
    
    gameState.players.forEach(p => {
        p.cards = [deck.pop(), deck.pop()];
        p.status = 'ACTIVE';
        p.bet = 0;
    });

    const sbIndex = (gameState.dealerIndex + 1) % gameState.players.length;
    const bbIndex = (gameState.dealerIndex + 2) % gameState.players.length;
    
    gameState.players[sbIndex].chips -= gameState.smallBlind;
    gameState.players[sbIndex].bet = gameState.smallBlind;
    
    gameState.players[bbIndex].chips -= gameState.bigBlind;
    gameState.players[bbIndex].bet = gameState.bigBlind;
    
    gameState.pot = gameState.smallBlind + gameState.bigBlind;
    gameState.currentBet = gameState.bigBlind;
    gameState.turnIndex = (bbIndex + 1) % gameState.players.length;
    
    gameState.phase = 'PRE_FLOP';
    log("New hand started.");
    broadcastState();
    renderTable();
}

elements.joinBtn.onclick = async () => {
    myName = elements.playerName.value.trim() || "Player";
    const code = elements.roomCode.value.trim().toUpperCase();
    if (code.length !== 6) {
        showStatus("Enter a valid 6-character code.", true);
        return;
    }

    showStatus("Joining room " + code + "...");
    
    try {
        await initPeer(null);
        conn = peer.connect(ROOM_PREFIX + code);
        elements.roomDisplay.innerText = "Room: " + code;
        
        conn.on('open', () => {
            showStatus("Connected to host!");
            setupConnection(conn);
            switchToGame();
            conn.send({ type: 'JOIN', name: myName, peerId: myPeerId });
        });

        conn.on('error', (err) => {
            showStatus("Connection error: " + err, true);
        });
    } catch (e) {
        showStatus("Failed to join room.", true);
    }
};

function setupConnection(connection) {
    connections[connection.peer] = connection;
    connection.on('data', (data) => {
        handleMessage(data, connection);
    });

    connection.on('close', () => {
        delete connections[connection.peer];
        gameState.players = gameState.players.filter(p => p.peerId !== connection.peer);
        broadcastState();
        renderTable();
    });
}

function handleMessage(data, connection) {
    if (isHost) {
        if (data.type === 'JOIN') {
            gameState.players.push({
                peerId: data.peerId,
                name: data.name,
                chips: 1000,
                cards: [],
                status: 'IDLE',
                bet: 0
            });
            log(data.name + " joined.");
            broadcastState();
            renderTable();
        } else if (data.type === 'ACTION') {
            handlePlayerAction(data.peerId, data.action, data.amount);
        }
    } else {
        if (data.type === 'UPDATE_STATE') {
            const oldPhase = gameState.phase;
            gameState = data.state;
            if (gameState.lastAction) log(gameState.lastAction);
            if (gameState.phase !== oldPhase) {
                if (gameState.phase === 'DEALING' || gameState.phase === 'FLOP' || gameState.phase === 'TURN' || gameState.phase === 'RIVER') sfx.deal();
            }
            renderTable();
        }
    }
}

function handlePlayerAction(peerId, action, amount) {
    const player = gameState.players.find(p => p.peerId === peerId);
    if (gameState.players[gameState.turnIndex].peerId !== peerId) return;

    let actionMsg = "";
    if (action === 'FOLD') {
        player.status = 'FOLDED';
        actionMsg = player.name + " folds.";
        sfx.fold();
    } else if (action === 'CALL') {
        const callAmount = gameState.currentBet - player.bet;
        player.chips -= callAmount;
        player.bet += callAmount;
        gameState.pot += callAmount;
        actionMsg = player.name + (callAmount > 0 ? " calls $" + callAmount : " checks.");
        sfx.chips();
    } else if (action === 'RAISE') {
        const raiseTo = amount;
        const extra = raiseTo - player.bet;
        player.chips -= extra;
        player.bet = raiseTo;
        gameState.pot += extra;
        gameState.currentBet = raiseTo;
        actionMsg = player.name + " raises to $" + raiseTo;
        sfx.chips();
    }

    gameState.lastAction = actionMsg;
    log(actionMsg);
    nextTurn();
}

function nextTurn() {
    let nextIndex = (gameState.turnIndex + 1) % gameState.players.length;
    const activePlayers = gameState.players.filter(p => p.status === 'ACTIVE');
    
    if (activePlayers.length === 1) {
        progressPhase();
        return;
    }

    while (gameState.players[nextIndex].status !== 'ACTIVE') {
        nextIndex = (nextIndex + 1) % gameState.players.length;
    }
    
    const allCalled = activePlayers.every(p => p.bet === gameState.currentBet);
    if (allCalled && nextIndex === (gameState.dealerIndex + 1) % gameState.players.length) {
         progressPhase();
    } else {
        gameState.turnIndex = nextIndex;
        broadcastState();
        renderTable();
    }
}

const VALUE_MAP = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };

function evaluateHand(cards) {
    const values = cards.map(c => VALUE_MAP[c.value]).sort((a, b) => b - a);
    const suits = cards.map(c => c.suit);
    const counts = {};
    values.forEach(v => counts[v] = (counts[v] || 0) + 1);
    const sortedCounts = Object.entries(counts).sort((a, b) => b[1] - a[1] || b[0] - a[0]);

    const isFlush = SUITS.some(s => suits.filter(suit => suit === s).length >= 5);
    const uniqueValues = [...new Set(values)].sort((a, b) => b - a);
    let straightHigh = -1;
    for (let i = 0; i <= uniqueValues.length - 5; i++) {
        if (uniqueValues[i] - uniqueValues[i + 4] === 4) {
            straightHigh = uniqueValues[i];
            break;
        }
    }
    if (uniqueValues.includes(14) && uniqueValues.includes(5) && uniqueValues.includes(4) && uniqueValues.includes(3) && uniqueValues.includes(2)) {
        straightHigh = Math.max(straightHigh, 5);
    }

    if (isFlush && straightHigh !== -1) return { rank: 8, value: straightHigh, name: 'Straight Flush' };
    if (sortedCounts[0][1] === 4) return { rank: 7, value: parseInt(sortedCounts[0][0]), name: 'Four of a Kind' };
    if (sortedCounts[0][1] === 3 && sortedCounts[1][1] >= 2) return { rank: 6, value: parseInt(sortedCounts[0][0]), name: 'Full House' };
    if (isFlush) return { rank: 5, value: values[0], name: 'Flush' };
    if (straightHigh !== -1) return { rank: 4, value: straightHigh, name: 'Straight' };
    if (sortedCounts[0][1] === 3) return { rank: 3, value: parseInt(sortedCounts[0][0]), name: 'Three of a Kind' };
    if (sortedCounts[0][1] === 2 && sortedCounts[1][1] === 2) return { rank: 2, value: parseInt(sortedCounts[0][0]), name: 'Two Pair' };
    if (sortedCounts[0][1] === 2) return { rank: 1, value: parseInt(sortedCounts[0][0]), name: 'Pair' };
    return { rank: 0, value: values[0], name: 'High Card' };
}

function progressPhase() {
    gameState.players.forEach(p => p.bet = 0);
    gameState.currentBet = 0;

    if (gameState.phase === 'PRE_FLOP') {
        gameState.phase = 'FLOP';
        gameState.communityCards.push(deck.pop(), deck.pop(), deck.pop());
        sfx.deal();
    } else if (gameState.phase === 'FLOP') {
        gameState.phase = 'TURN';
        gameState.communityCards.push(deck.pop());
        sfx.deal();
    } else if (gameState.phase === 'TURN') {
        gameState.phase = 'RIVER';
        gameState.communityCards.push(deck.pop());
        sfx.deal();
    } else if (gameState.phase === 'RIVER' || gameState.players.filter(p => p.status === 'ACTIVE').length === 1) {
        gameState.phase = 'SHOWDOWN';
        determineWinner();
    }
    
    gameState.turnIndex = (gameState.dealerIndex + 1) % gameState.players.length;
    broadcastState();
    renderTable();
}

function determineWinner() {
    const activePlayers = gameState.players.filter(p => p.status === 'ACTIVE');
    let winningIds = [];

    if (activePlayers.length === 1) {
        const winner = activePlayers[0];
        winner.chips += gameState.pot;
        winningIds = [winner.peerId];
        log(winner.name + " wins $" + gameState.pot + " (Others folded)");
    } else {
        let winners = [];
        let bestHand = { rank: -1, value: -1 };

        activePlayers.forEach(p => {
            const hand = evaluateHand([...p.cards, ...gameState.communityCards]);
            p.hand = hand;
            if (hand.rank > bestHand.rank || (hand.rank === bestHand.rank && hand.value > bestHand.value)) {
                bestHand = hand;
                winners = [p];
            } else if (hand.rank === bestHand.rank && hand.value === bestHand.value) {
                winners.push(p);
            }
        });

        const share = Math.floor(gameState.pot / winners.length);
        winners.forEach(w => w.chips += share);
        winningIds = winners.map(w => w.peerId);
        const winnerNames = winners.map(w => w.name).join(', ');
        log("Winners: " + winnerNames + " with " + winners[0].hand.name);
    }

    gameState.winners = winningIds;
    broadcastState();
    renderTable();

    setTimeout(() => {
        gameState.dealerIndex = (gameState.dealerIndex + 1) % gameState.players.length;
        gameState.phase = 'LOBBY';
        gameState.lastAction = "";
        gameState.winners = [];
        broadcastState();
        renderTable();
    }, 8000);
}

function broadcastState() {
    if (!isHost) return;
    Object.values(connections).forEach(c => {
        const maskedState = JSON.parse(JSON.stringify(gameState));
        maskedState.players.forEach(p => {
            if (p.peerId !== c.peer && gameState.phase !== 'SHOWDOWN') {
                p.cards = p.cards.map(() => 'hidden');
            }
        });
        c.send({ type: 'UPDATE_STATE', state: maskedState });
    });
}

function switchToGame() {
    elements.lobbyScreen.classList.remove('active');
    elements.gameScreen.classList.add('active');
}

window.addEventListener('resize', () => {
    if (gameState.phase !== 'LOBBY') renderTable();
});

function renderTable() {
    elements.playerContainer.innerHTML = '';
    elements.communityCards.innerHTML = '';
    
    // Pot Display
    let potEl = document.querySelector('.pot-container');
    if (!potEl) {
        potEl = document.createElement('div');
        potEl.className = 'pot-container';
        elements.tableArea.appendChild(potEl);
    }
    potEl.innerHTML = `
        <div class="pixel-text" style="font-size: 0.6rem; color: #fff; margin-bottom: 5px;">POT</div>
        <div class="pixel-text">$${gameState.pot}</div>
    `;

    elements.gameStatus.innerText = "PHASE: " + gameState.phase;

    // Host Controls Visibility
    if (isHost) {
        elements.startGameBtn.style.display = gameState.phase === 'LOBBY' ? 'block' : 'none';
        elements.resetRoomBtn.style.display = gameState.phase === 'LOBBY' ? 'block' : 'none';
    }

    const currentPlayer = gameState.players[gameState.turnIndex];
    if (currentPlayer && currentPlayer.peerId === myPeerId && gameState.phase !== 'LOBBY' && gameState.phase !== 'SHOWDOWN') {
        elements.controlsBar.style.display = 'flex';
        const callBtn = document.getElementById('call-btn');
        const myPlayer = gameState.players.find(p => p.peerId === myPeerId);
        const callAmount = gameState.currentBet - myPlayer.bet;
        callBtn.innerText = callAmount > 0 ? `CALL` : "CHECK";
    } else {
        elements.controlsBar.style.display = 'none';
    }

    const tableWidth = window.innerWidth;
    const tableHeight = window.innerHeight;
    const centerX = tableWidth / 2;
    const centerY = tableHeight / 2;
    
    const isMobile = tableWidth < 600;
    // Tighter radius to ensure players don't overlap with edge of screen or each other
    const radiusX = Math.min(tableWidth * (isMobile ? 0.38 : 0.35), isMobile ? 180 : 450); 
    const radiusY = Math.min(tableHeight * (isMobile ? 0.32 : 0.3), isMobile ? 150 : 250);

    const myIndex = gameState.players.findIndex(p => p.peerId === myPeerId);

    gameState.players.forEach((player, index) => {
        const relativeIndex = (index - myIndex + gameState.players.length) % gameState.players.length;
        
        // Distribute players around the table, starting from bottom-center
        const angle = (relativeIndex / gameState.players.length) * Math.PI * 2 + Math.PI / 2;
        const x = centerX + Math.cos(angle) * radiusX;
        const y = centerY + Math.sin(angle) * radiusY;

        const isMyTurn = gameState.turnIndex === index;
        const isWinner = gameState.winners && gameState.winners.includes(player.peerId);
        const isMe = player.peerId === myPeerId;

        const slot = document.createElement('div');
        slot.className = 'player-slot' + (isWinner ? ' winner' : '') + (isMe ? ' me' : '') + (isMyTurn ? ' active-turn' : '');
        slot.style.left = x + 'px';
        slot.style.top = y + 'px';

        slot.innerHTML = `
            <div class="player-cards-container"></div>
            <div class="player-info-box pixel-border">
                <div class="player-amount">$${player.chips}</div>
                <div class="player-name-label">${player.name.toUpperCase()}</div>
                ${index === gameState.dealerIndex ? '<div class="dealer-button pixel-border">D</div>' : ''}
            </div>
            ${player.bet > 0 ? `<div class="player-bet-badge pixel-text" style="position: absolute; top: -25px; font-size: 0.5rem; background: rgba(0,0,0,0.6); padding: 2px 4px; border: 1px solid var(--pixel-gold);">$${player.bet}</div>` : ''}
        `;
        elements.playerContainer.appendChild(slot);
        
        const cardContainer = slot.querySelector('.player-cards-container');
        player.cards.forEach(card => {
            const cardEl = document.createElement('div');
            cardEl.className = 'card' + (player.status === 'FOLDED' ? ' folded' : '');
            
            let displayCard = card;
            if (player.peerId !== myPeerId && gameState.phase !== 'SHOWDOWN') {
                displayCard = 'hidden';
            }

            if (displayCard === 'hidden') {
                cardEl.innerHTML = `<div class="card-face card-back"></div>`;
            } else {
                cardEl.classList.add('flipped');
                cardEl.innerHTML = `
                    <div class="card-face card-front ${displayCard.color === 'red' ? 'red' : ''}">
                        <div class="card-val">${displayCard.value}</div>
                        <div class="card-suit">${displayCard.suit}</div>
                        <div class="card-val" style="transform: rotate(180deg);">${displayCard.value}</div>
                    </div>
                `;
            }
            cardContainer.appendChild(cardEl);
        });
    });

    gameState.communityCards.forEach(card => {
        const cardEl = document.createElement('div');
        cardEl.className = 'card flipped';
        cardEl.innerHTML = `
            <div class="card-face card-front ${card.color === 'red' ? 'red' : ''}">
                <div class="card-val">${card.value}</div>
                <div class="card-suit">${card.suit}</div>
                <div class="card-val" style="transform: rotate(180deg);">${card.value}</div>
            </div>
        `;
        elements.communityCards.appendChild(cardEl);
    });
}

document.getElementById('fold-btn').onclick = () => sendAction('FOLD');
document.getElementById('call-btn').onclick = () => sendAction('CALL');

function sendAction(action, amount = 0) {
    if (isHost) {
        handlePlayerAction(myPeerId, action, amount);
    } else {
        conn.send({ type: 'ACTION', peerId: myPeerId, action, amount });
    }
}
