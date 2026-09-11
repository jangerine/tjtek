const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// 🎴 섯다 20장 덱 정의
const ALL_CARDS = [
    { month: 1, type: 'kwang', name: '1광' },
    { month: 1, type: 'pi', name: '1피' },
    { month: 2, type: 'yeol', name: '2열' },
    { month: 2, type: 'pi', name: '2피' },
    { month: 3, type: 'kwang', name: '3광' },
    { month: 3, type: 'pi', name: '3피' },
    { month: 4, type: 'yeol', name: '4열' },
    { month: 4, type: 'pi', name: '4피' },
    { month: 5, type: 'yeol', name: '5열' },
    { month: 5, type: 'pi', name: '5피' },
    { month: 6, type: 'tti', name: '6띠' },
    { month: 6, type: 'pi', name: '6피' },
    { month: 7, type: 'yeol', name: '7열' },
    { month: 7, type: 'pi', name: '7피' },
    { month: 8, type: 'kwang', name: '8광' },
    { month: 8, type: 'pi', name: '8피' },
    { month: 9, type: 'yeol', name: '9열' },
    { month: 9, type: 'pi', name: '9피' },
    { month: 10, type: 'yeol', name: '10열' },
    { month: 10, type: 'pi', name: '10피' }
];

let players = [];
let gameInProgress = false;
let pot = 0;
let currentTurnIndex = 0;
let currentHighBet = 0;
let actionCount = 0; // 한 라운드 내 액션 수행 횟수
const BASE_BET = 500;

// 🧠 섯다 족보 계산 함수
function evaluateHand(cards) {
    if (!cards || cards.length < 2) return { score: 0, name: '없음' };

    const c1 = cards[0];
    const c2 = cards[1];

    if ((c1.name === '3광' && c2.name === '8광') || (c1.name === '8광' && c2.name === '3광')) {
        return { score: 1000, name: '38광땡' };
    }
    if ((c1.name === '1광' && c2.name === '8광') || (c1.name === '8광' && c2.name === '1광')) {
        return { score: 990, name: '18광땡' };
    }
    if ((c1.name === '1광' && c2.name === '3광') || (c1.name === '3광' && c2.name === '1광')) {
        return { score: 980, name: '13광땡' };
    }

    const is47 = (c1.name === '4열' && c2.name === '7열') || (c1.name === '7열' && c2.name === '4열');
    const isDdaengJabi = (c1.name === '3광' && c2.name === '7열') || (c1.name === '7열' && c2.name === '3광');

    if (c1.month === c2.month) {
        return { score: 800 + c1.month, name: `${c1.month}땡`, isDdaeng: true, month: c1.month };
    }

    const m1 = Math.min(c1.month, c2.month);
    const m2 = Math.max(c1.month, c2.month);

    if (m1 === 1 && m2 === 2) return { score: 700, name: '알리' };
    if (m1 === 1 && m2 === 4) return { score: 600, name: '독사' };
    if (m1 === 1 && m2 === 9) return { score: 500, name: '구삥' };
    if (m1 === 1 && m2 === 10) return { score: 400, name: '장삥' };
    if (m1 === 4 && m2 === 10) return { score: 300, name: '장사' };
    if (m1 === 4 && m2 === 6) return { score: 200, name: '세륙' };

    const scoreSum = (c1.month + c2.month) % 10;
    let name = scoreSum === 9 ? '갑오 (9끗)' : (scoreSum === 0 ? '망통 (0끗)' : `${scoreSum}끗`);

    return { score: 100 + scoreSum, name, is47, isDdaengJabi };
}

