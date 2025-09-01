import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import User from '../models/User';
import Game from '../models/Game';
import BingoCard from '../models/BingoCard';
import Winning from '../models/Winning';
import Transaction from '../models/Transaction';
import { checkBingo, calculatePrize } from '../utils/gameLogic';


interface AuthenticatedSocket extends Socket {
  user?: any;
}

interface GameTimer {
  [gameId: string]: NodeJS.Timeout;
}

const gameTimers: GameTimer = {};

export const setupSocket = (io: Server) => {
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication error'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { id: string };
      const user = await User.findById(decoded.id).select('-password');
      
      if (!user) {
        return next(new Error('Authentication error'));
      }

      if (!user.isActive) {
        return next(new Error('Account is deactivated'));
      }

      socket.user = user;
      next();
    } catch (error) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    console.log('User connected:', socket.user.phone);

    socket.on('joinGame', async (data: { gameId: string }) => {
      try {
        const game = await Game.findById(data.gameId);
        if (!game) {
          socket.emit('error', { message: 'Game not found' });
          return;
        }

        socket.join(data.gameId);
        socket.emit('gameJoined', { game });

        // Send current game state
        if (game.status === 'active') {
          socket.emit('numberCalled', {
            number: game.numberSequence[game.currentNumberIndex],
            calledNumbers: game.calledNumbers,
          });
        }

        // Start game if it's time and not already started
        if (game.status === 'waiting' && game.startTime <= new Date()) {
          game.status = 'active';
          await game.save();

          io.to(data.gameId).emit('gameStarted', { game });

          // Start number calling interval
          startNumberCalling(game._id.toString(), io);
        }
      } catch (error) {
        socket.emit('error', { message: 'Failed to join game' });
      }
    });

    socket.on('leaveGame', (data: { gameId: string }) => {
      socket.leave(data.gameId);
    });

    socket.on('declareBingo', async (data: { gameId: string; cardId: string }) => {
      try {
        const game = await Game.findById(data.gameId);
        const card = await BingoCard.findById(data.cardId).populate("userId").lean();

        if (!game || !card || (card.userId as any)._id.toString() !== socket.user._id.toString()) {
          socket.emit('error', { message: 'Invalid bingo declaration' });
          return;
        }

        // Check if the card is already blocked or game is not active
        if (card.isBlocked || game.status !== 'active') {
          socket.emit('error', { message: 'Cannot declare bingo at this time' });
          return;
        }

        // Check for bingo
        const winningPattern = checkBingo(card.markedNumbers, card.numbers);
        
        if (winningPattern) {
          // Valid bingo
          card.isWinner = true;
          await card.save();

          game.winner = socket.user._id;
          game.winningPattern = winningPattern;
          game.status = 'completed';
          game.endTime = new Date();
          await game.save();

          // Stop number calling timer
          if (gameTimers[game._id.toString()]) {
            clearInterval(gameTimers[game._id.toString()]);
            delete gameTimers[game._id.toString()];
          }

          // Award prize
          const prize = calculatePrize(game.cardCount, game.cardPrice);

          // Update user wallet
          const user = await User.findById(socket.user._id);
          if (user) {
            user.wallet += prize;
            user.dailyEarnings += prize;
            user.weeklyEarnings += prize;
            user.totalEarnings += prize;
            await user.save();
          }

          // Create winning record
          const winning = new Winning({
            userId: socket.user._id,
            gameId: game._id,
            cardId: card._id,
            amount: prize,
            pattern: winningPattern,
          });
          await winning.save();

          // Create transaction record
          const transaction = new Transaction({
            userId: socket.user._id,
            type: 'winning',
            amount: prize,
            status: 'completed',
            reference: `WIN-${Date.now()}-${socket.user._id}`,
            description: `Bingo win in game ${game.name} with pattern ${winningPattern}`,
            metadata: {
              gameId: game._id,
              cardId: card._id,
              pattern: winningPattern,
            }
          });
          await transaction.save();

          io.to(data.gameId).emit('gameEnded', {
            winner: socket.user._id,
            winnerPhone: socket.user.phone,
            winningCard: card._id,
            prize,
            pattern: winningPattern,
          });
        } else {
          // Invalid bingo
          card.isBlocked = true;
          await card.save();

          socket.emit('bingoRejected', { message: 'Invalid bingo pattern' });
          socket.to(data.gameId).emit('playerBingoRejected', { 
            playerId: socket.user._id,
            playerPhone: socket.user.phone 
          });
        }
      } catch (error) {
        socket.emit('error', { message: 'Failed to process bingo' });
      }
    });

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.user.phone);
    });
  });
};

const startNumberCalling = (gameId: string, io: Server) => {
  const interval = setInterval(async () => {
    try {
      const game = await Game.findById(gameId);
      if (!game || game.status !== 'active') {
        clearInterval(interval);
        delete gameTimers[gameId];
        return;
      }

      // Check if all numbers have been called
      if (game.currentNumberIndex >= game.numberSequence.length - 1) {
        game.status = 'completed';
        game.endTime = new Date();
        await game.save();

        clearInterval(interval);
        delete gameTimers[gameId];

        io.to(gameId).emit('gameEnded', {
          message: 'Game ended - no winner'
        });
        return;
      }

      // Call next number
      game.currentNumberIndex += 1;
      const calledNumber = game.numberSequence[game.currentNumberIndex];
      game.calledNumbers.push(calledNumber);
      await game.save();

      io.to(gameId).emit('numberCalled', {
        number: calledNumber,
        calledNumbers: game.calledNumbers,
        index: game.currentNumberIndex,
        total: game.numberSequence.length
      });
    } catch (error) {
      console.error('Error in number calling:', error);
      clearInterval(interval);
      delete gameTimers[gameId];
    }
  }, 5000); // Call a number every 5 seconds

  gameTimers[gameId] = interval;
};