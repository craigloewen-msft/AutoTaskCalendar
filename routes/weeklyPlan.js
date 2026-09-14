const express = require('express');
const router = express.Router();
const { UserDetails } = require('../models');
const { returnFailure } = require('../utils/helpers');
const { addDateOnlyDays, dateOnlyFromMarker, mondayWeekBounds } = require('../utils/temporal');
const { getTaskListFromUsername } = require('../controllers/taskController');
const { clearProjectRecommendationCache } = require('../controllers/projectRecommendation');
const {
    WeeklyPlanError,
    getWeeklyPlans,
    commitWeeklyPlan,
    carryTasksForward,
} = require('../controllers/weeklyPlanController');

/**
 * Weekly Plan endpoints. See docs/WEEKLY_PLAN.md.
 *
 * Both responses carry the same `plans` shape, so the client applies one reducer whether it
 * just read the week or just committed it -- the pattern the Compass routes already use.
 */
function createWeeklyPlanRoutes(config, authenticateSession) {

    // Resolves the caller, runs the handler, and turns WeeklyPlanErrors into returnFailure().
    function handle(work) {
        return async (req, res) => {
            try {
                const user = await UserDetails.findOne({ username: req.user.username });

                if (!req.user || !user) {
                    return res.send(returnFailure('Not logged in'));
                }

                const payload = await work(req, user);
                return res.json({ success: true, ...payload });
            } catch (error) {
                if (error instanceof WeeklyPlanError) {
                    return res.send(returnFailure(error.message));
                }

                console.error(error);
                return res.json({ success: false });
            }
        };
    }

    router.get('/getWeeklyPlans', authenticateSession, handle(async (req, user) => {
        return getWeeklyPlans(user, req.query);
    }));

    // Committing returns the refreshed range so the page never has to re-read by hand.
    router.post('/commitWeeklyPlan', authenticateSession, handle(async (req, user) => {
        const plan = await commitWeeklyPlan(user, req.body);
        const weekStart = dateOnlyFromMarker(plan.weekStart);
        return getWeeklyPlans(user, { from: weekStart, to: weekStart });
    }));

    /**
     * Carry last week's unfinished work into this week.
     *
     * Returns the refreshed task list AND both weeks' plans, so one round trip leaves the
     * page consistent: the carried task appears in this week, and last week's item now
     * resolves as `moved` without its snapshot having been rewritten.
     */
    router.post('/carryTasksForward', authenticateSession, handle(async (req, user) => {
        const { dueDate } = await carryTasksForward(user, req.body);
        clearProjectRecommendationCache(user._id);

        const week = mondayWeekBounds(dueDate, user.timeZone);
        const [plans, taskList] = await Promise.all([
            getWeeklyPlans(user, {
                from: addDateOnlyDays(week.startDate, -7),
                to: week.startDate,
            }),
            getTaskListFromUsername(user.username),
        ]);
        return { ...plans, taskList };
    }));

    return router;
}

module.exports = createWeeklyPlanRoutes;
