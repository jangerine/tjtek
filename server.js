const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const INITIAL_DECK = [
    { month: 1, type: 'kwang', name: '1광' }, { month: 1, type: 'pi', name: '1피' },
    { month: 2, type: 'yeol', name: '2열' }, { month: 2, type: 'pi', name: '2피' },
    { month: 3, type: 'kwang', name: '3광' }, { month: 3, type: 'pi', name: '3피' },
    { month: 4, type: 'yeol', name: '4열' }, { month: 4, type: 'pi', name: '4피' },
    { month: 5, type: 'yeol', name: '5열' }, { month: 5, type: 'pi', name: '5피' },
    { month: 6, type: 'tti', name: '6띠' }, { month: 6, type: 'pi', name: '6피' },
    { month: 7, type: 'yeol', name: '7열' }, { month: 7, type: 'pi', name: '7피' },
    { month: 8, type: 'kwang', name: '8광' }, { month: 8, type: 'pi', name: '8피' },
    { month: 9, type: 'yeol', name: '9열' }, { month: 9, type: 'pi', name: '9피' },
    { month: 10, type: 'yeol', name: '10열' }, { month: 10, type: 'pi', name: '10피' }
];

let players = [];
let gameInProgress = false;
let pot = 0; // 누적 판돈
let currentBet = 0; // 현재 턴까지 제시된 최고 베팅액
let turnIndex = 0; // 현재 베팅할 순서
const STARTING_CHIPS = 10000;
const ANTE = 500; // 기본 참가비

function evaluateHand(card1, card2) {
    const m1 = Math.min(card1.month, card2.month);
    const m2 = Math.max(card1.month, card2.month);
    
    if (m1 === 3 && m2 === 8 && card1.type === 'kwang' && card2.type === 'kwang') return { rank: 1000, name: '38광땡' };
    if (m1 === 1 && m2 === 8 && card1.type === 'kwang' && card2.type === 'kwang') return { rank: 990, name: '18광땡' };
    if (m1 === 1 && m2 === 3 && card1.type === 'kwang' && card2.type === 'kwang') return { rank: 990, name: '13광땡' };

    if (m1 === m2) return { rank: 800 + m1, name: `${m1 === 10 ? '장' : m1}땡` };

    if (m1 === 1 && m2 === 2) return { rank: 700, name: '알리' };
    if (m1 === 1 && m2 === 4) return { rank: 690, name: '독사' };
    if (m1 === 1 && m2 === 9) return { rank: 680, name: '구삥' };
    if (m1 === 1 && m2 === 10) return { rank: 670, name: '장삥' };
    if (m1 === 4 && m2 === 10) return { rank: 660, name: '장사' };
    if (m1 === 4 && m2 === 6) return { rank: 650, name: '세륙' };

    const score = (m1 + m2) % 10;
    if (score === 9) return { rank: 500, name: '갑오 (9끗)' };
    if (score === 0) return { rank: 0, name: '망통 (0끗)' };
    
    return { rank: score * 10, name: `${score}끗` };
}

function broadcastGameState() {
    const activePlayers = players.filter(p => !p.folded);
    
    // 생존자가 1명뿐이면 즉시 승리 처리
    if (gameInProgress && activePlayers.length === 1) {
        endGame(activePlayers[0]);
        return;
    }

    // 모든 참가자의 베팅 금액이 일치하면 결과 발표
    if (gameInProgress && activePlayers.every(p => p.currentBet === currentBet || p.isAllIn)) {
        let winner = activePlayers.reduce((prev, curr) => prev.handResult.rank > curr.handResult.rank ? prev : curr);
        endGame(winner);
        return;
    }

    io.emit('gameStateUpdate', {
        players: players.map(p => ({
            id: p.id,
            name: p.name,
            chips: p.chips,
            currentBet: p.currentBet,
            folded: p.folded,
            isAllIn: p.isAllIn
        })),
        pot: pot,
        currentBet: currentBet,
        currentTurnId: gameInProgress ? players[turnIndex].id : null,
        gameInProgress: gameInProgress
    });
}

function nextTurn() {
    do {
        turnIndex = (turnIndex + 1) % players.length;
    } while (players[turnIndex].folded || players[turnIndex].isAllIn);
    
    broadcastGameState();
}

function endGame(winner) {
    winner.chips += pot;
    io.emit('gameFinished', {
        winnerName: winner.name,
        winnerHand: winner.handResult.name,
        pot: pot,
        players: players.map(p => ({
            name: p.name,
            cards: p.cards,
            handName: p.handResult.name,
            folded: p.folded,
            chips: p.chips
        }))
    });
    gameInProgress = false;
    pot = 0;
    currentBet = 0;
}

io.on('connection', (socket) => {
    socket.on('joinGame', (username) => {
        if (players.length >= 4) {
            socket.emit('errorMessage', '방이 가득 찼습니다. (최대 4명)');
            return;
        }
        players.push({
            id: socket.id,
            name: username || `플레이어 ${players.length + 1}`,
            chips: STARTING_CHIPS,
            cards: [],
            handResult: null,
            currentBet: 0,
            folded: false,
            isAllIn: false
        });

        broadcastGameState();
    });

    socket.on('startGame', () => {
        if (players.length < 2) {
            socket.emit('errorMessage', '최소 2명 이상 필요합니다.');
            return;
        }
        if (gameInProgress) return;

        gameInProgress = true;
        pot = 0;
        currentBet = ANTE;
        turnIndex = 0;

        let deck = [...INITIAL_DECK].sort(() => Math.random() - 0.5);

        players.forEach(p => {
            p.chips -= ANTE;
            pot += ANTE;
            p.currentBet = ANTE;
            p.folded = false;
            p.isAllIn = false;
            p.cards = [deck.pop(), deck.pop()];
            p.handResult = evaluateHand(p.cards[0], p.cards[1]);

            io.to(p.id).emit('yourCards', {
                cards: p.cards,
                hand: p.handResult
            });
        });

        broadcastGameState();
    });

    socket.on('action', (type) => {
        if (!gameInProgress) return;
        const player = players[turnIndex];
        if (player.id !== socket.id) return;

        const callAmount = currentBet - player.currentBet;

        if (type === 'call') {
            if (player.chips <= callAmount) {
                // 잔액 부족 시 자동으로 올인 처리
                pot += player.chips;
                player.currentBet += player.chips;
                player.chips = 0;
                player.isAllIn = true;
            } else {
                player.chips -= callAmount;
                pot += callAmount;
                player.currentBet += callAmount;
            }
        } else if (type === 'half') {
            const raiseAmount = callAmount + Math.floor(pot / 2);
            if (player.chips <= raiseAmount) {
                pot += player.chips;
                player.currentBet += player.chips;
                currentBet = Math.max(currentBet, player.currentBet);
                player.chips = 0;
                player.isAllIn = true;
            } else {
                player.chips -= raiseAmount;
                pot += raiseAmount;
                player.currentBet += raiseAmount;
                currentBet = player.currentBet;
            }
        } else if (type === 'allin') {
            pot += player.chips;
            player.currentBet += player.chips;
            if (player.currentBet > currentBet) {
                currentBet = player.currentBet;
            }
            player.chips = 0;
            player.isAllIn = true;
        } else if (type === 'die') {
            player.folded = true;
        }

        nextTurn();
    });

    socket.on('disconnect', () => {
        players = players.filter(p => p.id !== socket.id);
        if (players.length < 2) gameInProgress = false;
        broadcastGameState();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});
