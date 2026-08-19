const express = require('express');
const router = express.Router();
const { UserDetails } = require('../models');
const { returnFailure } = require('../utils/helpers');
const { dateOnlyFromMarker } = require('../utils/temporal');
const {
    WeeklyPlanError,
    getWeeklyPlans,
    commitWeeklyPlan,
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

    return router;
}

module.exports = createWeeklyPlanRoutes;
