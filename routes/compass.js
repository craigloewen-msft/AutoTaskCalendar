const express = require('express');
const router = express.Router();
const { UserDetails } = require('../models');
const { returnFailure } = require('../utils/helpers');
const { invalidateOneDaySlipForecasts } = require('../controllers/scheduling');
const {
    CompassError,
    getCompassPayload,
    getCompassArchive,
    createItem,
    editItem,
    deleteItem,
    setTaskProject,
} = require('../controllers/compassController');

/**
 * Compass endpoints: roles > goals > projects. See docs/COMPASS.md.
 *
 * Every mutation responds with the same payload as getCompass, so the UI never has to
 * re-fetch by hand.
 */
function createCompassRoutes(config, authenticateToken) {

    // Resolves the caller, runs the handler, and turns CompassErrors into returnFailure().
    function handle(work) {
        return async (req, res) => {
            try {
                const user = await UserDetails.findOne({ username: req.user.id });

                if (!req.user || !user) {
                    return res.send(returnFailure('Not logged in'));
                }

                await work(req, user);

                const payload = await getCompassPayload(user, req.query);
                return res.json({ success: true, ...payload });
            } catch (error) {
                if (error instanceof CompassError) {
                    return res.send(returnFailure(error.message));
                }

                console.error(error);
                return res.json({ success: false });
            }
        };
    }

    router.get('/getCompass', authenticateToken, handle(async () => {}));

    // Ended items are excluded from getCompass, so detail about them is paged through here.
    router.get('/getCompassArchive', authenticateToken, async (req, res) => {
        try {
            const user = await UserDetails.findOne({ username: req.user.id });

            if (!req.user || !user) {
                return res.send(returnFailure('Not logged in'));
            }

            const result = await getCompassArchive(user, req.query);
            return res.json({ success: true, ...result });
        } catch (error) {
            if (error instanceof CompassError) {
                return res.send(returnFailure(error.message));
            }

            console.error(error);
            return res.json({ success: false });
        }
    });

    for (const level of ['Role', 'Goal', 'Project']) {
        const key = level.toLowerCase();

        router.post(`/create${level}`, authenticateToken, handle(async (req, user) => {
            await createItem(key, req.body, user);
        }));

        router.post(`/edit${level}`, authenticateToken, handle(async (req, user) => {
            await editItem(key, req.body, user);
        }));

        router.post(`/delete${level}`, authenticateToken, handle(async (req, user) => {
            await deleteItem(key, req.body, user, req.body.cascade === true);
        }));
    }

    router.post('/setTaskProject', authenticateToken, handle(async (req, user) => {
        await setTaskProject(req.body.taskId, req.body.projectId, user);
        await invalidateOneDaySlipForecasts(user._id);
    }));

    return router;
}

module.exports = createCompassRoutes;
