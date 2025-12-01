const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const { UserDetails } = require('../models');
const { returnFailure } = require('../utils/helpers');
const { 
    getEventListFromUsername, 
    createEvent, 
    updateEvent, 
    deleteEvent,
    refreshGoogleCalendarAccessToken,
    syncCalendarsToDatabase 
} = require('../controllers/eventController');

function createEventRoutes(config, authenticateToken) {

    router.post('/createEvent', authenticateToken, async (req, res) => {
        let user = await UserDetails.findOne({ username: req.user.id });

        if (!req.user || !user) {
            return res.send(returnFailure('Not logged in'));
        }

        const { title, startDate, endDate, notes } = req.body;
        if (!title || !startDate || !endDate) {
            return res.send(returnFailure('Title, start date, and end date are required'));
        }

        try {
            const event = await createEvent(user._id, title, startDate, endDate, notes, 'calendar');
            return res.json({ success: true, event });
        } catch (error) {
            console.error(error);
            return res.json({ success: false });
        }
    });

    router.post('/updateEvent', authenticateToken, async (req, res) => {
        let user = await UserDetails.findOne({ username: req.user.id });

        if (!user) {
            return res.send(returnFailure('Not logged in'));
        }

        const { eventId, title, startDate, endDate, notes } = req.body;
        if (!eventId) {
            return res.send(returnFailure('Event id is required'));
        }

        try {
            const event = await updateEvent(eventId, user._id, title, startDate, endDate, notes);
            res.send({ success: true, event });
        } catch (err) {
            res.send(returnFailure(err.message));
        }
    });

    router.post('/deleteEvent', authenticateToken, async (req, res) => {
        let user = await UserDetails.findOne({ username: req.user.id });

        if (!req.user || !user) {
            return res.send(returnFailure('Not logged in'));
        }

        const { eventId } = req.body;
        if (!eventId) {
            return res.send(returnFailure('Event id is required'));
        }

        try {
            await deleteEvent(eventId, user._id);
            // Return the updated event list
            const returnEventList = await getEventListFromUsername(req.user.id);
            return res.json({ success: true, eventList: returnEventList });
        } catch (err) {
            res.send(returnFailure(err.message));
        }
    });

    router.get('/getUserEvents/:date', authenticateToken, async (req, res) => {
        let user = await UserDetails.findOne({ username: req.user.id });

        if (!req.user || !user) {
            return res.send(returnFailure('Not logged in'));
        }
        try {
            const { EventDetails } = require('../models');
            const date = new Date(req.params.date);
            const startOfWeek = new Date(date);
            startOfWeek.setUTCDate(startOfWeek.getUTCDate() - startOfWeek.getUTCDay());
            startOfWeek.setUTCHours(0, 0, 0);
            const endOfWeek = new Date(date);
            endOfWeek.setUTCDate(endOfWeek.getUTCDate() + (7 - endOfWeek.getUTCDay()));
            endOfWeek.setUTCHours(23, 59, 59);

            // Get the user's events from the database
            const events = await EventDetails.find({
                userRef: user._id,
                startDate: { $gte: startOfWeek, $lt: endOfWeek },
            });

            return res.json({ success: true, events });
        } catch (err) {
            console.error(err);
            return res.send(returnFailure(err.message));
        }
    });

    router.get('/connectGoogle', authenticateToken, async (req, res) => {
        let user = await UserDetails.findOne({ username: req.user.id });

        if (!req.user || !user) {
            return res.send(returnFailure('Not logged in'));
        }

        // Generate a URL for the user to connect their Google account
        const oauth2Client = new google.auth.OAuth2(
            config.googleOAuthClientID,
            config.googleOAuthClientSecret,
            `${config.appUrl}/api/connectGoogleCallback`
        );

        const scopes = [
            'https://www.googleapis.com/auth/calendar.readonly',
        ];

        const authUrl = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: scopes,
            state: user._id.toString(),
            prompt: 'consent',
        });

        return res.send({ authUrl });
    });

    router.get('/connectGoogleCallback', async (req, res) => {
        // Check if Google returned an error
        if (req.query.error) {
            // Log the OAuth error type for debugging (Google's error codes are a controlled set)
            console.error('Google OAuth error:', req.query.error);
            return res.redirect(`${config.appUrl}?error=oauth_error`);
        }

        // Check if authorization code is present
        if (!req.query.code) {
            console.error('Missing authorization code in callback');
            return res.redirect(`${config.appUrl}?error=missing_code`);
        }

        // Get the user's ID from the state parameter
        const userId = req.query.state;

        if (!userId) {
            console.error('Missing state parameter in callback');
            return res.redirect(`${config.appUrl}?error=invalid_state`);
        }

        // Check if user exists
        let user = await UserDetails.findById(userId);

        if (!user) {
            console.error('User not found during Google OAuth callback');
            return res.redirect(`${config.appUrl}?error=user_not_found`);
        }

        // Exchange the authorization code for an access token
        const oauth2Client = new google.auth.OAuth2(
            config.googleOAuthClientID,
            config.googleOAuthClientSecret,
            `${config.appUrl}/api/connectGoogleCallback`
        );

        try {
            const { tokens } = await oauth2Client.getToken(req.query.code);

            // Save the access and refresh tokens in the user's document
            user.googleAccessToken = tokens.access_token;
            user.googleRefreshToken = tokens.refresh_token;
            await user.save();

            return res.redirect(`${config.appUrl}`);
        } catch (err) {
            console.error('Failed to exchange authorization code for tokens:', err);
            return res.redirect(`${config.appUrl}?error=token_exchange_failed`);
        }
    });

    router.get('/getCalendars', authenticateToken, async (req, res) => {
        try {
            const user = await UserDetails.findOne({ username: req.user.id });
            if (!user || !user.googleAccessToken) {
                return res.send(returnFailure('User is not authenticated with Google'));
            }

            const auth = new google.auth.OAuth2();
            auth.setCredentials({ access_token: user.googleAccessToken });
            const calendar = google.calendar({ version: 'v3', auth });

            let calendarListResponse = null;
            try {
                calendarListResponse = await calendar.calendarList.list();
            } catch (err) {
                if (err.code == 401) {
                    await refreshGoogleCalendarAccessToken(user, config);
                    calendarListResponse = await calendar.calendarList.list();
                }
            }
            const calendars = calendarListResponse.data.items;

            return res.json({ success: true, calendars });
        } catch (err) {
            return res.send(returnFailure(err.message));
        }
    });

    router.get('/synccalendar', authenticateToken, async (req, res) => {
        try {
            let user = await UserDetails.findOne({ username: req.user.id });

            if (!req.user || !user) {
                return res.send(returnFailure('Not logged in'));
            }

            let now = new Date();
            let twoWeeksBefore = new Date(now.getTime() - 12096e5);
            let monthAfter = new Date(now.getTime() + 2629800000);

            await syncCalendarsToDatabase(user, twoWeeksBefore, monthAfter, config);

            return res.send({ success: true });
        } catch (err) {
            console.error(err);
            return res.send(returnFailure(err.message));
        }
    });

    return router;
}

module.exports = createEventRoutes;
