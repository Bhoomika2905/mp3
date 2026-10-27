/*
 * Connect all of your endpoints together here.
 */
var ApiError = require('./helpers').ApiError;

module.exports = function (app, router) {
    app.use('/api', require('./home.js')(router));
    app.use('/api', require('./users.js')(router));
    app.use('/api', require('./tasks.js')(router));

    // Unknown routes
    app.use(function (req, res) {
        res.status(404).json({ message: 'Endpoint not found', data: null });
    });

    // Turn any error into a { message, data } response without leaking database internals
    app.use(function (err, req, res, next) {
        if (err instanceof ApiError) {
            return res.status(err.status).json({ message: err.message, data: err.data });
        }
        if (err && err.type === 'entity.parse.failed') {
            return res.status(400).json({ message: 'The request body is not valid JSON', data: null });
        }
        if (err && err.code === 11000) {
            return res.status(400).json({ message: 'A user with this email already exists', data: null });
        }
        if (err && (err.name === 'ValidationError' || err.name === 'CastError')) {
            return res.status(400).json({ message: 'The request contains invalid fields', data: null });
        }
        console.error(err);
        res.status(500).json({ message: 'Internal server error', data: null });
    });
};
