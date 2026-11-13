// The node:sqlite surface the app uses (prepare().get/all/run, exec, transactions via tx()),
// on a SQLite-backed Durable Object's storage, so store.js / reseller.js / auth.js run unchanged.
export function doDb(storage) {
  const { sql } = storage;
  const query = (q, args) => {
    // node:sqlite named parameters ({ rid } for :rid) become positional ones: sql.exec() binds only `?`.
    if (args.length === 1 && args[0] !== null && typeof args[0] === 'object') {
      const named = args[0];
      args = [];
      q = q.replace(/:(\w+)/g, (_, k) => {
        if (!(k in named)) throw new Error(`Paramètre manquant : ${k}`);
        args.push(named[k]);
        return '?';
      });
    }
    return sql.exec(q, ...args).toArray(); // consumed at once: a cursor is not a snapshot
  };
  return {
    exec: (q) => { sql.exec(q).toArray(); },
    prepare: (q) => ({
      get: (...a) => query(q, a)[0],
      all: (...a) => query(q, a),
      run: (...a) => {
        query(q, a);
        return sql.exec('SELECT changes() AS changes').one();
      },
    }),
    // tx() uses this instead of BEGIN/COMMIT; it rolls back if fn throws.
    transactionSync: (fn) => storage.transactionSync(fn),
  };
}
