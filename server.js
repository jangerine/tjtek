const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// 20장의 화투 패 정의 (1월~10월 각 2장씩, 광/열/띠/피 구분을 위한 메타데이터 포함)
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

// 섯다 족보 판정 함수
function evaluateHand(card1, card2) {
    const m1 = Math.min(card1.month, card2.month);
    const m2 = Math.max(card1.month, card2.month);
    
    // 광땡 처리
    if (m1 === 3 && m2 === 8 && card1.type === 'kwang' && card2.type === 'kwang') {
        return { rank: 1000, name: '38광땡' };
    }
    if (m1 === 1 && m2 === 8 && card1.type === 'kwang' && card2.type === 'kwang') {
        return { rank: 990, name: '18광땡' };
    }
    if (m1 === 1 && m2 === 3 && card1.type === 'kwang' && card2.type === 'kwang') {
        return { rank: 990, name: '13광땡' };
    }

    // 땡 (같은 월 2장)
    if (m1 === m2) {
        return { rank: 800 + m1, name: `${m1 === 10 ? '장' : m1}땡` };
    }

    // 특수 족보
    if (m1 === 1 && m2 === 2) return { rank: 700, name: '알리' };
    if (m1 === 1 && m2 === 4) return { rank: 690, name: '독사' };
    if (m1 === 1 && m2 === 9) return { rank: 680, name: '구삥' };
    if (m1 === 1 && m2 === 10) return { rank: 670, name: '장삥' };
    if (m1 === 4 && m2 === 10) return { rank: 660, name: '장사' };
    if (m1 === 4 && m2 === 6) return { rank: 650, name: '세륙' };

    // 끗 및 망통
    const score = (m1 + m2) % 10;
    if (score === 9) return { rank: 500, name: '갑오 (9끗)' };
    if (score === 0) return { rank: 0, name: '망통 (0끗)' };
    
    return { rank: score * 10, name: `${score}끗` };
}

io.on('connection', (socket) => {
    console.log('유저 접속:', socket.id);

    socket.on('joinGame', (username) => {
        if (players.length >= 4) {
            socket.emit('errorMessage', '방이 가득 찼습니다. (최대 4명)');
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
            socket.emit('errorMessage', '최소 2명 이상이어야 게임을 시작할 수 있습니다.');
            return;
        }

        gameInProgress = true;
        // 덱 셔플
        let deck = [...INITIAL_DECK].sort(() => Math.random() - 0.5);

        // 카드리스트 부여
        players.forEach(p => {
            p.cards = [deck.pop(), deck.pop()];
            p.handResult = evaluateHand(p.cards[0], p.cards[1]);
        });

        // 각 개별 플레이어에게 자신의 카드 전송
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

        // 가장 높은 족보 판정
        let winner = players.reduce((prev, current) => {
            return (prev.handResult.rank > current.handResult.rank) ? prev : current;
        });

        io.emit('gameFinished', {
            winner: winner.name,
            winnerHand: winner.handResult.name,
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
server.listen(PORT, () => {
    console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});
