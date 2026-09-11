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

let players = [];
let gameInProgress = false;

// 특수 족보 포함 족보 계산 함수
function evaluateHand(card1, card2) {
    const m1 = Math.min(card1.month, card2.month);
    const m2 = Math.max(card1.month, card2.month);
    
    const isCard1Kwang = card1.type === 'kwang';
    const isCard2Kwang = card2.type === 'kwang';
    const kwangCount = (isCard1Kwang ? 1 : 0) + (isCard2Kwang ? 1 : 0);

    // 1. 광땡
    if (m1 === 3 && m2 === 8 && kwangCount === 2) {
        return { rank: 1000, name: '38광땡', code: '38KWANG' };
    }
    if (m1 === 1 && m2 === 8 && kwangCount === 2) {
        return { rank: 990, name: '18광땡', code: 'KWANG' };
    }
    if (m1 === 1 && m2 === 3 && kwangCount === 2) {
        return { rank: 990, name: '13광땡', code: 'KWANG' };
    }

    // 2. 암행어사 (4열 + 7열) -> 18광땡 / 13광땡을 잡음 (38광땡은 못 잡음)
    if (m1 === 4 && m2 === 7 && card1.type === 'yeol' && card2.type === 'yeol') {
        return { rank: 1, name: '암행어사', code: 'INSPECTOR' };
    }

    // 3. 땡잡이 (3광 + 7열) -> 1땡~9땡을 잡음 (장땡/광땡 제외)
    if (m1 === 3 && m2 === 7 && ((card1.month === 3 && isCard1Kwang) || (card2.month === 3 && isCard2Kwang))) {
        return { rank: 2, name: '땡잡이', code: 'CATCH_DDANG' };
    }

    // 4. 구사 및 멍구사 (재경기 족보)
    // 멍구사 (4열 + 9열) -> 알리 이하 재경기
    if (m1 === 4 && m2 === 9 && card1.type === 'yeol' && card2.type === 'yeol') {
        return { rank: 3, name: '멍구사 (재경기)', code: 'MUNG_GUSA' };
    }
    // 일반 구사 (4 + 9) -> 알리 이하 재경기
    if (m1 === 4 && m2 === 9) {
        return { rank: 3, name: '구사 (재경기)', code: 'GUSA' };
    }

    // 5. 일반 땡 (같은 월 2장)
    if (m1 === m2) {
        return { rank: 800 + m1, name: `${m1 === 10 ? '장' : m1}땡`, code: m1 === 10 ? 'JANG_DDANG' : 'DDANG' };
    }

    // 6. 중간 특수 족보
    if (m1 === 1 && m2 === 2) return { rank: 700, name: '알리', code: 'SPECIAL' };
    if (m1 === 1 && m2 === 4) return { rank: 690, name: '독사', code: 'SPECIAL' };
    if (m1 === 1 && m2 === 9) return { rank: 680, name: '구삥', code: 'SPECIAL' };
    if (m1 === 1 && m2 === 10) return { rank: 670, name: '장삥', code: 'SPECIAL' };
    if (m1 === 4 && m2 === 10) return { rank: 660, name: '장사', code: 'SPECIAL' };
    if (m1 === 4 && m2 === 6) return { rank: 650, name: '세륙', code: 'SPECIAL' };

    // 7. 끗 및 망통
    const score = (m1 + m2) % 10;
    if (score === 9) return { rank: 500, name: '갑오 (9끗)', code: 'KKUT' };
    if (score === 0) return { rank: 10, name: '망통 (0끗)', code: 'KKUT' };
    
    return { rank: score * 10, name: `${score}끗`, code: 'KKUT' };
}

