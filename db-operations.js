const { createPool } = require('./db-config');
const { v4: uuidv4 } = require('uuid');

// Global connection pool
let pool;

// Initialize the connection pool
async function initPool() {
  if (!pool) {
    pool = await createPool();
  }
  return pool;
}

// User operations
const userOperations = {
  // Create a new user
  async createUser(username, email, password, avatar = 'default') {
    try {
      const dbPool = await initPool();
      const userId = uuidv4();

      // Insert the user into the users table
      await dbPool.query(
        'INSERT INTO users (id, username, email, password, avatar) VALUES (?, ?, ?, ?, ?)',
        [userId, username, email, password, avatar]
      );

      // Create initial stats for the user
      await dbPool.query(
        'INSERT INTO user_stats (user_id, wins, losses) VALUES (?, 0, 0)',
        [userId]
      );

      return userId;
    } catch (error) {
      console.error('Error creating user:', error);
      throw error;
    }
  },

  // Find a user by username
  async findUserByUsername(username) {
    try {
      const dbPool = await initPool();
      const [rows] = await dbPool.query(
        'SELECT * FROM users WHERE username = ?',
        [username]
      );
      
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('Error finding user by username:', error);
      throw error;
    }
  },

  
  // Find a user by email
  async findUserByEmail(email) {
    try {
      const dbPool = await initPool();
      const [rows] = await dbPool.query(
        'SELECT * FROM users WHERE email = ?',
        [email]
      );

      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('Error finding user by email:', error);
      throw error;
    }
  },

  
  // Find a user by ID
  async findUserById(userId) {
    try {
      const dbPool = await initPool();
      const [rows] = await dbPool.query(
        'SELECT * FROM users WHERE id = ?',
        [userId]
      );

      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('Error finding user by ID:', error);
      throw error;
    }
  }
  };

// Token operations
const tokenOperations = {
  // Add an active token
  async addActiveToken(token, userId) {
    try {
      const dbPool = await initPool();
      
      // First, delete any existing tokens for this user to avoid duplicates
      await dbPool.query(
        'DELETE FROM active_tokens WHERE user_id = ?',
        [userId]
      );
      
      // Add the new token
      await dbPool.query(
        'INSERT INTO active_tokens (token, user_id, created_at) VALUES (?, ?, NOW())',
        [token, userId]
      );
      
      console.log(`Token added for user ${userId}`);
      return true;
    } catch (error) {
      console.error('Error adding active token:', error);
      throw error;
    }
  },

  
  // Remove an active token
  async removeActiveToken(token) {
    try {
      const dbPool = await initPool();
      await dbPool.query(
        'DELETE FROM active_tokens WHERE token = ?',
        [token]
      );

      console.log('Token removed');
      return true;
    } catch (error) {
      console.error('Error removing active token:', error);
      throw error;
    }
  },

  
  // Check if a token is active
async isTokenActive(token) {
  try {
    const dbPool = await initPool();
    const [rows] = await dbPool.query(
      'SELECT * FROM active_tokens WHERE token = ?',
      [token]
    );

    const isActive = rows.length > 0;
    console.log(`Token check: ${isActive ? 'active' : 'inactive'}`);
    return isActive;
  } catch (error) {
    console.error('Error checking if token is active:', error);
    return false; // If there's an error, treat the token as inactive
  }
}
};


