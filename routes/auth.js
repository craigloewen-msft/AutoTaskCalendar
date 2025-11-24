const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const passport = require('passport');
const { UserDetails } = require('../models');
const { returnFailure, returnBasicUserInfo } = require('../utils/helpers');

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

                    await UserDetails.updateOne({ "username": user.username }, { "lastLoginDate": new Date() });

                    let token = jwt.sign({ id: user.username }, config.secret, { expiresIn: JWTTimeout });

                    let returnUserInfo = await returnBasicUserInfo(user);

                    let response = { success: true, auth: true, token: token, user: returnUserInfo };
                    return res.json(response);
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
            let errorToString = error.toString();
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

            // TODO: Fix this to be accurate to the user's timezone
            let nowDate = new Date();
            let startDate = new Date(nowDate.setHours(14, 0, 0, 0));

            let registeredUser = await UserDetails.register({ 
                username: req.body.username, 
                email: req.body.email, 
                workingStartTime: startDate, 
                workingDuration: 8, 
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

            const { workingStartTime, workingEndTime, workingDays, timeZoneOffset, selectedCalendars } = req.body;

            let timeZoneDifferenceMins = timeZoneOffset;

            // Update user object
            let startDate = new Date();
            startDate.setHours(
                Number(workingStartTime.split(':')[0]) + (timeZoneDifferenceMins / 60),
                Number(workingStartTime.split(':')[1]),
                0,
                0
            );
            let endDate = new Date();
            endDate.setHours(
                Number(workingEndTime.split(':')[0]) + (timeZoneDifferenceMins / 60),
                Number(workingEndTime.split(':')[1]),
                0,
                0
            );

            // workingDuration is hours between start date and end date
            let workingDuration = (endDate.getTime() - startDate.getTime()) / 1000 / 60 / 60;

            user.workingStartTime = startDate;
            user.workingDuration = workingDuration;
            user.workingDays = workingDays;
            user.selectedCalendars = selectedCalendars;

            // Save the updated user object
            let savedUser = await user.save();

            let response = { success: true, user: savedUser };
            return res.json(response);
        }
        catch (error) {
            return res.json(returnFailure(error));
        }
    });

    return router;
}

module.exports = createAuthRoutes;
