const mysql = require('mysql2/promise');
const { DB_HOST, DB_USER, DB_PASS, DB_NAME } = require('./config');

const pool = mysql.createPool({
  host:             DB_HOST,
  user:             DB_USER,
  password:         DB_PASS,
  database:         DB_NAME,
  waitForConnections: true,
  connectionLimit:  10,
});

async function dbGet(sql, p = []) {
  const [rows] = await pool.query(sql, p);
  return rows[0];
}

async function dbAll(sql, p = []) {
  const [rows] = await pool.query(sql, p);
  return rows;
}

async function dbRun(sql, p = []) {
  const [result] = await pool.query(sql, p);
  return result;
}

async function close() {
  await pool.end();
}

module.exports = { dbGet, dbAll, dbRun, close };
