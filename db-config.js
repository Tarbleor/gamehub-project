const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// Database configuration
const dbConfig = {
  host: '127.0.0.1',    // already fixed
  user: 'root',
  password: 'akintola',         
  database: 'gameverse',
  port: 3306,
  
};

// Function to initialize the database
async function initDatabase() {
  try {
    console.log('Initializing the database...');

    // Connect without selecting the database yet
    const connection = await mysql.createConnection({
      host: dbConfig.host,
      user: dbConfig.user,
      password: dbConfig.password,
      port: dbConfig.port,
      authPlugins: {
        mysql_native_password: () => () => Buffer.from('', 'utf-8')
      }
    });

    // Create the database if it doesn't exist
    await connection.query(`CREATE DATABASE IF NOT EXISTS ${dbConfig.database}`);

    // Switch to the target database
    await connection.query(`USE ${dbConfig.database}`);

    // Read and execute the database.sql file
    const sqlScript = fs.readFileSync(path.join(__dirname, 'database.sql'), 'utf8');
    const statements = sqlScript.split(';').filter(statement => statement.trim() !== '');

    for (const statement of statements) {
      await connection.query(statement);
    }

    console.log('Database initialized successfully!');
    await connection.end();
    return true;
  } catch (error) {
    console.error('Error initializing the database:', error);
    return false;
  }
}

// Function to test the MySQL connection
async function testConnection() {
  try {
    const connection = await mysql.createConnection({
      ...dbConfig,
      authPlugins: {
        mysql_native_password: () => () => Buffer.from('', 'utf-8')
      }
    });

    console.log('Successfully connected to MySQL!');
    await connection.end();
    return true;
  } catch (error) {
    console.error('Error connecting to the database:', error);
    return false;
  }
}

// Function to create a connection pool (for handling many requests)
async function createPool() {
  try {
    const pool = mysql.createPool({
      ...dbConfig,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });

    // Test a connection
    const connection = await pool.getConnection();
    connection.release();

    return pool;
  } catch (error) {
    console.error('Error connecting to the database:', error);
    throw error;
  }
}

module.exports = {
  initDatabase,
  createPool,
  testConnection,
  dbConfig
};
