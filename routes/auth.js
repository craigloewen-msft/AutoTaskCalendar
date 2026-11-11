const express = require('express');
const router = express.Router();
const passport = require('passport');
const { ApiTokenDetails, UserDetails } = require('../models');
const { requireSessionAuth } = require('../middleware/auth');
const {
    MAX_TOKEN_NAME_LENGTH,
    MAX_TOKENS_PER_USER,
    generateToken,
    publicToken,
} = require('../utils/apiTokens');
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

    router.post('/logout', authenticateSession, requireSessionAuth, (req, res, next) => {
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

    // Personal API tokens. See docs/API_TOKENS.md.
    router.get('/apiTokens', authenticateSession, requireSessionAuth, async (req, res) => {
        try {
            const tokens = await ApiTokenDetails.find({ userRef: req.user._id }).sort({ createdAt: -1 });
            return res.json({ success: true, apiTokens: tokens.map(publicToken) });
        } catch (error) {
            console.error(error);
            return res.json(returnFailure('Could not load API tokens'));
        }
    });

    router.post('/apiTokens', authenticateSession, requireSessionAuth, async (req, res) => {
        const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
        if (!name) return res.json(returnFailure('A token name is required'));
        if (name.length > MAX_TOKEN_NAME_LENGTH) {
            return res.json(returnFailure(`Token names are limited to ${MAX_TOKEN_NAME_LENGTH} characters`));
        }

        try {
            const count = await ApiTokenDetails.countDocuments({ userRef: req.user._id });
            if (count >= MAX_TOKENS_PER_USER) {
                return res.json(returnFailure(`You can have at most ${MAX_TOKENS_PER_USER} API tokens`));
            }

            const { token, digest, prefix } = generateToken();
            const record = await ApiTokenDetails.create({
                userRef: req.user._id,
                name,
                tokenDigest: digest,
                prefix,
            });
            // The plaintext token is returned once and never stored.
            return res.json({ success: true, token, apiToken: publicToken(record) });
        } catch (error) {
            console.error(error);
            return res.json(returnFailure('Could not create the API token'));
        }
    });

    router.delete('/apiTokens/:id', authenticateSession, requireSessionAuth, async (req, res) => {
        try {
            const result = await ApiTokenDetails.deleteOne({ _id: req.params.id, userRef: req.user._id });
            if (result.deletedCount === 0) return res.json(returnFailure('API token not found'));
            return res.json({ success: true });
        } catch (error) {
            return res.json(returnFailure('API token not found'));
        }
    });

    return router;
}

module.exports = createAuthRoutes;
