const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// 화투패 20장 구성 (월, 피/열/광 구분)
const DECK = [
  { month: 1, kwang: true, id: '1k' }, { month: 1, kwang: false, id: '1p' },
  { month: 2, kwang: false, id: '2a' }, { month: 2, kwang: false, id: '2b' },
  { month: 3, kwang: true, id: '3k' }, { month: 3, kwang: false, id: '3p' },
  { month: 4, kwang: false, id: '4a' }, { month: 4, kwang: false, id: '4b' },
  { month: 5, kwang: false, id: '5a' }, { month: 5, kwang: false, id: '5b' },
  { month: 6, kwang: false, id: '6a' }, { month: 6, kwang: false, id: '6b' },
  { month: 7, kwang: false, id: '7a' }, { month: 7, kwang: false, id: '7b' },
  { month: 8, kwang: true, id: '8k' }, { month: 8, kwang: false, id: '8p' },
  { month: 9, kwang: false, id: '9a' }, { month: 9, kwang: false, id: '9b' },
  { month: 10, kwang: false, id: '10a' }, { month: 10, kwang: false, id: '10b' }
];

let players = {};
let gameState = {
  started: false,
  deck: [],
  hands: {}
};

// 족보 계산 함수 (점수가 높을수록 강함)
function evaluateHand(card1, card2) {
  const m1 = card1.month, m2 = card2.month;
  const k1 = card1.kwang, k2 = card2.kwang;

  // 1. 광땡
  if (k1 && k2) {
    if ((m1 === 3 && m2 === 8) || (m1 === 8 && m2 === 3)) return { name: '38광땡', score: 1000 };
    if ((m1 === 1 && m2 === 8) || (m1 === 8 && m2 === 1)) return { name: '18광땡', score: 999 };
    if ((m1 === 1 && m2 === 3) || (m1 === 3 && m2 === 1)) return { name: '13광땡', score: 998 };
  }

  // 2. 땡
  if (m1 === m2) {
    return { name: `${m1}땡`, score: 500 + m1 };
  }

  // 3. 알리, 독사, 구빙, 장빙, 장사, 세륙 (특수 족보)
  const pair = [m1, m2].sort((a, b) => a - b).join(',');
  if (pair === '1,2') return { name: '알리', score: 400 };
  if (pair === '1,4') return { name: '독사', score: 390 };
  if (pair === '1,9') return { name: '구빙', score: 380 };
  if (pair === '1,10') return { name: '장빙', score: 370 };
  if (pair === '4,10') return { name: '장사', score: 360 };
  if (pair === '4,6') return { name: '세륙', score: 350 };

  // 4. 끗 (두 달의 합의 일의 자리)
  const kkut = (m1 + m2) % 10;
  if (kkut === 0) return { name: '망통', score: 0 };
  return { name: `${kkut}끗`, score: 100 + kkut };
}

function shuffle(array) {
  return array.slice().sort(() => Math.random() - 0.5);
}

io.on('connection', (socket) => {
  console.log(`플레이어 접속: ${socket.id}`);

  // 유저 입장
  socket.on('join', (nickname) => {
    players[socket.id] = { id: socket.id, nickname: nickname || '익명' };
    io.emit('updatePlayers', Object.values(players));
  });

  // 게임 시작
  socket.on('startGame', () => {
    const playerIds = Object.keys(players);
    if (playerIds.length < 2) {
      socket.emit('message', '최소 2명의 플레이어가 필요합니다.');
      return;
    }

    gameState.deck = shuffle(DECK);
    gameState.hands = {};
    gameState.started = true;

    // 각 플레이어에게 카드 2장씩 분배
    playerIds.forEach(id => {
      const c1 = gameState.deck.pop();
      const c2 = gameState.deck.pop();
      const result = evaluateHand(c1, c2);

      gameState.hands[id] = {
        cards: [c1, c2],
        result: result
      };

      // 본인에게만 본인 카드 전달
      io.to(id).emit('gameStarted', {
        cards: [c1, c2],
        result: result
      });
    });

    io.emit('message', '게임이 시작되었습니다! 카드를 확인하세요.');
  });

  // 퇴장 처리
  socket.on('disconnect', () => {
    delete players[socket.id];
    delete gameState.hands[socket.id];
    io.emit('updatePlayers', Object.values(players));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});
