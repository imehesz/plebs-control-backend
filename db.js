const sqlite3 = require('sqlite3').verbose();
const path    = require('path');
const { DB_NAME } = require('./config');

const db = new sqlite3.Database(path.join(__dirname, DB_NAME));

function dbGet(sql, p = []) {
  return new Promise((res, rej) => db.get(sql, p, (e, r) => e ? rej(e) : res(r)));
}
function dbAll(sql, p = []) {
  return new Promise((res, rej) => db.all(sql, p, (e, r) => e ? rej(e) : res(r)));
}
function dbRun(sql, p = []) {
  return new Promise((res, rej) => db.run(sql, p, function (e) { e ? rej(e) : res(this); }));
}
function close() { db.close(); }

module.exports = { dbGet, dbAll, dbRun, close };
