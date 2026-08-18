const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const passport = require('passport');
const { UserDetails } = require('../models');
const { returnFailure, returnBasicUserInfo } = require('../utils/helpers');
const { invalidateOneDaySlipForecasts } = require('../controllers/scheduling');
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

const JWTTimeout = 4 * 604800; // 28 Days

function createAuthRoutes(config, authenticateToken) {
    
    router.post('/login', (req, res, next) => {
        passport.authenticate('local',
            (err, user, info) => {
                if (err) {
                    return res.json(returnFailure('Server error while authenticating'));
                }

                if (!user) {
                    return res.json(returnFailure('Failure to login'));
                }

                req.logIn(user, async function (err) {
                    if (err) {
                        return res.json(returnFailure('Failure to login'));
                    }

                    try {
                        await migrateTemporalData(user, req.body.timeZone);
                        user.lastLoginDate = new Date();
                        await user.save();

                        const token = jwt.sign(
                            { id: user.username },
                            config.secret,
                            { expiresIn: JWTTimeout }
                        );
                        const returnUserInfo = await returnBasicUserInfo(user);
                        return res.json({ success: true, auth: true, token, user: returnUserInfo });
                    } catch (error) {
                        console.error(error);
                        return res.json(returnFailure('Server error while updating account data'));
                    }
                });

            })(req, res, next);
    });

    router.get('/user/:username/', authenticateToken, (req, res) => {
        try {
            UserDetails.find({ username: req.params.username }).populate('repos').exec(function (err, docs) {
                if (err) {
                    return res.json(returnFailure('Server error'));
                } else {
                    if (!docs[0]) {
                        return res.json(returnFailure("Error while obtaining user"));
                    } else {
                        var returnValue = {
                            success: true, auth: true,
                            user: {
                                username: docs[0].username, email: docs[0].email
                            }
                        };
                        res.json(returnValue);
                    }
                }
            });
        } catch (error) {
            return res.json(returnFailure(error));
        }
    });

    router.get('/logout', function (req, res) {
        req.logout();
        res.redirect('/api/');
    });

    router.post('/register', async function (req, res) {
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

            let token = jwt.sign({ id: req.body.username }, config.secret, { expiresIn: JWTTimeout });

            let returnUserInfo = await returnBasicUserInfo(registeredUser);

            let response = { success: true, auth: true, token: token, user: returnUserInfo };
            return res.json(response);
        }
        catch (error) {
            return res.json(returnFailure(error));
        }
    });

    router.post('/updateuserinfo', authenticateToken, async function (req, res) {
        try {
            let user = await UserDetails.findOne({ username: req.user.id });

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
            await invalidateOneDaySlipForecasts(user._id);

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
