const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// 20장 화투 패 정의
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

const STARTING_CHIPS = 10000;
const ANTE = 500;

let players = [];
let gameInProgress = false;

let pot = 0;               // 판돈
let currentBet = 0;        // 현재 라운드의 최고 배팅금액
let turnIndex = 0;         // 현재 베팅 순서
let bettingRound = 1;      // 1: 1차 배팅, 2: 2차 배팅
let activePlayers = [];    
let playersToAct = 0;      

// 섯다 족보 판정 함수
function evaluateHand(card1, card2) {
    const m1 = Math.min(card1.month, card2.month);
    const m2 = Math.max(card1.month, card2.month);
    
    const isCard1Kwang = card1.type === 'kwang';
    const isCard2Kwang = card2.type === 'kwang';
    const kwangCount = (isCard1Kwang ? 1 : 0) + (isCard2Kwang ? 1 : 0);

    // 광땡
    if (m1 === 3 && m2 === 8 && kwangCount === 2) return { rank: 1000, name: '38광땡', code: '38KWANG' };
    if (m1 === 1 && m2 === 8 && kwangCount === 2) return { rank: 990, name: '18광땡', code: 'KWANG' };
    if (m1 === 1 && m2 === 3 && kwangCount === 2) return { rank: 990, name: '13광땡', code: 'KWANG' };

    // 특수 족보
    if (m1 === 4 && m2 === 7 && card1.type === 'yeol' && card2.type === 'yeol') {
        return { rank: 1, name: '암행어사', code: 'INSPECTOR' };
    }
    if (m1 === 3 && m2 === 7 && ((card1.month === 3 && isCard1Kwang) || (card2.month === 3 && isCard2Kwang))) {
        return { rank: 2, name: '땡잡이', code: 'CATCH_DDANG' };
    }
    if (m1 === 4 && m2 === 9 && card1.type === 'yeol' && card2.type === 'yeol') {
        return { rank: 3, name: '멍구사 (재경기)', code: 'MUNG_GUSA' };
    }
    if (m1 === 4 && m2 === 9) {
        return { rank: 3, name: '구사 (재경기)', code: 'GUSA' };
    }

    // 땡
    if (m1 === m2) {
        return { rank: 800 + m1, name: `${m1 === 10 ? '장' : m1}땡`, code: m1 === 10 ? 'JANG_DDANG' : 'DDANG' };
    }

    // 중간 족보
    if (m1 === 1 && m2 === 2) return { rank: 700, name: '알리', code: 'SPECIAL' };
    if (m1 === 1 && m2 === 4) return { rank: 690, name: '독사', code: 'SPECIAL' };
    if (m1 === 1 && m2 === 9) return { rank: 680, name: '구삥', code: 'SPECIAL' };
    if (m1 === 1 && m2 === 10) return { rank: 670, name: '장삥', code: 'SPECIAL' };
    if (m1 === 4 && m2 === 10) return { rank: 660, name: '장사', code: 'SPECIAL' };
    if (m1 === 4 && m2 === 6) return { rank: 650, name: '세륙', code: 'SPECIAL' };

    // 끗 / 망통
    const score = (m1 + m2) % 10;
    if (score === 9) return { rank: 500, name: '갑오 (9끗)', code: 'KKUT' };
    if (score === 0) return { rank: 10, name: '망통 (0끗)', code: 'KKUT' };
    
    return { rank: score * 10, name: `${score}끗`, code: 'KKUT' };
}