// Statistics operations
const statsOperations = {
  // Get user statistics
  async getUserStats(userId) {
    try {
      const dbPool = await initPool();
      const [rows] = await dbPool.query(
        'SELECT * FROM user_stats WHERE user_id = ?',
        [userId]
      );

      return rows.length > 0 ? rows[0] : { wins: 0, losses: 0 };
    } catch (error) {
      console.error('Error retrieving user statistics:', error);
      throw error;
    }
  },

  // Update user statistics
async updateUserStats(userId, wins = 0, losses = 0) {
  try {
    const dbPool = await initPool();
    await dbPool.query(
      'UPDATE user_stats SET wins = wins + ?, losses = losses + ? WHERE user_id = ?',
      [wins, losses, userId]
    );
  } catch (error) {
    console.error('Error updating user statistics:', error);
    throw error;
  }
},

  // Increment a user's win count
  async incrementWins(userId) {
    try {
      const dbPool = await initPool();
      await dbPool.query(
        'UPDATE user_stats SET wins = wins + 1 WHERE user_id = ?',
        [userId]
      );
    } catch (error) {
      console.error('Error incrementing wins:', error);
      throw error;
    }
  },

  // Increment a user's loss count
async incrementLosses(userId) {
  try {
    const dbPool = await initPool();
    await dbPool.query(
      'UPDATE user_stats SET losses = losses + 1 WHERE user_id = ?',
      [userId]
    );
  } catch (error) {
    console.error('Error incrementing losses:', error);
    throw error;
  }
}
};


// Achievement operations
const achievementOperations = {
  // Get achievements for a user
  async getUserAchievements(userId) {
    try {
      const dbPool = await initPool();
      const [rows] = await dbPool.query(
        `SELECT a.id, a.name, a.description, a.icon, ua.unlocked_at 
         FROM achievements a 
         JOIN user_achievements ua ON a.id = ua.achievement_id 
         WHERE ua.user_id = ?`,
        [userId]
      );

      return rows;
    } catch (error) {
      console.error('Error retrieving user achievements:', error);
      throw error;
    }
  },

  
  // Check if a user has a specific achievement
  async hasAchievement(userId, achievementId) {
    try {
      const dbPool = await initPool();
      const [rows] = await dbPool.query(
        `SELECT * FROM user_achievements ua 
        JOIN achievements a ON ua.achievement_id = a.id 
        WHERE ua.user_id = ? AND a.id = ?`,
        [userId, achievementId]
      );

      return rows.length > 0;
    } catch (error) {
      console.error('Error checking achievement:', error);
      throw error;
    }
  },

  // Add an achievement to a user
  async addAchievement(userId, achievement) {
    try {
      const dbPool = await initPool();

      // Check if the achievement already exists
      const [existingAchievements] = await dbPool.query(
        'SELECT * FROM achievements WHERE id = ?',
        [achievement.id]
      );

      // If the achievement doesn't exist, insert it
      if (existingAchievements.length === 0) {
        await dbPool.query(
          'INSERT INTO achievements (id, name, description, icon) VALUES (?, ?, ?, ?)',
          [achievement.id, achievement.name, achievement.description, achievement.icon]
        );
      }

          // Add the achievement to the user
    await dbPool.query(
      'INSERT INTO user_achievements (user_id, achievement_id) VALUES (?, ?)',
      [userId, achievement.id]
    );
  } catch (error) {
    console.error('Error adding achievement:', error);
    throw error;
  }
}
};

// Game history operations
const historyOperations = {
  // Get the game history of a user
  async getUserGameHistory(userId) {
    try {
      const dbPool = await initPool();
      const [rows] = await dbPool.query(
        'SELECT * FROM game_history WHERE user_id = ? ORDER BY played_at DESC LIMIT 10',
        [userId]
      );

      return rows;
    } catch (error) {
      console.error('Error retrieving game history:', error);
      throw error;
    }
  },

  
    // Add a game to the user's history
    async addGameToHistory(userId, gameType, result, opponent) {
      try {
        const dbPool = await initPool();
        await dbPool.query(
          'INSERT INTO game_history (user_id, game_type, result, opponent) VALUES (?, ?, ?, ?)',
          [userId, gameType, result, opponent]
        );
      } catch (error) {
        console.error('Error adding game to history:', error);
        throw error;
      }
    }
  };
  

module.exports = {
  userOperations,
  tokenOperations,
  statsOperations,
  achievementOperations,
  historyOperations
};
