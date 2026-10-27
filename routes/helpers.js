/*
 * Shared helpers for the users and tasks endpoints.
 */

// An error that carries an HTTP status and a client-safe message
function ApiError(status, message, data) {
    this.status = status;
    this.message = message;
    this.data = data === undefined ? null : data;
}

function send(res, status, message, data) {
    return res.status(status).json({ message: message, data: data === undefined ? null : data });
}

// Only accept 24-character hex strings as ids
function isValidId(id) {
    return typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id);
}

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function parseJsonParam(query, key) {
    if (query[key] === undefined) return undefined;
    try {
        var value = JSON.parse(query[key]);
    } catch (e) {
        throw new ApiError(400, 'Invalid JSON in "' + key + '" parameter');
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new ApiError(400, 'The "' + key + '" parameter must be a JSON object');
    }
    return value;
}

function parseIntParam(query, key) {
    if (query[key] === undefined) return undefined;
    var value = Number(query[key]);
    if (!Number.isInteger(value) || value < 0) {
        throw new ApiError(400, 'The "' + key + '" parameter must be a non-negative integer');
    }
    return value;
}

function parseCountParam(query) {
    if (query.count === undefined) return false;
    if (query.count === 'true') return true;
    if (query.count === 'false') return false;
    throw new ApiError(400, 'The "count" parameter must be true or false');
}

// Parse where/sort/select/skip/limit/count from the query string
function parseListQuery(query, defaultLimit) {
    var limit = parseIntParam(query, 'limit');
    return {
        where: parseJsonParam(query, 'where') || {},
        sort: parseJsonParam(query, 'sort'),
        select: parseJsonParam(query, 'select'),
        skip: parseIntParam(query, 'skip'),
        limit: limit,
        defaultLimit: defaultLimit,
        count: parseCountParam(query)
    };
}

// Run a list query (or a count) for GET /users and GET /tasks
async function runListQuery(Model, query, defaultLimit) {
    var params = parseListQuery(query, defaultLimit);
    var q;
    if (params.count) {
        q = Model.countDocuments(params.where);
    } else {
        q = Model.find(params.where);
        if (params.sort) q = q.sort(params.sort);
        if (params.select) q = q.select(params.select);
    }
    if (params.skip !== undefined) q = q.skip(params.skip);
    if (params.limit !== undefined) {
        q = q.limit(params.limit);
    } else if (params.defaultLimit && !params.count) {
        q = q.limit(params.defaultLimit);
    }
    try {
        return await q.exec();
    } catch (err) {
        // Bad filters/projections/sorts are client errors, not server errors
        if (err && (err.name === 'CastError' || err.name === 'MongoServerError' || err.name === 'StrictModeError')) {
            throw new ApiError(400, 'Invalid query parameters');
        }
        throw err;
    }
}

// Find one document by the :id in the URL, honoring ?select. 404 if missing or malformed.
async function findByIdOr404(Model, id, select, label) {
    if (!isValidId(id)) throw new ApiError(404, label + ' not found');
    var q = Model.findById(id);
    if (select) q = q.select(select);
    var doc;
    try {
        doc = await q.exec();
    } catch (err) {
        if (err && (err.name === 'CastError' || err.name === 'MongoServerError')) {
            throw new ApiError(400, 'Invalid query parameters');
        }
        throw err;
    }
    if (!doc) throw new ApiError(404, label + ' not found');
    return doc;
}

module.exports = {
    ApiError: ApiError,
    send: send,
    isValidId: isValidId,
    isNonEmptyString: isNonEmptyString,
    parseJsonParam: parseJsonParam,
    runListQuery: runListQuery,
    findByIdOr404: findByIdOr404
};
