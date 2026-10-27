var User = require('../models/user');
var Task = require('../models/task');
var h = require('./helpers');
var ApiError = h.ApiError;

function parseDeadline(value) {
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) value = Number(value);
    if (typeof value !== 'number' && !h.isNonEmptyString(value)) return null;
    var date = new Date(value);
    return isNaN(date.getTime()) ? null : date;
}

function parseCompleted(value) {
    if (value === undefined || value === null) return false;
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return null;
}

// Check the task fields' formats (400 errors only)
function validateTaskBody(body) {
    body = body || {};
    if (!h.isNonEmptyString(body.name)) throw new ApiError(400, 'A task must have a name');

    if (body.deadline === undefined || body.deadline === null || body.deadline === '') {
        throw new ApiError(400, 'A task must have a deadline');
    }
    var deadline = parseDeadline(body.deadline);
    if (!deadline) throw new ApiError(400, 'The deadline is not a valid date');

    var description = body.description === undefined || body.description === null ? '' : body.description;
    if (typeof description !== 'string') throw new ApiError(400, 'The description must be a string');

    var completed = parseCompleted(body.completed);
    if (completed === null) throw new ApiError(400, 'completed must be true or false');

    var assignedUser = body.assignedUser === undefined || body.assignedUser === null ? '' : body.assignedUser;
    if (assignedUser !== '' && !h.isValidId(assignedUser)) {
        throw new ApiError(400, 'assignedUser is not a valid user id');
    }

    var assignedUserName = body.assignedUserName === undefined || body.assignedUserName === null ? '' : body.assignedUserName;
    if (typeof assignedUserName !== 'string') throw new ApiError(400, 'assignedUserName must be a string');
    if (assignedUser === '' && assignedUserName !== '' && assignedUserName !== 'unassigned') {
        throw new ApiError(400, 'assignedUserName is set but the task has no assignedUser');
    }

    return {
        name: body.name,
        description: description,
        deadline: deadline,
        completed: completed,
        assignedUser: assignedUser,
        assignedUserName: assignedUserName
    };
}

// Make sure the assigned user exists (404) and the name matches (400); fills in assignedUserName
async function resolveAssignment(fields) {
    if (fields.assignedUser === '') {
        fields.assignedUserName = 'unassigned';
        return;
    }
    var user = await User.findById(fields.assignedUser);
    if (!user) throw new ApiError(404, 'The assigned user does not exist');
    if (fields.assignedUserName !== '' && fields.assignedUserName !== user.name) {
        throw new ApiError(400, 'assignedUserName does not match the name of assignedUser');
    }
    fields.assignedUserName = user.name;
}

// Put the task in its user's pendingTasks if it is pending, and remove it from everyone else's
async function syncUserPendingTasks(task) {
    var taskId = task._id.toString();
    var owner = task.assignedUser !== '' && !task.completed ? task.assignedUser : null;

    var others = { pendingTasks: taskId };
    if (owner) others._id = { $ne: owner };
    await User.updateMany(others, { $pull: { pendingTasks: taskId } });

    if (owner) await User.updateOne({ _id: owner }, { $addToSet: { pendingTasks: taskId } });
}

module.exports = function (router) {

    var tasksRoute = router.route('/tasks');

    tasksRoute.get(async function (req, res) {
        var result = await h.runListQuery(Task, req.query, 100);
        h.send(res, 200, 'OK', result);
    });

    tasksRoute.post(async function (req, res) {
        var fields = validateTaskBody(req.body);
        await resolveAssignment(fields);

        var task = await Task.create(fields);
        await syncUserPendingTasks(task);
        h.send(res, 201, 'Task created', task);
    });

    var taskRoute = router.route('/tasks/:id');

    taskRoute.get(async function (req, res) {
        var select = h.parseJsonParam(req.query, 'select');
        var task = await h.findByIdOr404(Task, req.params.id, select, 'Task');
        h.send(res, 200, 'OK', task);
    });

    taskRoute.put(async function (req, res) {
        var task = await h.findByIdOr404(Task, req.params.id, null, 'Task');
        var fields = validateTaskBody(req.body);
        await resolveAssignment(fields);

        task.set(fields);
        await task.save();
        await syncUserPendingTasks(task);
        h.send(res, 200, 'Task updated', task);
    });

    taskRoute.delete(async function (req, res) {
        var task = await h.findByIdOr404(Task, req.params.id, null, 'Task');
        var taskId = task._id.toString();
        await User.updateMany({ pendingTasks: taskId }, { $pull: { pendingTasks: taskId } });
        await Task.deleteOne({ _id: task._id });
        res.status(204).end();
    });

    return router;
};
