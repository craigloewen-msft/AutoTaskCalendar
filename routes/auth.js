const express = require('express');
const router = express.Router();
const passport = require('passport');
const { UserDetails } = require('../models');
const { returnFailure, returnBasicUserInfo } = require('../utils/helpers');
const {
    TEMPORAL_DATA_VERSION,
    DEFAULT_WORKING_START_MINUTES,
    DEFAULT_WORKING_END_MINUTES,
    isValidTimeZone,
    parseWallTime,
} = require('../utils/temporal');
const { migrateTemporalData } = require('../utils/temporalMigration');

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function validateWorkingPreferences(body) {
    const start = parseWallTime(body.workingStartTime);
    const end = parseWallTime(body.workingEndTime);
    if (!start.valid || !end.valid) return { error: 'Working hours must use HH:mm' };
    if (end.minutes <= start.minutes) return { error: 'Working end time must be after start time' };
    if (!isValidTimeZone(body.timeZone)) return { error: 'A valid IANA timezone is required' };
    if (!Array.isArray(body.workingDays) || body.workingDays.length === 0 ||
        body.workingDays.some((day) => !WEEKDAYS.includes(day))) {
        return { error: 'At least one valid working day is required' };
    }
    return { start: start.minutes, end: end.minutes };
}

function regenerateSession(req) {
    return new Promise((resolve, reject) => {
        req.session.regenerate((error) => error ? reject(error) : resolve());
    });
}

function loginSession(req, user) {
    return new Promise((resolve, reject) => {
        req.logIn(user, (error) => error ? reject(error) : resolve());
    });
}

async function establishSession(req, user) {
    await regenerateSession(req);
    await loginSession(req, user);
}

function createAuthRoutes(config, authenticateSession, requireSameOrigin) {
    
    router.post('/login', requireSameOrigin, (req, res, next) => {
        passport.authenticate('local', async (err, user) => {
            if (err) return res.json(returnFailure('Server error while authenticating'));
            if (!user) return res.json(returnFailure('Failure to login'));

            try {
                await migrateTemporalData(user, req.body.timeZone);
                user.lastLoginDate = new Date();
                await user.save();
                await establishSession(req, user);

                const returnUserInfo = await returnBasicUserInfo(user);
                return res.json({ success: true, auth: true, user: returnUserInfo });
            } catch (error) {
                console.error('Could not establish the login session');
                return res.json(returnFailure('Server error while updating account data'));
            }
        })(req, res, next);
    });

    router.get('/user', authenticateSession, async (req, res) => {
        return res.json({
            success: true,
            auth: true,
            user: await returnBasicUserInfo(req.user),
        });
    });

    router.post('/logout', authenticateSession, (req, res, next) => {
        req.logout((logoutError) => {
            if (logoutError) return next(logoutError);
            req.session.destroy((destroyError) => {
                if (destroyError) return next(destroyError);
                res.clearCookie(config.sessionCookieName, config.sessionCookieOptions);
                return res.json({ success: true });
            });
        });
    });

    router.post('/register', requireSameOrigin, async function (req, res) {
        try {
            let doesUserExist = await UserDetails.exists({ username: req.body.username });

            if (doesUserExist) {
                return res.json(returnFailure("Username already exists"));
            }

            if (!isValidTimeZone(req.body.timeZone)) {
                return res.json(returnFailure('A valid IANA timezone is required'));
            }

            let registeredUser = await UserDetails.register({
                username: req.body.username,
                email: req.body.email,
                timeZone: req.body.timeZone,
                workingStartMinutes: DEFAULT_WORKING_START_MINUTES,
                workingEndMinutes: DEFAULT_WORKING_END_MINUTES,
                temporalDataVersion: TEMPORAL_DATA_VERSION,
                workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
            }, req.body.password);

            await establishSession(req, registeredUser);
            let returnUserInfo = await returnBasicUserInfo(registeredUser);

            let response = { success: true, auth: true, user: returnUserInfo };
            return res.json(response);
        }
        catch (error) {
            return res.json(returnFailure(error));
        }
    });

    router.post('/updateuserinfo', authenticateSession, async function (req, res) {
        try {
            let user = await UserDetails.findOne({ username: req.user.username });

            if (!req.user || !user) {
                return res.send(returnFailure('Not logged in'));
            }

            const validation = validateWorkingPreferences(req.body);
            if (validation.error) {
                return res.send(returnFailure(validation.error));
            }

            user.timeZone = req.body.timeZone;
            user.workingStartMinutes = validation.start;
            user.workingEndMinutes = validation.end;
            user.temporalDataVersion = TEMPORAL_DATA_VERSION;
            user.workingDays = req.body.workingDays;
            user.selectedCalendars = Array.isArray(req.body.selectedCalendars)
                ? req.body.selectedCalendars
                : [];

            // Save the updated user object
            let savedUser = await user.save();

            let response = { success: true, user: await returnBasicUserInfo(savedUser) };
            return res.json(response);
        }
        catch (error) {
            return res.json(returnFailure(error));
        }
    });

    return router;
}

module.exports = createAuthRoutes;