// 승자 및 재경기 판정
function calculateGameOutcome(survivingPlayers) {
    const hasKwangNot38 = survivingPlayers.some(p => p.handResult.code === 'KWANG');
    const hasNormalDdang = survivingPlayers.some(p => p.handResult.code === 'DDANG');
    const hasInspector = survivingPlayers.some(p => p.handResult.code === 'INSPECTOR');
    const hasCatchDdang = survivingPlayers.some(p => p.handResult.code === 'CATCH_DDANG');
    const hasGusa = survivingPlayers.some(p => p.handResult.code === 'GUSA');
    const hasMungGusa = survivingPlayers.some(p => p.handResult.code === 'MUNG_GUSA');

    let maxRank = Math.max(...survivingPlayers.map(p => p.handResult.rank));

    if (hasInspector && hasKwangNot38) {
        const inspectorPlayer = survivingPlayers.find(p => p.handResult.code === 'INSPECTOR');
        return { isRematch: false, winner: inspectorPlayer, winnerHand: '암행어사 (광땡 잡음!)', desc: '암행어사가 광땡을 제압했습니다!' };
    }

    if (hasCatchDdang && hasNormalDdang && maxRank < 810) {
        const catchPlayer = survivingPlayers.find(p => p.handResult.code === 'CATCH_DDANG');
        return { isRematch: false, winner: catchPlayer, winnerHand: '땡잡이 (땡 잡음!)', desc: '땡잡이가 땡을 제압했습니다!' };
    }

    if (maxRank <= 700) {
        if (hasMungGusa) return { isRematch: true, desc: '멍구사 발동! 판에 장땡 이상이 없어 판돈을 이월하고 재경기를 진행합니다.' };
        if (hasGusa && maxRank < 801) return { isRematch: true, desc: '구사 발동! 판에 땡 이상이 없어 판돈을 이월하고 재경기를 진행합니다.' };
    }

    let winner = survivingPlayers.reduce((prev, current) => (prev.handResult.rank > current.handResult.rank) ? prev : current);

    return { isRematch: false, winner: winner, winnerHand: winner.handResult.name, desc: '' };
}

function broadcastGameState() {
    const turnPlayerId = activePlayers[turnIndex] ? activePlayers[turnIndex].id : null;
    
    io.emit('updateGameState', {
        pot,
        currentBet,
        turnPlayerId,
        bettingRound,
        gameInProgress,
        players: players.map(p => ({
            id: p.id,
            name: p.name,
            chips: p.chips,
            betAmount: p.betAmount,
            folded: p.folded,
            isAllIn: p.isAllIn
        }))
    });
}

function startSecondBettingRound() {
    bettingRound = 2;
    currentBet = 0; // 2차 배팅금액 기준 초기화
    
    activePlayers.forEach(p => {
        p.betAmount = 0; // 2라운드 베팅 금액 초기화
    });

    // 베팅 순서 리셋
    turnIndex = 0;
    while (activePlayers[turnIndex].folded || activePlayers[turnIndex].isAllIn) {
        turnIndex = (turnIndex + 1) % activePlayers.length;
    }
    
    playersToAct = activePlayers.filter(p => !p.folded && !p.isAllIn).length;
    broadcastGameState();
}

function nextTurn() {
    playersToAct--;

    const alivePlayers = activePlayers.filter(p => !p.folded);
    
    // 기권승
    if (alivePlayers.length === 1) {
        const winner = alivePlayers[0];
        winner.chips += pot;
        io.emit('gameFinished', {
            outcome: { isRematch: false, winner, winnerHand: '기권승', desc: '다른 플레이어가 모두 다이했습니다.' },
            allPlayers: players,
            pot
        });
        resetGameVars();
        broadcastGameState();
        return;
    }

    // 현재 라운드 배팅 종료 처리
    if (playersToAct <= 0) {
        if (bettingRound === 1) {
            // 1차 배팅 완료 ➔ 2차 배팅으로 이동
            startSecondBettingRound();
        } else {
            // 2차 배팅 완료 ➔ 승자 결정
            finishShowdown();
        }
        return;
    }

    // 다음 순서 플레이어 찾기
    do {
        turnIndex = (turnIndex + 1) % activePlayers.length;
    } while (activePlayers[turnIndex].folded || activePlayers[turnIndex].isAllIn);

    broadcastGameState();
}

function finishShowdown() {
    const surviving = activePlayers.filter(p => !p.folded);
    const outcome = calculateGameOutcome(surviving);

    if (outcome.isRematch) {
        io.emit('gameFinished', { outcome, allPlayers: players, pot });
    } else {
        outcome.winner.chips += pot;
        io.emit('gameFinished', { outcome, allPlayers: players, pot });
        pot = 0;
    }

    resetGameVars();
    broadcastGameState();
}

