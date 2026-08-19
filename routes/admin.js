const express = require('express');
const router = express.Router();
const { returnFailure } = require('../utils/helpers');
const { AdminError, getOverview, listUsers } = require('../controllers/adminController');

/**
 * Admin endpoints. See docs/ADMIN.md.
 *
 * These are the only cross-tenant reads in the app. `authenticateSession` rejects anonymous
 * callers with 401 and `requireAdmin` rejects non-admins with 403, both before any handler
 * runs, so no handler here resolves or filters by a user.
 */
function createAdminRoutes(config, authenticateSession, requireAdmin) {

    // Turns AdminErrors into returnFailure() and keeps unexpected errors off the wire.
    function handle(work) {
        return async (req, res) => {
            try {
                return res.json({ success: true, ...(await work(req)) });
            } catch (error) {
                if (error instanceof AdminError) {
                    return res.send(returnFailure(error.message));
                }

                console.error(error);
                return res.json({ success: false });
            }
        };
    }

    router.get('/admin/overview', authenticateSession, requireAdmin, handle(async () => {
        return getOverview();
    }));

    router.get('/admin/users', authenticateSession, requireAdmin, handle(async (req) => {
        return listUsers(req.query);
    }));

    return router;
}

module.exports = createAdminRoutes;
