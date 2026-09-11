const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const https = require('https');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// 🖼️ 외부 화투 이미지 보안 차단(핫링크) 우회 프록시 라우트
app.get('/proxy-img', (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('No URL');

    const options = {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://commons.wikimedia.org/'
        }
    };

    https.get(targetUrl, options, (stream) => {
        res.setHeader('Content-Type', stream.headers['content-type'] || 'image/svg+xml');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        stream.pipe(res);
    }).on('error', (err) => {
        res.status(500).send('Image fetch error');
    });
});

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

// 게임 상태 변수
let players = []; // { id, name, chips, cards, folded, betAmount, isAllIn }
let gameInProgress = false;
let pot = 0;
let currentTurnIndex = 0;
let bettingRound = 1; // 1차, 2차 배팅
let currentHighBet = 0;
let BASE_BET = 500; // 판돈 기본금

// 🧠 섯다 족보 계산 함수
function evaluateHand(cards) {
    if (!cards || cards.length < 2) return { score: 0, name: '없음' };

    const c1 = cards[0];
    const c2 = cards[1];

    // 1. 광땡
    if ((c1.name === '3광' && c2.name === '8광') || (c1.name === '8광' && c2.name === '3광')) {
        return { score: 1000, name: '38광땡' };
    }
    if ((c1.name === '1광' && c2.name === '8광') || (c1.name === '8광' && c2.name === '1광')) {
        return { score: 990, name: '18광땡' };
    }
    if ((c1.name === '1광' && c2.name === '3광') || (c1.name === '3광' && c2.name === '1광')) {
        return { score: 980, name: '13광땡' };
    }

    // 특수 족보: 암행어사 (4열 + 7열) -> 18, 13광땡 잡음
    const is47 = (c1.name === '4열' && c2.name === '7열') || (c1.name === '7열' && c2.name === '4열');

    // 특수 족보: 땡잡이 (3광 + 7열) -> 9땡 이하 잡음
    const isDdaengJabi = (c1.name === '3광' && c2.name === '7열') || (c1.name === '7열' && c2.name === '3광');

    // 특수 족보: 구사 (4월 + 9월) -> 알리 이하 시 재경기
    const isGusa = (c1.month === 4 && c2.month === 9) || (c1.month === 9 && c2.month === 4);

    // 2. 땡 (10땡 ~ 1땡)
    if (c1.month === c2.month) {
        return { score: 800 + c1.month, name: `${c1.month}땡`, isDdaeng: true, month: c1.month };
    }

    // 3. 중간 족보 (알리, 독사, 구삥, 장삥, 장사, 세륙)
    const m1 = Math.min(c1.month, c2.month);
    const m2 = Math.max(c1.month, c2.month);

    if (m1 === 1 && m2 === 2) return { score: 700, name: '알리' };
    if (m1 === 1 && m2 === 4) return { score: 600, name: '독사' };
    if (m1 === 1 && m2 === 9) return { score: 500, name: '구삥' };
    if (m1 === 1 && m2 === 10) return { score: 400, name: '장삥' };
    if (m1 === 4 && m2 === 10) return { score: 300, name: '장사' };
    if (m1 === 4 && m2 === 6) return { score: 200, name: '세륙' };

    // 4. 끗 (갑오 ~ 1끗, 망통)
    const scoreSum = (c1.month + c2.month) % 10;
    let name = scoreSum === 9 ? '갑오 (9끗)' : (scoreSum === 0 ? '망통 (0끗)' : `${scoreSum}끗`);

    return { 
        score: 100 + scoreSum, 
        name, 
        is47, 
        isDdaengJabi, 
        isGusa 
    };
}

// 덱 셔플
function shuffleDeck() {
    let deck = [...ALL_CARDS];
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

// 다음 순서 플레이어 찾기
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

// 생존 플레이어 수 확인
function getActivePlayersCount() {
    return players.filter(p => !p.folded).length;
}

// 방송: 전체 게임 상태 업데이트
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
        turnPlayerId: gameInProgress && players[currentTurnIndex] ? players[currentTurnIndex].id : null,
        bettingRound
    });
}