function shuffleDeck() {
    let deck = [...ALL_CARDS];
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

// 다음 순서 플레이어 찾기 (Fold/All-in 제외)
function getNextTurnIndex(startIndex) {
    let idx = (startIndex + 1) % players.length;
    let count = 0;
    while (count < players.length) {
        if (!players[idx].folded && !players[idx].isAllIn) {
            return idx;
        }
        idx = (idx + 1) % players.length;
        count++;
    }
    return startIndex;
}

// 살아있는(Fold하지 않은) 플레이어 수
function getAlivePlayersCount() {
    return players.filter(p => !p.folded).length;
}

function broadcastGameState() {
    io.emit('updateGameState', {
        players: players.map(p => ({
            id: p.id,
            name: p.name,
            chips: p.chips,
            betAmount: p.betAmount,
            folded: p.folded,
            isAllIn: p.isAllIn
        })),
        pot,
        gameInProgress,
        turnPlayerId: gameInProgress && players[currentTurnIndex] ? players[currentTurnIndex].id : null
    });
}

io.on('connection', (socket) => {
    socket.on('joinGame', (username) => {
        if (players.length >= 3) {
            return socket.emit('errorMessage', '방이 꽉 찼습니다! (최대 3명)');
        }

        players.push({
            id: socket.id,
            name: username || `플레이어 ${players.length + 1}`,
            chips: 10000,
            cards: [],
            folded: false,
            betAmount: 0,
            isAllIn: false
        });

        broadcastGameState();
    });

    socket.on('startGame', () => {
        if (gameInProgress) return;
        if (players.length < 3) {
            return socket.emit('errorMessage', `3명이 모여야 게임을 시작할 수 있습니다! (현재 ${players.length}/3명)`);
        }

        for (let p of players) {
            if (p.chips < BASE_BET) {
                return socket.emit('errorMessage', `${p.name} 님의 칩이 부족합니다.`);
            }
        }

        gameInProgress = true;
        pot = 0;
        currentHighBet = BASE_BET;
        actionCount = 0;

        const deck = shuffleDeck();

        players.forEach(p => {
            p.chips -= BASE_BET;
            p.betAmount = BASE_BET;
            p.folded = false;
            p.isAllIn = false;
            p.cards = [deck.pop(), deck.pop()];
            pot += BASE_BET;
        });

        currentTurnIndex = 0;
        broadcastGameState();

        players.forEach(p => {
            const handInfo = evaluateHand(p.cards);
            io.to(p.id).emit('gameStarted', {
                myCards: p.cards,
                myHand: handInfo
            });
        });
    });

    socket.on('playerAction', (action) => {
        if (!gameInProgress) return;
        const player = players[currentTurnIndex];
        if (socket.id !== player.id || player.folded) return;

        actionCount++;

        if (action === 'fold') {
            player.folded = true;
        } else if (action === 'call') {
            const needBet = currentHighBet - player.betAmount;
            if (player.chips <= needBet) {
                pot += player.chips;
                player.betAmount += player.chips;
                player.chips = 0;
                player.isAllIn = true;
            } else {
                player.chips -= needBet;
                player.betAmount += needBet;
                pot += needBet;
            }
        } else if (action === 'raise') {
            const targetBet = currentHighBet * 2;
            const needBet = targetBet - player.betAmount;
            if (player.chips >= needBet) {
                player.chips -= needBet;
                player.betAmount += needBet;
                pot += needBet;
                currentHighBet = targetBet;
            } else {
                return socket.emit('errorMessage', '칩이 부족하여 레이즈할 수 없습니다!');
            }
        } else if (action === 'allin') {
            pot += player.chips;
            player.betAmount += player.chips;
            if (player.betAmount > currentHighBet) {
                currentHighBet = player.betAmount;
            }
            player.chips = 0;
            player.isAllIn = true;
        }

        // 1. 다이 후 단 1명만 살아남은 경우 -> 기권 승리
        if (getAlivePlayersCount() === 1) {
            return finishGameByFold();
        }

        // 2. 게임 진행 상황 검사 (다음 턴으로 넘기거나 Showdown)
        checkTurnProgress();
    });

    socket.on('disconnect', () => {
        players = players.filter(p => p.id !== socket.id);
        if (players.length < 3 && gameInProgress) {
            gameInProgress = false;
            io.emit('errorMessage', '플레이어가 퇴장하여 게임이 중단되었습니다.');
        }
        broadcastGameState();
    });
});

function checkTurnProgress() {
    const alivePlayers = players.filter(p => !p.folded); // Fold 안 한 플레이어들
    const activePlayers = alivePlayers.filter(p => !p.isAllIn); // 올인도 안 한 플레이어들

    // 배팅 완료 조건:
    // 1) 최소한 턴이 한 바퀴 이상 진행되었고 (actionCount >= alivePlayers.length)
    // 2) 생존한 플레이어들의 배팅액이 최고 배팅액(currentHighBet)과 같거나 올인 상태인 경우
    const isBetsEqual = alivePlayers.every(p => p.betAmount === currentHighBet || p.isAllIn);

    if ((actionCount >= alivePlayers.length && isBetsEqual) || activePlayers.length <= 1) {
        finishGameWithShowdown();
    } else {
        currentTurnIndex = getNextTurnIndex(currentTurnIndex);
        broadcastGameState();
    }
}

function finishGameByFold() {
    const winner = players.find(p => !p.folded);
    winner.chips += pot;

    io.emit('gameFinished', {
        outcome: {
            winner,
            winnerHand: '상대 전원 다이',
            desc: `${winner.name} 님이 판돈을 독식합니다!`
        },
        pot,
        allPlayers: players.map(p => ({
            name: p.name,
            cards: p.cards,
            handResult: evaluateHand(p.cards),
            folded: p.folded
        }))
    });

    gameInProgress = false;
    broadcastGameState();
}

function finishGameWithShowdown() {
    const activePlayers = players.filter(p => !p.folded);
    const results = activePlayers.map(p => ({
        player: p,
        hand: evaluateHand(p.cards)
    }));

    results.sort((a, b) => b.hand.score - a.hand.score);

    let winner = results[0].player;
    let winnerHand = results[0].hand.name;
    let desc = '';

    const ddaengJabiPlayer = results.find(r => r.hand.isDdaengJabi);
    const hasDdaengUnder9 = results.some(r => r.hand.isDdaeng && r.hand.month <= 9);
    if (ddaengJabiPlayer && hasDdaengUnder9) {
        winner = ddaengJabiPlayer.player;
        winnerHand = '땡잡이 (승리!)';
        desc = '🎯 땡잡이가 땡을 제압했습니다!';
    }

    const amhaengPlayer = results.find(r => r.hand.is47);
    const hasKwangDdaeng = results.some(r => r.hand.name === '18광땡' || r.hand.name === '13광땡');
    if (amhaengPlayer && hasKwangDdaeng) {
        winner = amhaengPlayer.player;
        winnerHand = '암행어사 (승리!)';
        desc = '🗡️ 암행어사가 광땡을 제압했습니다!';
    }

    winner.chips += pot;

    io.emit('gameFinished', {
        outcome: {
            winner,
            winnerHand,
            desc
        },
        pot,
        allPlayers: players.map(p => ({
            name: p.name,
            cards: p.cards,
            handResult: evaluateHand(p.cards),
            folded: p.folded
        }))
    });

    gameInProgress = false;
    broadcastGameState();
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`서버 실행 중: http://localhost:${PORT}`));
