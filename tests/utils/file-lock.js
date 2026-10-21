const fs = require('fs');

// A CROSS-PROCESS LOCK around a read-modify-write of a JSON state file, so that
// parallel workers (the onboarding suite runs its catalog chains, SO
// Configuration versions and Pulse lanes side by side) never overwrite each
// other's records. Everything those files record is PERMANENT on the server, so
// a lost update is an orphan nothing can find again.
//
//   withLock(lockPath, () => { const s = load(); ...; save(s); })
//
// The lock is a file created with O_EXCL ('wx'); a lock older than STALE_MS (a
// crashed holder) is broken. Re-entrant within one process, so a locked
// function can call another locked function on the same file.

const STALE_MS = 30000;
const WAIT_MS = 120000;
const depth = new Map(); // lockPath -> nesting depth in this process
const BUSY = new Set(['EEXIST', 'EPERM', 'EACCES', 'EBUSY']);

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// fs.renameSync that retries what Windows refuses while another process has the
// target open for READING (reads are not locked): EPERM / EACCES / EBUSY.
function renameRetry(from, to) {
  for (let attempt = 1; ; attempt += 1) {
    try { fs.renameSync(from, to); return; } catch (err) {
      if (!BUSY.has(err.code) || attempt >= 40) throw err;
      sleep(25 * attempt);
    }
  }
}

function withLock(lockPath, fn) {
  const d = depth.get(lockPath) || 0;
  if (d > 0) {
    depth.set(lockPath, d + 1);
    try { return fn(); } finally { depth.set(lockPath, d); }
  }
  const started = Date.now();
  for (;;) {
    try {
      fs.writeFileSync(lockPath, `${process.pid} ${new Date().toISOString()}`, { flag: 'wx' });
      break;
    } catch (err) {
      // Windows answers EPERM / EACCES / EBUSY (not EEXIST) while the lock file is
      // being deleted by its holder - that is "busy, try again" too (live 2026-10-21:
      // 2 of 4 parallel writers died on EPERM before this).
      if (!BUSY.has(err.code)) throw err;
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > STALE_MS) fs.unlinkSync(lockPath);
      } catch { /* the holder released it meanwhile */ }
      if (Date.now() - started > WAIT_MS) throw new Error(`could not take ${lockPath} within ${WAIT_MS / 1000}s`);
      sleep(25 + Math.floor(Math.random() * 50));
    }
  }
  depth.set(lockPath, 1);
  try {
    return fn();
  } finally {
    depth.set(lockPath, 0);
    try { fs.unlinkSync(lockPath); } catch { /* already gone */ }
  }
}

// Reads + parses a JSON state file. A MISSING file gives `fallback`; a busy one
// (Windows, a writer / scanner holding it) is retried; anything else - an
// unreadable or half-written file - THROWS. Never "empty on any error": a locked
// read-modify-write would then save that empty store over every record.
function readJson(file, fallback) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return fallback;
      if (BUSY.has(err.code) && attempt < 40) { sleep(25 * attempt); continue; }
      throw new Error(`${file} could not be read (${err.code || err.message}) - not treating it as empty`);
    }
  }
}

module.exports = { withLock, renameRetry, readJson };