// 소켓 연결
io.on('connection', (socket) => {
    // 1. 플레이어 입장
    socket.on('joinGame', (username) => {
        if (players.length >= 3) {
            return socket.emit('errorMessage', '이미 3명 방이 꽉 찼습니다!');
        }

        players.push({
            id: socket.id,
            name: username || `플레이어 ${players.length + 1}`,
            chips: 10000, // 기본 칩 10,000 제공
            cards: [],
            folded: false,
            betAmount: 0,
            isAllIn: false
        });

        broadcastGameState();
    });

    // 2. 게임 시작 (3인 필수)
    socket.on('startGame', () => {
        if (gameInProgress) return;
        if (players.length < 3) {
            return socket.emit('errorMessage', '3명이 모두 모여야 게임을 시작할 수 있습니다! (현재 ' + players.length + '/3명)');
        }

        // 칩 부족 체크
        for (let p of players) {
            if (p.chips < BASE_BET) {
                return socket.emit('errorMessage', `${p.name} 님의 칩이 부족합니다.`);
            }
        }

        // 초기화
        gameInProgress = true;
        pot = 0;
        bettingRound = 1;
        currentHighBet = BASE_BET;

        // 판돈(기본 배팅) 차감
        players.forEach(p => {
            p.chips -= BASE_BET;
            p.betAmount = BASE_BET;
            p.folded = false;
            p.isAllIn = false;
            p.cards = [];
            pot += BASE_BET;
        });

        // 카드 섞기 및 1차 카드 지급 (1장씩)
        const deck = shuffleDeck();
        players.forEach(p => {
            p.cards.push(deck.pop());
        });

        // 남아있는 카드 저장
        gameDeck = deck;

        // 첫 번째 선 정하기
        currentTurnIndex = 0;

        broadcastGameState();

        // 각 플레이어별 패 전송 (1차)
        players.forEach(p => {
            const handInfo = evaluateHand(p.cards);
            io.to(p.id).emit('gameStarted', {
                myCards: p.cards,
                myHand: handInfo
            });
        });
    });

    // 3. 배팅 액션 처리 (콜 / 레이즈 / 다이 / 올인)
    socket.on('playerAction', (action) => {
        if (!gameInProgress) return;
        const player = players[currentTurnIndex];
        if (socket.id !== player.id || player.folded) return;

        if (action === 'fold') {
            player.folded = true;
        } else if (action === 'call') {
            const needBet = currentHighBet - player.betAmount;
            if (player.chips <= needBet) {
                // 남은 칩 다 올인
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

        // 혼자 남은 경우 승리 처리
        if (getActivePlayersCount() === 1) {
            return finishGameByFold();
        }

        // 턴 진행 검사
        checkTurnProgress();
    });

    // 접속 해제
    socket.on('disconnect', () => {
        players = players.filter(p => p.id !== socket.id);
        if (players.length < 3 && gameInProgress) {
            gameInProgress = false;
            io.emit('errorMessage', '플레이어 퇴장으로 게임이 중단되었습니다.');
        }
        broadcastGameState();
    });
});

// 턴 및 라운드 진행 체크
function checkTurnProgress() {
    const activePlayers = players.filter(p => !p.folded && !p.isAllIn);
    
    // 배팅이 완료되었는지 확인 (모두 콜 금액을 채웠거나 한 명 제외 모두 Fold/All-in)
    const isRoundComplete = activePlayers.every(p => p.betAmount === currentHighBet);

    if (isRoundComplete || activePlayers.length <= 1) {
        if (bettingRound === 1) {
            // 2차 라운드로 이동: 2번째 카드 지급
            bettingRound = 2;
            players.forEach(p => {
                if (!p.folded) {
                    p.cards.push(gameDeck.pop());
                }
            });

            // 플레이어 카드 정보 개별 전송
            players.forEach(p => {
                if (!p.folded) {
                    const handInfo = evaluateHand(p.cards);
                    io.to(p.id).emit('gameStarted', {
                        myCards: p.cards,
                        myHand: handInfo
                    });
                }
            });

            currentTurnIndex = getNextTurnIndex(-1);
            broadcastGameState();
        } else {
            // 2차 배팅 종료 -> 최종 결과 판정
            finishGameWithShowdown();
        }
    } else {
        // 다음 턴 이동
        currentTurnIndex = getNextTurnIndex(currentTurnIndex);
        broadcastGameState();
    }
}

// 다이로 인한 게임 종료
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

// 승부(Showdown) 판정
function finishGameWithShowdown() {
    const activePlayers = players.filter(p => !p.folded);
    
    // 각 플레이어 족보 계산
    const results = activePlayers.map(p => {
        const hand = evaluateHand(p.cards);
        return { player: p, hand };
    });

    // 1차점수순 정렬
    results.sort((a, b) => b.hand.score - a.hand.score);

    let winner = results[0].player;
    let winnerHand = results[0].hand.name;
    let desc = '';

    // 특수 족보(암행어사/땡잡이/구사) 예외 처리
    const highestHand = results[0].hand;
    
    // 땡잡이 체크 (상대 중 9땡 이하 땡이 있고, 내 패가 땡잡이인 경우)
    const ddaengJabiPlayer = results.find(r => r.hand.isDdaengJabi);
    const hasDdaengUnder9 = results.some(r => r.hand.isDdaeng && r.hand.month <= 9);
    if (ddaengJabiPlayer && hasDdaengUnder9) {
        winner = ddaengJabiPlayer.player;
        winnerHand = '땡잡이 (승리!)';
        desc = '🎯 땡잡이가 땡을 제압했습니다!';
    }

    // 암행어사 체크 (상대 중 18/13광땡이 있고 내 패가 암행어사인 경우)
    const amhaengPlayer = results.find(r => r.hand.is47);
    const hasKwangDdaeng = results.some(r => r.hand.name === '18광땡' || r.hand.name === '13광땡');
    if (amhaengPlayer && hasKwangDdaeng) {
        winner = amhaengPlayer.player;
        winnerHand = '암행어사 (승리!)';
        desc = '🗡️ 암행어사가 광땡을 제압했습니다!';
    }

    // 승자에게 판돈 지급
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
server.listen(PORT, () => {
    console.log(`섯다 서버 시작: http://localhost:${PORT}`);
});