// 승자 및 재경기 상호작용 판정 함수
function calculateGameOutcome(players) {
    // 플레이어 중 상위 족보들 확인
    const hasKwangNot38 = players.some(p => p.handResult.code === 'KWANG');
    const hasNormalDdang = players.some(p => p.handResult.code === 'DDANG'); // 1땡~9땡
    const hasInspector = players.some(p => p.handResult.code === 'INSPECTOR');
    const hasCatchDdang = players.some(p => p.handResult.code === 'CATCH_DDANG');
    const hasGusa = players.some(p => p.handResult.code === 'GUSA');
    const hasMungGusa = players.some(p => p.handResult.code === 'MUNG_GUSA');

    // 가장 높은 기본 랭크 찾기
    let maxRank = Math.max(...players.map(p => p.handResult.rank));

    // 1. 암행어사 적용 (18광땡, 13광땡이 판에 있고 38광땡이 없는 경우)
    if (hasInspector && hasKwangNot38) {
        const inspectorPlayer = players.find(p => p.handResult.code === 'INSPECTOR');
        return {
            isRematch: false,
            winner: inspectorPlayer.name,
            winnerHand: '암행어사 (광땡 잡음!)',
            desc: '암행어사가 광땡을 제압했습니다!'
        };
    }

    // 2. 땡잡이 적용 (1땡~9땡이 있고 광땡/장땡이 없는 판)
    if (hasCatchDdang && hasNormalDdang && maxRank < 810) {
        const catchPlayer = players.find(p => p.handResult.code === 'CATCH_DDANG');
        return {
            isRematch: false,
            winner: catchPlayer.name,
            winnerHand: '땡잡이 (땡 잡음!)',
            desc: '땡잡이가 땡을 제압했습니다!'
        };
    }

    // 3. 구사 / 멍구사 재경기 판정
    // 판의 최고 족보가 알리(랭크 700) 이하인 경우 재경기 발동
    if (maxRank <= 700) {
        if (hasMungGusa) {
            return { isRematch: true, desc: '멍구사 발동! 판에 장땡 이상이 없어 무승부 재경기를 진행합니다.' };
        }
        // 일반 구사는 땡(801 이상)이 없으면 재경기
        if (hasGusa && maxRank < 801) {
            return { isRematch: true, desc: '구사 발동! 판에 땡 이상이 없어 무승부 재경기를 진행합니다.' };
        }
    }

    // 4. 일반 최고 승자 판정
    let winner = players.reduce((prev, current) => {
        return (prev.handResult.rank > current.handResult.rank) ? prev : current;
    });

    return {
        isRematch: false,
        winner: winner.name,
        winnerHand: winner.handResult.name,
        desc: ''
    };
}

io.on('connection', (socket) => {
    socket.on('joinGame', (username) => {
        if (players.length >= 4) {
            socket.emit('errorMessage', '방이 가득 찼습니다.');
            return;
        }
        players.push({
            id: socket.id,
            name: username || `플레이어 ${players.length + 1}`,
            cards: [],
            handResult: null
        });

        io.emit('updatePlayerList', players);
    });

    socket.on('startGame', () => {
        if (players.length < 2) {
            socket.emit('errorMessage', '최소 2명 이상 필요합니다.');
            return;
        }

        gameInProgress = true;
        let deck = [...INITIAL_DECK].sort(() => Math.random() - 0.5);

        players.forEach(p => {
            p.cards = [deck.pop(), deck.pop()];
            p.handResult = evaluateHand(p.cards[0], p.cards[1]);
        });

        players.forEach(p => {
            io.to(p.id).emit('gameStarted', {
                myCards: p.cards,
                myHand: p.handResult,
                playersInfo: players.map(pl => ({ name: pl.name, id: pl.id }))
            });
        });
    });

    socket.on('showResult', () => {
        if (!gameInProgress) return;

        const outcome = calculateGameOutcome(players);

        io.emit('gameFinished', {
            outcome: outcome,
            allPlayers: players
        });

        gameInProgress = false;
    });

    socket.on('disconnect', () => {
        players = players.filter(p => p.id !== socket.id);
        io.emit('updatePlayerList', players);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`));
