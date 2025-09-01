// server.js (or app.js in your Express backend)
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3000", // Your frontend URL
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// MongoDB Models
const GameSessionSchema = new mongoose.Schema({
  betAmount: Number,
  players: [{
    userId: String,
    cardId: Number,
    socketId: String,
    isBlocked: { type: Boolean, default: false }
  }],
  isActive: { type: Boolean, default: true },
  startTime: Date,
  endTime: Date,
  winner: {
    userId: String,
    cardId: Number
  }
});

const ActiveBetSchema = new mongoose.Schema({
  betAmount: Number,
  playerCount: Number,
  countdown: Number, // in seconds
  isAcceptingPlayers: Boolean
});

const GameSession = mongoose.model('GameSession', GameSessionSchema);
const ActiveBet = mongoose.model('ActiveBet', ActiveBetSchema);

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Join a user to a specific bet room
  socket.on('join-bet', async (data) => {
    const { betAmount, userId } = data;
    
    // Add user to room for this bet amount
    socket.join(`bet-${betAmount}`);
    
    // Send current state of this bet
    const activeBet = await ActiveBet.findOne({ betAmount });
    io.to(`bet-${betAmount}`).emit('bet-update', activeBet);
  });

  // Handle card selection
  socket.on('select-card', async (data) => {
    const { betAmount, cardId, userId } = data;
    
    // Check if card is already taken in any active game session
    const existingSession = await GameSession.findOne({
      betAmount,
      isActive: true,
      'players.cardId': cardId
    });
    
    if (existingSession) {
      socket.emit('card-taken', { cardId, message: 'Card already selected' });
      return;
    }
    
    // Check if user has already selected a card for this bet
    const userSession = await GameSession.findOne({
      betAmount,
      isActive: true,
      'players.userId': userId
    });
    
    if (userSession) {
      socket.emit('error', { message: 'You already selected a card' });
      return;
    }
    
    // Find or create game session for this bet
    let gameSession = await GameSession.findOne({
      betAmount,
      isActive: true
    });
    
    if (!gameSession) {
      gameSession = new GameSession({
        betAmount,
        players: [],
        startTime: new Date(),
        isActive: true
      });
    }
    
    // Add player to session
    gameSession.players.push({
      userId,
      cardId,
      socketId: socket.id
    });
    
    await gameSession.save();
    
    // Update active bet count
    const activeBet = await ActiveBet.findOne({ betAmount });
    if (activeBet) {
      activeBet.playerCount = gameSession.players.length;
      await activeBet.save();
    }
    
    // Notify all users in this bet room about the update
    io.to(`bet-${betAmount}`).emit('card-selected', {
      cardId,
      userId,
      playerCount: gameSession.players.length
    });
    
    // If we have enough players (2), start the countdown
    if (gameSession.players.length >= 2) {
      // Start game in 30 seconds
      setTimeout(async () => {
        gameSession.isActive = false; // No more players can join
        await gameSession.save();
        
        // Notify players to start the game
        io.to(`bet-${betAmount}`).emit('game-starting', {
          sessionId: gameSession._id,
          players: gameSession.players
        });
        
        // Reset the active bet after a delay
        setTimeout(async () => {
          const newActiveBet = new ActiveBet({
            betAmount,
            playerCount: 0,
            countdown: 30,
            isAcceptingPlayers: true
          });
          await newActiveBet.save();
          io.to(`bet-${betAmount}`).emit('bet-update', newActiveBet);
        }, 30000); // 30 seconds after game starts
      }, 30000); // 30 seconds countdown
    }
  });

  // Handle bingo claim
  socket.on('bingo-claim', async (data) => {
    const { sessionId, userId } = data;
    
    const gameSession = await GameSession.findById(sessionId);
    if (!gameSession) {
      socket.emit('error', { message: 'Game session not found' });
      return;
    }
    
    // Find the player
    const player = gameSession.players.find(p => p.userId === userId);
    if (!player) {
      socket.emit('error', { message: 'Player not found in this session' });
      return;
    }
    
    if (player.isBlocked) {
      socket.emit('error', { message: 'You are blocked from claiming bingo' });
      return;
    }
    
    // Check if the card is a winner (implement your win logic here)
    const isWinner = checkIfWinner(player.cardId, gameSession.calledNumbers || []);
    
    if (isWinner) {
      // Declare winner
      gameSession.winner = { userId, cardId: player.cardId };
      gameSession.endTime = new Date();
      await gameSession.save();
      
      // Notify all players
      io.to(`bet-${gameSession.betAmount}`).emit('winner-declared', {
        winner: { userId, cardId: player.cardId },
        prize: gameSession.betAmount * gameSession.players.length
      });
    } else {
      // Block the player for false claim
      player.isBlocked = true;
      await gameSession.save();
      
      socket.emit('bingo-failed', { message: 'False bingo claim. You are now blocked.' });
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Initialize active bets
async function initializeActiveBets() {
  const betAmounts = [10, 20, 30, 50, 100];
  
  for (const amount of betAmounts) {
    const existingBet = await ActiveBet.findOne({ betAmount: amount });
    if (!existingBet) {
      const newBet = new ActiveBet({
        betAmount: amount,
        playerCount: 0,
        countdown: 30,
        isAcceptingPlayers: true
      });
      await newBet.save();
    }
  }
}

// Connect to MongoDB and start server
mongoose.connect('mongodb://localhost:27017/bingo-game', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('Connected to MongoDB');
  initializeActiveBets();
  server.listen(5000, () => {
    console.log('Server running on port 5000');
  });
});