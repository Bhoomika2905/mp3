var User = require('../models/user');
var Task = require('../models/task');
var h = require('./helpers');
var ApiError = h.ApiError;

var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;

// Check name/email/pendingTasks formats (400 errors only)
function validateUserBody(body) {
    body = body || {};
    if (!h.isNonEmptyString(body.name)) throw new ApiError(400, 'A user must have a name');
    if (!h.isNonEmptyString(body.email)) throw new ApiError(400, 'A user must have an email');
    if (!EMAIL_PATTERN.test(body.email)) throw new ApiError(400, 'The email address is not valid');

    var pendingTasks = body.pendingTasks === undefined || body.pendingTasks === null ? [] : body.pendingTasks;
    if (!Array.isArray(pendingTasks)) throw new ApiError(400, 'pendingTasks must be a list of task ids');
    pendingTasks.forEach(function (id) {
        if (!h.isValidId(id)) throw new ApiError(400, 'pendingTasks contains an invalid task id');
    });

    return {
        name: body.name,
        email: body.email,
        pendingTasks: Array.from(new Set(pendingTasks))
    };
}

async function ensureEmailAvailable(email, userId) {
    var filter = { email: email };
    if (userId) filter._id = { $ne: userId };
    if (await User.exists(filter)) throw new ApiError(400, 'A user with this email already exists');
}

// Every task in pendingTasks must exist (404) and not be completed (400)
async function checkPendingTasks(taskIds) {
    if (taskIds.length === 0) return;
    var tasks = await Task.find({ _id: { $in: taskIds } });
    if (tasks.length !== taskIds.length) throw new ApiError(404, 'One or more tasks in pendingTasks do not exist');
    if (tasks.some(function (t) { return t.completed; })) {
        throw new ApiError(400, 'Completed tasks cannot be in pendingTasks');
    }
}

// Assign the tasks to this user, taking them away from any other user
async function assignTasksToUser(userId, userName, taskIds) {
    if (taskIds.length === 0) return;
    await User.updateMany(
        { _id: { $ne: userId }, pendingTasks: { $in: taskIds } },
        { $pull: { pendingTasks: { $in: taskIds } } }
    );
    await Task.updateMany(
        { _id: { $in: taskIds } },
        { $set: { assignedUser: userId, assignedUserName: userName } }
    );
}

module.exports = function (router) {

    var usersRoute = router.route('/users');

    usersRoute.get(async function (req, res) {
        var result = await h.runListQuery(User, req.query);
        h.send(res, 200, 'OK', result);
    });

    usersRoute.post(async function (req, res) {
        var fields = validateUserBody(req.body);
        await ensureEmailAvailable(fields.email);
        await checkPendingTasks(fields.pendingTasks);

        var user = await User.create(fields);
        await assignTasksToUser(user._id.toString(), user.name, fields.pendingTasks);
        h.send(res, 201, 'User created', user);
    });

    var userRoute = router.route('/users/:id');

    userRoute.get(async function (req, res) {
        var select = h.parseJsonParam(req.query, 'select');
        var user = await h.findByIdOr404(User, req.params.id, select, 'User');
        h.send(res, 200, 'OK', user);
    });

    userRoute.put(async function (req, res) {
        var user = await h.findByIdOr404(User, req.params.id, null, 'User');
        var userId = user._id.toString();
        var fields = validateUserBody(req.body);
        await ensureEmailAvailable(fields.email, userId);
        await checkPendingTasks(fields.pendingTasks);

        // Pending tasks dropped from the list become unassigned
        await Task.updateMany(
            { assignedUser: userId, completed: false, _id: { $nin: fields.pendingTasks } },
            { $set: { assignedUser: '', assignedUserName: 'unassigned' } }
        );
        await assignTasksToUser(userId, fields.name, fields.pendingTasks);
        // Keep assignedUserName in sync on all of this user's tasks (completed ones too)
        await Task.updateMany({ assignedUser: userId }, { $set: { assignedUserName: fields.name } });

        user.name = fields.name;
        user.email = fields.email;
        user.pendingTasks = fields.pendingTasks;
        await user.save();
        h.send(res, 200, 'User updated', user);
    });

    userRoute.delete(async function (req, res) {
        var user = await h.findByIdOr404(User, req.params.id, null, 'User');
        var userId = user._id.toString();
        await Task.updateMany(
            { assignedUser: userId },
            { $set: { assignedUser: '', assignedUserName: 'unassigned' } }
        );
        await User.deleteOne({ _id: user._id });
        res.status(204).end();
    });

    return router;
};
