const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Game state
const gameStates = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Handle game data requests
  socket.on('getGameData', (data) => {
    const { betOptions } = data;
    
    // Send current game state for each bet amount
    betOptions.forEach(betAmount => {
      if (gameStates.has(betAmount)) {
        socket.emit('gameUpdate', {
          betAmount,
          ...gameStates.get(betAmount)
        });
      }
    });
  });

  // Handle card selection
  socket.on('selectCard', async (data) => {
    const { cardNumber, betAmount, userId, createdAt } = data;
    
    try {
      // Check if card is already taken
      if (gameStates.has(betAmount)) {
        const gameState = gameStates.get(betAmount);
        if (gameState.occupiedCards.includes(cardNumber)) {
          socket.emit('cardSelectionResult', { 
            success: false, 
            error: 'Card already taken' 
          });
          return;
        }
      }
      
      // Update game state
      if (!gameStates.has(betAmount)) {
        gameStates.set(betAmount, {
          playerCount: 0,
          prizePool: 0,
          occupiedCards: [],
          remainingTime: 45,
          status: 'active'
        });
      }
      
      const gameState = gameStates.get(betAmount);
      gameState.occupiedCards.push(cardNumber);
      gameState.playerCount += 1;
      gameState.prizePool += betAmount * 0.8;
      
      // Broadcast update to all clients
      io.emit('gameUpdate', {
        betAmount,
        ...gameState
      });
      
      // Broadcast card selection to all clients
      io.emit('cardSelected', {
        cardNumber,
        userId
      });
      
      socket.emit('cardSelectionResult', { success: true });
      
    } catch (error) {
      console.error('Error selecting card:', error);
      socket.emit('cardSelectionResult', { 
        success: false, 
        error: 'Internal server error' 
      });
    }
  });

  // Handle number calling
  socket.on('callNumber', (data) => {
    const { betAmount, number } = data;
    io.emit('numberCalled', { number });
  });

  // Handle winner announcement
  socket.on('announceWinner', async (data) => {
    const { winnerId, winnerCard, pattern, prizePool } = data;
    
    // Broadcast winner to all clients
    io.emit('winnerAnnounced', {
      winnerId,
      winnerCard,
      pattern,
      prizePool
    });
    
    // Save to database
    try {
      // Create game history
      const gameHistory = new GameHistory({
        winnerId,
        winnerCard,
        prizePool,
        numberOfPlayers: gameStates.get(betAmount)?.playerCount || 0,
        betAmount
      });
      
      await gameHistory.save();
      
      // Update winner's wallet and earnings
      const winner = await User.findById(winnerId);
      if (winner) {
        winner.wallet += prizePool;
        winner.dailyEarnings = (winner.dailyEarnings || 0) + prizePool;
        winner.weeklyEarnings = (winner.weeklyEarnings || 0) + prizePool;
        winner.totalEarnings = (winner.totalEarnings || 0) + prizePool;
        await winner.save();
      }
      
      // Clear game state for this bet amount
      gameStates.delete(betAmount);
      
    } catch (error) {
      console.error('Error saving game history:', error);
    }
  });

  // Handle player blocking
  socket.on('blockPlayer', (data) => {
    const { playerId, message } = data;
    
    // Update game state
    if (gameStates.has(betAmount)) {
      const gameState = gameStates.get(betAmount);
      if (!gameState.blockedPlayers) {
        gameState.blockedPlayers = [];
      }
      gameState.blockedPlayers.push(playerId);
      gameState.playerCount -= 1;
      
      // Broadcast update
      io.emit('gameUpdate', {
        betAmount,
        ...gameState
      });
    }
  });

  // Handle game over
  socket.on('gameOver', (data) => {
    const { winner } = data;
    io.emit('gameOver', { winner });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

server.listen(3002, () => {
  console.log('WebSocket server running on port 3002');
});