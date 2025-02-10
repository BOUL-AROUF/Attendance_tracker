const mysql = require('mysql2');

// Create a connection pool
const pool = mysql.createPool({
  host: 'localhost',      // Database host (change if using a remote DB)
  user: 'root',           // Your MySQL username
  password: 'AbBa@2008###',  // Your MySQL password (leave empty if none)
  database: 'biozagora',  // Your database name
  connectionLimit: 10     // Maximum connections in pool
});

// Export the connection pool
module.exports = pool;