function resetGameVars() {
    gameInProgress = false;
    currentBet = 0;
    bettingRound = 1;
    players.forEach(p => {
        p.betAmount = 0;
        p.folded = false;
        p.isAllIn = false;
        p.cards = [];
    });
}

io.on('connection', (socket) => {
    socket.on('joinGame', (username) => {
        if (players.length >= 4) {
            socket.emit('errorMessage', '방이 가득 찼습니다.');
            return;
        }
        const newPlayer = {
            id: socket.id,
            name: username || `플레이어 ${players.length + 1}`,
            chips: STARTING_CHIPS,
            cards: [],
            handResult: null,
            betAmount: 0,
            folded: false,
            isAllIn: false
        };
        players.push(newPlayer);
        broadcastGameState();
    });

    socket.on('startGame', () => {
        if (players.length < 2) {
            socket.emit('errorMessage', '최소 2명 이상 필요합니다.');
            return;
        }
        if (gameInProgress) return;

        const brokePlayer = players.find(p => p.chips < ANTE);
        if (brokePlayer) {
            socket.emit('errorMessage', `${brokePlayer.name}님의 칩이 부족합니다 (최소 기본금 500 필요).`);
            return;
        }

        gameInProgress = true;
        bettingRound = 1;
        currentBet = ANTE;

        // 판돈 징수
        players.forEach(p => {
            p.chips -= ANTE;
            p.betAmount = ANTE;
            p.folded = false;
            p.isAllIn = false;
            p.cards = [];
            pot += ANTE;
        });

        activePlayers = [...players];
        turnIndex = 0;
        playersToAct = activePlayers.length;

        // 덱 섞기 및 2장 바로 배분
        let deck = [...INITIAL_DECK].sort(() => Math.random() - 0.5);
        players.forEach(p => {
            p.cards = [deck.pop(), deck.pop()];
            p.handResult = evaluateHand(p.cards[0], p.cards[1]);
        });

        // 클라이언트로 패 전송
        players.forEach(p => {
            io.to(p.id).emit('gameStarted', {
                myCards: p.cards,
                myHand: p.handResult
            });
        });

        broadcastGameState();
    });

    socket.on('playerAction', (action) => {
        if (!gameInProgress) return;
        const player = activePlayers[turnIndex];
        if (!player || player.id !== socket.id) return;

        const callAmount = currentBet - player.betAmount;

        if (action === 'fold') {
            player.folded = true;
        } else if (action === 'call') {
            const betNeeded = Math.min(callAmount, player.chips);
            player.chips -= betNeeded;
            player.betAmount += betNeeded;
            pot += betNeeded;
            if (player.chips === 0) player.isAllIn = true;
        } else if (action === 'raise') {
            const raiseTarget = currentBet === 0 ? ANTE * 2 : currentBet * 2;
            const additionalBet = raiseTarget - player.betAmount;

            if (player.chips <= additionalBet) {
                const allInAmount = player.chips;
                player.chips = 0;
                player.betAmount += allInAmount;
                pot += allInAmount;
                player.isAllIn = true;
                if (player.betAmount > currentBet) currentBet = player.betAmount;
            } else {
                player.chips -= additionalBet;
                player.betAmount += additionalBet;
                pot += additionalBet;
                currentBet = raiseTarget;
                playersToAct = activePlayers.filter(p => !p.folded && !p.isAllIn).length;
            }
        } else if (action === 'allin') {
            const allInAmount = player.chips;
            player.chips = 0;
            player.betAmount += allInAmount;
            pot += allInAmount;
            player.isAllIn = true;

            if (player.betAmount > currentBet) {
                currentBet = player.betAmount;
                playersToAct = activePlayers.filter(p => !p.folded && !p.isAllIn).length;
            }
        }

        nextTurn();
    });

    socket.on('disconnect', () => {
        players = players.filter(p => p.id !== socket.id);
        activePlayers = activePlayers.filter(p => p.id !== socket.id);
        if (players.length < 2) resetGameVars();
        broadcastGameState();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`));
